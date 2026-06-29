import { NetworkAdapter } from './models/adapter.js';
import { NetworkSnapshot, HistorySample, NetworkEvent } from './models/types.js';
import { WeatherEngine } from './utils/weatherEngine.js';
import { Store } from './Store.js';
import { logger } from './utils/logger.js';
import { EventEmitter } from 'events';

export interface DataManagerOptions {
  retentionMinutes?: number;
  /** How often to capture + persist a live snapshot (ms). */
  captureIntervalMs?: number;
  /** Minimum spacing between persisted history snapshots (ms). */
  snapshotIntervalMs?: number;
  store?: Store;
}

/**
 * Central data manager: drives a single capture loop that polls adapters,
 * computes weather, persists to the store, and emits 'update' to SSE clients.
 * Capturing on a timer (not on request) means history accrues continuously,
 * even when nobody is watching.
 */
export class DataManager extends EventEmitter {
  private adapters: NetworkAdapter[] = [];
  private weatherEngine: WeatherEngine;
  private store?: Store;
  private retentionMinutes: number;
  private captureIntervalMs: number;
  private snapshotIntervalMs: number;

  private captureTimer?: NodeJS.Timeout;
  private cleanupTimer?: NodeJS.Timeout;
  private isRunning = false;
  private latestSnapshot?: NetworkSnapshot;
  private lastPersistedAt = 0;
  private captureInFlight?: Promise<NetworkSnapshot>;

  constructor(adapters: NetworkAdapter[], options: DataManagerOptions = {}) {
    super();
    this.adapters = adapters;
    this.weatherEngine = new WeatherEngine();
    this.store = options.store;
    this.retentionMinutes = options.retentionMinutes ?? 60;
    this.captureIntervalMs = options.captureIntervalMs ?? 5000;
    this.snapshotIntervalMs = options.snapshotIntervalMs ?? 30000;
  }

  async start(): Promise<void> {
    logger.info('Starting data manager...');

    for (const adapter of this.adapters) {
      try {
        await adapter.initialize();
        logger.info(`Adapter ${adapter.name} initialized`);
      } catch (error) {
        logger.error({ adapter: adapter.name, error }, 'Failed to initialize adapter');
      }
    }

    this.isRunning = true;

    // Single capture loop drives live updates, persistence, and alerts.
    await this.captureSnapshot();
    this.captureTimer = setInterval(() => {
      if (this.isRunning) {
        this.captureSnapshot().catch(error =>
          logger.error({ error }, 'Capture loop error')
        );
      }
    }, this.captureIntervalMs);

    this.cleanupTimer = setInterval(() => {
      this.weatherEngine.clearOldHistory(this.retentionMinutes);
      this.store?.prune(this.retentionMinutes);
    }, 60000);

    logger.info('Data manager started');
  }

  async stop(): Promise<void> {
    logger.info('Stopping data manager...');
    this.isRunning = false;
    if (this.captureTimer) clearInterval(this.captureTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);

    for (const adapter of this.adapters) {
      try {
        await adapter.destroy();
      } catch (error) {
        logger.error({ adapter: adapter.name, error }, 'Error destroying adapter');
      }
    }
    this.store?.close();
    logger.info('Data manager stopped');
  }

  /** Latest captured snapshot (cheap — served to API/SSE without a rebuild). */
  async getSnapshot(): Promise<NetworkSnapshot> {
    return this.latestSnapshot ?? this.captureSnapshot();
  }

  getHistory(minutes: number): HistorySample[] {
    if (this.store) return this.store.getHistory(minutes);
    return this.weatherEngine.getHistory(minutes);
  }

  getRecentEvents(limit = 200): NetworkEvent[] {
    return this.store ? this.store.getRecentEvents(limit) : [];
  }

  /**
   * Total data transferred over the last `minutes`, by integrating a device's
   * down/up rate (bits/sec) across the persisted history. Defaults to the
   * gateway (WAN); pass a deviceId for a specific client/device. Returns
   * cumulative bytes plus a downsampled rate series for a sparkline.
   */
  getWanUsage(minutes: number, deviceId?: string): {
    minutes: number;
    downBytes: number;
    upBytes: number;
    series: Array<{ t: number; down: number; up: number }>;
  } {
    const samples = this.getHistory(minutes);
    const pick = (s: HistorySample) =>
      deviceId ? s.devices.find(d => d.id === deviceId) : s.devices.find(d => d.type === 'gateway');
    const series = samples.map(s => {
      const dev = pick(s);
      return { t: s.timestamp, down: dev?.rxBytes ?? 0, up: dev?.txBytes ?? 0 };
    });

    let downBytes = 0;
    let upBytes = 0;
    for (let i = 1; i < series.length; i++) {
      const dt = (series[i].t - series[i - 1].t) / 1000; // seconds
      if (dt <= 0 || dt > 180) continue; // skip gaps (restarts etc.)
      // trapezoidal integration of bits/sec → bytes (÷8)
      downBytes += ((series[i - 1].down + series[i].down) / 2) * dt / 8;
      upBytes += ((series[i - 1].up + series[i].up) / 2) * dt / 8;
    }

    // Downsample the series to keep the response light.
    const step = Math.max(1, Math.ceil(series.length / 80));
    const ds = series.filter((_, i) => i % step === 0);
    return { minutes, downBytes, upBytes, series: ds };
  }

  getAdapterStatus() {
    return this.adapters.map(a => a.getStatus());
  }

  /**
   * Per-device data usage (down/up bytes) over the last `minutes`, integrating
   * each device's rate across the persisted history in a single pass.
   */
  getDeviceUsages(minutes: number): Record<string, { down: number; up: number }> {
    const samples = this.getHistory(minutes);
    const totals: Record<string, { down: number; up: number }> = {};
    // Carry the previous sample's index across iterations instead of rebuilding
    // a Map every step.
    let prev = samples.length ? new Map(samples[0].devices.map(d => [d.id, d])) : new Map();
    for (let i = 1; i < samples.length; i++) {
      const dt = (samples[i].timestamp - samples[i - 1].timestamp) / 1000;
      const cur = new Map(samples[i].devices.map(d => [d.id, d]));
      if (dt > 0 && dt <= 180) {
        for (const [id, d] of cur) {
          const p = prev.get(id);
          if (!p) continue;
          const t = totals[id] || (totals[id] = { down: 0, up: 0 });
          t.down += (((p.rxBytes ?? 0) + (d.rxBytes ?? 0)) / 2) * dt / 8;
          t.up += (((p.txBytes ?? 0) + (d.txBytes ?? 0)) / 2) * dt / 8;
        }
      }
      prev = cur;
    }
    return totals;
  }

  /**
   * Collect adapter data, compute weather, persist, and emit an update.
   * Returns the freshly built snapshot.
   */
  /**
   * Single-flight capture: if a capture is already running, callers share its
   * promise instead of starting an overlapping one. This keeps a slow controller
   * from building an unbounded backlog or emitting out-of-order snapshots.
   */
  private captureSnapshot(): Promise<NetworkSnapshot> {
    if (this.captureInFlight) return this.captureInFlight;
    this.captureInFlight = this.doCapture().finally(() => {
      this.captureInFlight = undefined;
    });
    return this.captureInFlight;
  }

  private async doCapture(): Promise<NetworkSnapshot> {
    const started = Date.now();
    const snapshot = await this.buildSnapshot();

    // Durable device inventory + genuine new-device detection (restart-safe).
    if (this.store) {
      const seeding = this.store.isInventoryEmpty();
      const newIds = this.store.upsertDevices(snapshot.devices, snapshot.timestamp);

      // Drop the adapters' cache-based new-device events — they fire spuriously
      // on restart — and replace them with inventory-confirmed ones.
      const deviceById = new Map(snapshot.devices.map(d => [d.id, d]));
      const events = snapshot.events.filter(e => e.type !== 'new_device');
      if (!seeding) {
        for (const id of newIds) {
          const d = deviceById.get(id);
          if (!d) continue;
          events.push({
            ts: snapshot.timestamp,
            severity: 'info',
            type: 'new_device',
            message: `New device joined: ${d.name}${d.ip ? ` (${d.ip})` : ''}`,
            relatedIds: [id],
          });
        }
      }
      snapshot.events = events;
      this.store.appendEvents(events);

      // Throttle full-snapshot writes to keep the DB compact.
      if (snapshot.timestamp - this.lastPersistedAt >= this.snapshotIntervalMs) {
        this.store.saveSnapshot(snapshot);
        this.lastPersistedAt = snapshot.timestamp;
      }
    }

    this.weatherEngine.addToHistory(snapshot);
    this.latestSnapshot = snapshot;
    this.emit('update', snapshot);

    const duration = Date.now() - started;
    if (duration > this.captureIntervalMs) {
      logger.warn({ durationMs: duration }, 'Capture exceeded the capture interval');
    }
    return snapshot;
  }

  private async buildSnapshot(): Promise<NetworkSnapshot> {
    const allDevices = [];
    const allLinks = [];
    const allEvents: NetworkEvent[] = [];

    for (const adapter of this.adapters) {
      try {
        const data = await adapter.fetchData();
        allDevices.push(...data.devices);
        allLinks.push(...data.links);
        allEvents.push(...data.events);
      } catch (error) {
        logger.error({ adapter: adapter.name, error }, 'Failed to fetch data from adapter');
      }
    }

    // Deduplicate devices by ID (prefer data from later adapters).
    const deviceMap = new Map();
    for (const device of allDevices) deviceMap.set(device.id, device);
    const devices = Array.from(deviceMap.values());

    const linkMap = new Map();
    for (const link of allLinks) linkMap.set(`${link.fromId}-${link.toId}`, link);
    const links = Array.from(linkMap.values());

    const weather = this.weatherEngine.computeWeather(devices, links);

    return {
      timestamp: Date.now(),
      devices,
      links,
      events: allEvents,
      weather,
    };
  }
}

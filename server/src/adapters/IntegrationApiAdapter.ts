import axios, { AxiosInstance } from 'axios';
import https from 'https';
import { NetworkAdapter } from '../models/adapter.js';
import {
  Device,
  Link,
  NetworkEvent,
  AdapterStatus,
  DeviceType,
} from '../models/types.js';
import { logger } from '../utils/logger.js';
import { resolveClientTraffic } from './clientTraffic.js';
import { resolveSingleSite } from './site.js';
import { mapWithConcurrency } from '../utils/concurrency.js';

/** Max simultaneous per-device controller requests during a capture. */
const DEVICE_FETCH_CONCURRENCY = 6;

export interface IntegrationApiConfig {
  baseUrl: string;
  apiKey: string;
  /** Restrict to a single site id; if omitted, all visible sites are polled. */
  siteId?: string;
  /** Minimum ms between live fetches from the controller (default 5000). */
  pollingInterval?: number;
  verifySsl?: boolean;
}

const API_PREFIX = '/proxy/network/integration/v1';

interface LegacyClientDetail {
  downRate: number; // bits/sec
  upRate: number; // bits/sec
  totalDown: number; // bytes
  totalUp: number; // bytes
  rssiDbm?: number;
  experience?: number;
  vendor?: string;
  osName?: string;
  ssid?: string;
  network?: string;
  vlan?: number;
  channel?: number;
  connectedSince?: number;
}

/**
 * Adapter for the modern UniFi Network Integration API (local, API-key based).
 *
 * Available on UniFi Network 9.0+. Authenticates with an `X-API-KEY` header and
 * reads a stable, versioned REST surface under `/proxy/network/integration/v1`.
 *
 * Field names follow the documented v1 schema but parsing is defensive: the API
 * has gained fields across releases, so unknown shapes degrade gracefully rather
 * than throwing. The {@link extractRate} / {@link pickNumber} helpers tolerate the
 * naming variations seen between Network 9.x and 10.x.
 */
export class IntegrationApiAdapter implements NetworkAdapter {
  name = 'integration-api';
  private client: AxiosInstance;
  private siteFilter?: string;
  private siteWarned = false;
  private activeSiteName?: string;
  private pollingInterval: number;

  private lastUpdate = 0;
  private isConnected = false;
  private lastError?: string;
  private deviceCache: Device[] = [];
  private linkCache: Link[] = [];

  // Throttle: fetchData() is called both on every snapshot request and on a 5s
  // poll loop. We cache results and only hit the controller once per interval to
  // stay well under the Integration API rate limits.
  private inFlight?: Promise<{ devices: Device[]; links: Link[]; events: NetworkEvent[] }>;

  constructor(config: IntegrationApiConfig) {
    this.siteFilter = config.siteId;
    this.pollingInterval = config.pollingInterval ?? 5000;

    this.client = axios.create({
      baseURL: config.baseUrl.replace(/\/+$/, ''),
      timeout: 10000,
      headers: {
        'X-API-KEY': config.apiKey,
        Accept: 'application/json',
      },
      httpsAgent: new https.Agent({
        // Verify by default; UniFi gateways ship self-signed certs, so set
        // verifySsl:false explicitly (or pin a CA) to connect to one.
        rejectUnauthorized: config.verifySsl ?? true,
      }),
    });
  }

  async initialize(): Promise<void> {
    logger.info('Initializing Integration API adapter...');
    try {
      const sites = await this.listSites();
      this.isConnected = true;
      this.lastError = undefined;
      logger.info(
        { siteCount: sites.length },
        'Integration API adapter initialized successfully'
      );
    } catch (error) {
      this.isConnected = false;
      this.lastError = this.describeError(error);
      logger.error({ error: this.lastError }, 'Failed to initialize Integration API adapter');
      throw error;
    }
  }

  async fetchData(): Promise<{
    devices: Device[];
    links: Link[];
    events: NetworkEvent[];
  }> {
    const now = Date.now();

    // Serve cached data inside the polling window; never run two fetches at once.
    if (now - this.lastUpdate < this.pollingInterval && this.lastUpdate > 0) {
      return { devices: this.deviceCache, links: this.linkCache, events: [] };
    }
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.doFetch(now).finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async doFetch(now: number): Promise<{
    devices: Device[];
    links: Link[];
    events: NetworkEvent[];
  }> {
    const devices: Device[] = [];
    const events: NetworkEvent[] = [];

    try {
      const sites = await this.listSites();
      // Single-site (1.0): process exactly one site so device IDs can't collide
      // and gateway/WAN selection is deterministic.
      const resolved = resolveSingleSite(sites, this.siteFilter);
      if (resolved.warning && !this.siteWarned) {
        logger.warn(resolved.warning);
        this.siteWarned = true;
      }
      if (resolved.error || !resolved.site) {
        logger.error({ error: resolved.error }, 'Cannot resolve a site');
        return { devices: this.deviceCache, links: this.linkCache, events: [] };
      }
      this.activeSiteName = resolved.site.name;
      const targetSites = [resolved.site];

      for (const site of targetSites) {
        const rawDevices = await this.listAll(`${API_PREFIX}/sites/${site.id}/devices`);

        // Fetch each device's detail + statistics with BOUNDED concurrency
        // (instead of two sequential round-trips per device across the whole
        // list), so a slow controller can't stretch the capture past its
        // interval. Order is preserved for deterministic event recording.
        const built = await mapWithConcurrency(rawDevices, DEVICE_FETCH_CONCURRENCY, async raw => {
          const device = this.normalizeDevice(raw, site.id);
          const base = `${API_PREFIX}/sites/${site.id}/devices/${raw.id}`;
          const [detail, stats] = await Promise.all([
            // detail carries uplink.deviceId (topology edges)
            this.getJson(base).catch(() => {
              logger.debug({ deviceId: raw.id }, 'Device detail not available');
              return undefined;
            }),
            // statistics/latest carries traffic rates, latency, uptime
            this.getJson(`${base}/statistics/latest`).catch(() => {
              logger.debug({ deviceId: raw.id }, 'Device statistics not available');
              return undefined;
            }),
          ]);
          if (detail) this.applyDeviceDetail(device, detail);
          if (stats) this.applyDeviceStats(device, stats);
          return device;
        });

        for (const device of built) {
          this.recordStateChange(device, events, now);
          devices.push(device);
        }

        // Clients (connected stations). The Integration API omits per-client
        // traffic, so we enrich from the legacy stat/sta endpoint (reachable
        // with the same API key) keyed by MAC.
        try {
          const siteRef = site.internalReference || 'default';
          const legacyRates = await this.fetchLegacyClientRates(siteRef);
          const rawClients = await this.listAll(`${API_PREFIX}/sites/${site.id}/clients`);
          for (const raw of rawClients) {
            const client = this.normalizeClient(raw, site.id);
            const legacy = client.mac ? legacyRates.get(client.mac.toLowerCase()) : undefined;
            if (legacy) {
              const traffic = resolveClientTraffic(undefined, undefined, legacy);
              client.rxBps = traffic.rxBps;
              client.txBps = traffic.txBps;
              client.totalRxBytes = traffic.totalRxBytes;
              client.totalTxBytes = traffic.totalTxBytes;
              if (legacy.rssiDbm !== undefined) client.rssi = legacy.rssiDbm;
              if (legacy.experience !== undefined) client.experience = legacy.experience;
              if (legacy.vendor) client.vendor = legacy.vendor;
              if (legacy.osName) client.osName = legacy.osName;
              if (legacy.ssid) client.ssid = legacy.ssid;
              if (legacy.vlan !== undefined) client.vlanId = legacy.vlan;
              if (legacy.network) client.network = legacy.network;
              if (legacy.channel !== undefined) client.channel = legacy.channel;
              if (legacy.connectedSince !== undefined) client.connectedSince = legacy.connectedSince;
            }
            this.recordStateChange(client, events, now, true);
            devices.push(client);
          }
        } catch (error) {
          logger.debug({ siteId: site.id }, 'Client list not available');
        }
      }

      const links = this.buildLinks(devices, now);

      this.deviceCache = devices;
      this.linkCache = links;
      this.lastUpdate = now;
      this.isConnected = true;
      this.lastError = undefined;

      return { devices, links, events };
    } catch (error) {
      this.isConnected = false;
      this.lastError = this.describeError(error);
      logger.error({ error: this.lastError }, 'Failed to fetch data from Integration API');

      return {
        devices: this.deviceCache,
        links: this.linkCache,
        events: [
          {
            ts: now,
            severity: 'error',
            type: 'wan_issue',
            message: `Integration API error: ${this.lastError}`,
            relatedIds: [],
          },
        ],
      };
    }
  }

  getStatus(): AdapterStatus {
    return {
      name: this.name,
      connected: this.isConnected,
      lastUpdate: this.lastUpdate,
      error: this.lastError,
      deviceCount: this.deviceCache.length,
      site: this.activeSiteName,
    };
  }

  async destroy(): Promise<void> {
    logger.info('Integration API adapter destroyed');
  }

  // --- HTTP helpers ---------------------------------------------------------

  private async listSites(): Promise<Array<{ id: string; internalReference?: string; name?: string }>> {
    return this.listAll(`${API_PREFIX}/sites`);
  }

  private async getJson(url: string, params?: Record<string, unknown>): Promise<any> {
    const res = await this.client.get(url, { params });
    return res.data;
  }

  /**
   * Rich per-client detail from the legacy `stat/sta` endpoint, keyed by MAC.
   *
   * Two unit/semantic notes baked in here:
   *  - `*-r` rate fields are BYTES/sec; the Integration API's device `txRateBps`
   *    is BITS/sec — so we ×8 to keep every stored rate in bits/sec.
   *  - For a CLIENT, `tx_bytes` is what the AP sent TO it (the client's
   *    DOWNLOAD), the reverse of the gateway's uplink convention. We map it to
   *    the download (rx) side so "↓ = download" holds everywhere.
   */
  private async fetchLegacyClientRates(
    siteRef: string
  ): Promise<Map<string, LegacyClientDetail>> {
    const map = new Map<string, LegacyClientDetail>();
    try {
      const body = await this.getJson(`/proxy/network/api/s/${siteRef}/stat/sta`);
      for (const c of body?.data ?? []) {
        if (!c.mac) continue;
        const uptime = this.pickNumber(c, ['uptime']);
        const assoc = this.pickNumber(c, ['assoc_time']);
        const connectedSince = assoc
          ? assoc * 1000
          : uptime
            ? Date.now() - uptime * 1000
            : undefined;
        map.set(String(c.mac).toLowerCase(), {
          // download = client-side rx = AP's tx_bytes(-r); upload = rx_bytes(-r)
          downRate: (this.pickNumber(c, ['tx_bytes-r']) ?? 0) * 8,
          upRate: (this.pickNumber(c, ['rx_bytes-r']) ?? 0) * 8,
          totalDown: this.pickNumber(c, ['tx_bytes']) ?? 0,
          totalUp: this.pickNumber(c, ['rx_bytes']) ?? 0,
          rssiDbm: this.pickNumber(c, ['signal', 'rssi']),
          experience: this.pickNumber(c, ['satisfaction']),
          vendor: typeof c.oui === 'string' ? c.oui : undefined,
          osName: typeof c.os_name === 'string' ? c.os_name : undefined,
          ssid: typeof c.essid === 'string' ? c.essid : undefined,
          network: typeof c.network === 'string' ? c.network : undefined,
          vlan: this.pickNumber(c, ['vlan']),
          channel: this.pickNumber(c, ['channel']),
          connectedSince,
        });
      }
    } catch (error) {
      logger.debug('Legacy per-client detail unavailable');
    }
    return map;
  }

  /** Fetch a paginated collection, following offset/limit until exhausted. */
  private async listAll(url: string): Promise<any[]> {
    const out: any[] = [];
    let offset = 0;
    const limit = 200;

    // Cap iterations defensively so a misbehaving endpoint can't loop forever.
    for (let page = 0; page < 100; page++) {
      const body = await this.getJson(url, { offset, limit });
      const items: any[] = Array.isArray(body) ? body : body?.data ?? [];
      out.push(...items);

      const totalCount = typeof body?.totalCount === 'number' ? body.totalCount : undefined;
      const count = items.length;
      offset += count;

      if (count === 0) break;
      if (totalCount !== undefined && offset >= totalCount) break;
      if (count < limit) break;
    }

    return out;
  }

  // --- Normalization --------------------------------------------------------

  private normalizeDevice(raw: any, siteId: string): Device {
    const mac = raw.macAddress || raw.mac;
    return {
      id: raw.id || mac,
      name: raw.name || raw.model || mac || 'Unknown',
      type: this.mapDeviceType(raw),
      mac,
      ip: raw.ipAddress || raw.ip,
      // Uplink topology is resolved in buildLinks(); store the hint if present.
      parentDeviceId: raw.uplinkDeviceId || raw.uplink?.deviceId,
      uplinkPort: this.asString(raw.uplink?.portIdx ?? raw.uplinkPort),
      wiredOrWifi: 'wired',
      siteId,
      txBps: 0,
      rxBps: 0,
      lastSeen: this.toMs(raw.lastSeen ?? raw.lastHeartbeatAt) ?? Date.now(),
      online: this.isOnline(raw.state ?? raw.status),
    };
  }

  private normalizeClient(raw: any, siteId: string): Device {
    const mac = raw.macAddress || raw.mac;
    const wired = this.isWiredClient(raw);
    // The Integration API's tx/rx are cumulative counters, not rates — keep them
    // as totals; the instantaneous rate is filled later from legacy stat/sta.
    const traffic = resolveClientTraffic(
      this.pickNumber(raw, ['txBytes', 'tx_bytes']),
      this.pickNumber(raw, ['rxBytes', 'rx_bytes'])
    );
    return {
      id: raw.id || mac,
      name: raw.name || raw.hostname || mac || 'Unknown Client',
      type: 'client',
      mac,
      ip: raw.ipAddress || raw.ip,
      parentDeviceId: raw.uplinkDeviceId || raw.connectedDeviceId || raw.apMac || raw.swMac,
      wiredOrWifi: wired ? 'wired' : 'wifi',
      siteId,
      ssid: raw.ssid || raw.essid,
      rssi: this.pickNumber(raw, ['signalStrength', 'rssi', 'signal']),
      vlanId: this.pickNumber(raw, ['vlanId', 'vlan']),
      txBps: traffic.txBps,
      rxBps: traffic.rxBps,
      totalRxBytes: traffic.totalRxBytes,
      totalTxBytes: traffic.totalTxBytes,
      lastSeen: this.toMs(raw.lastSeen ?? raw.connectedAt) ?? Date.now(),
      online: true,
      latencyMs: this.pickNumber(raw, ['latencyMs', 'latency']),
    };
  }

  /** Apply a device-detail payload (topology, ports) onto a device in place. */
  private applyDeviceDetail(device: Device, detail: any): void {
    if (!detail) return;
    const uplinkDeviceId = detail.uplink?.deviceId;
    if (uplinkDeviceId) device.parentDeviceId = uplinkDeviceId;
    const port = detail.uplink?.portIdx ?? detail.uplink?.port;
    if (port !== undefined) device.uplinkPort = this.asString(port);
    if (detail.state !== undefined) device.online = this.isOnline(detail.state);
  }

  /** Apply a `.../statistics/latest` payload onto a device in place. */
  private applyDeviceStats(device: Device, stats: any): void {
    if (!stats) return;
    const uplink = stats.uplink ?? stats;
    device.txBps = this.extractRate(uplink, ['txRateBps', 'txRate', 'tx_bytes-r', 'txBytes']) ?? device.txBps;
    device.rxBps = this.extractRate(uplink, ['rxRateBps', 'rxRate', 'rx_bytes-r', 'rxBytes']) ?? device.rxBps;
    const latency = this.pickNumber(stats, ['latencyMs', 'latencyAvgMs', 'uplinkLatencyMs', 'latency']);
    if (latency !== undefined) device.latencyMs = latency;
    const loss = this.pickNumber(stats, ['packetLossPct', 'lossPct', 'packetLoss']);
    if (loss !== undefined) device.packetLoss = loss > 1 ? loss / 100 : loss;

    // Device load — drives "heat" so working devices glow even on a quiet LAN.
    const cpu = this.pickNumber(stats, ['cpuUtilizationPct', 'cpuPct', 'cpu']);
    if (cpu !== undefined) device.cpuPct = cpu;
    const mem = this.pickNumber(stats, ['memoryUtilizationPct', 'memPct', 'memory']);
    if (mem !== undefined) device.memPct = mem;
    const load = this.pickNumber(stats, ['loadAverage1Min', 'loadAvg', 'load1']);
    if (load !== undefined) device.loadAvg = load;
  }

  private buildLinks(devices: Device[], now: number): Link[] {
    const links: Link[] = [];
    const byId = new Map(devices.map(d => [d.id, d]));
    const byMac = new Map(devices.filter(d => d.mac).map(d => [d.mac as string, d]));

    for (const device of devices) {
      if (!device.parentDeviceId) continue;
      // Parent hint may be an id or a MAC; resolve to a known device id.
      const parent = byId.get(device.parentDeviceId) || byMac.get(device.parentDeviceId);
      if (!parent) continue;

      links.push({
        fromId: parent.id,
        toId: device.id,
        kind: device.type === 'client' ? 'client' : 'uplink',
        utilizationScore: this.calculateUtilization(device),
        healthScore: device.online ? 1 : 0,
        lastChangeTs: now,
      });
    }

    return links;
  }

  private recordStateChange(
    device: Device,
    events: NetworkEvent[],
    now: number,
    isClient = false
  ): void {
    const cached = this.deviceCache.find(d => d.id === device.id);
    if (cached && cached.online !== device.online) {
      events.push({
        ts: now,
        severity: device.online ? 'info' : 'warning',
        type: device.online ? 'device_reconnect' : 'offline',
        message: `${device.name} ${device.online ? 'came online' : 'went offline'}`,
        relatedIds: [device.id],
      });
    } else if (!cached) {
      events.push({
        ts: now,
        severity: 'info',
        type: 'new_device',
        message: isClient
          ? `Client connected: ${device.name}`
          : `New device discovered: ${device.name}`,
        relatedIds: [device.id],
      });
    }
  }

  // --- Small typed helpers --------------------------------------------------

  private mapDeviceType(raw: any): DeviceType {
    const hay = `${raw.type ?? ''} ${raw.model ?? ''} ${raw.deviceCategory ?? raw.category ?? ''}`.toLowerCase();
    if (/(gateway|udm|usg|ugw|ucg|uxg|dream)/.test(hay)) return 'gateway';
    if (/(switch|usw|usag|pdu|usp)/.test(hay)) return 'switch';
    if (/(\bap\b|uap|u6|u7|access\s?point)/.test(hay)) return 'ap';
    return 'unknown';
  }

  private isOnline(state: unknown): boolean {
    if (typeof state === 'number') return state === 1;
    const s = String(state ?? '').toLowerCase();
    return s === 'online' || s === 'connected' || s === 'ok';
  }

  private isWiredClient(raw: any): boolean {
    if (typeof raw.isWired === 'boolean') return raw.isWired;
    const t = String(raw.type ?? raw.connectionType ?? '').toLowerCase();
    if (t.includes('wired')) return true;
    if (t.includes('wireless') || t.includes('wifi') || t.includes('wlan')) return false;
    // Wireless clients report an SSID/RSSI; wired ones don't.
    return !(raw.ssid || raw.essid || raw.signalStrength != null);
  }

  /**
   * Traffic-rate fields drive the storm/wind animation. The weather engine reads
   * tx/rxBps as a throughput proxy, so a bytes-per-second rate maps directly.
   */
  private extractRate(obj: any, keys: string[]): number | undefined {
    return this.pickNumber(obj, keys);
  }

  private pickNumber(obj: any, keys: string[]): number | undefined {
    if (!obj) return undefined;
    for (const key of keys) {
      const v = obj[key];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
        return Number(v);
      }
    }
    return undefined;
  }

  private calculateUtilization(device: Device): number {
    const totalBytes = device.txBps + device.rxBps;
    // Normalize to 0..1 against ~1 Gbps of throughput.
    return Math.min(1, totalBytes / (1024 * 1024 * 128));
  }

  private asString(v: unknown): string | undefined {
    return v === undefined || v === null ? undefined : String(v);
  }

  /** Coerce epoch seconds, epoch ms, or ISO strings to epoch ms. */
  private toMs(v: unknown): number | undefined {
    if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
    if (typeof v === 'string') {
      const parsed = Date.parse(v);
      if (!Number.isNaN(parsed)) return parsed;
      const n = Number(v);
      if (Number.isFinite(n)) return n > 1e12 ? n : n * 1000;
    }
    return undefined;
  }

  private describeError(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      if (status === 401) return 'Unauthorized (401): check the API key';
      if (status === 403) return 'Forbidden (403): API key lacks permission';
      if (status === 404) return 'Not found (404): Integration API path unavailable on this controller';
      if (status) return `HTTP ${status}: ${error.response?.statusText ?? 'request failed'}`;
      return error.message;
    }
    return error instanceof Error ? error.message : 'Unknown error';
  }
}

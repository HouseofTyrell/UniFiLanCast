import { Device, Link, WeatherSignals, HistorySample } from '../models/types.js';

/**
 * Computes weather signals from network state
 */
export class WeatherEngine {
  private history: HistorySample[] = [];
  private readonly maxHistorySize = 100;

  /**
   * Compute weather signals based on current and historical data
   */
  // Throughput (in the adapter's rate units) below this is treated as idle, so
  // genuinely quiet links stay calm instead of being amplified by the log curve.
  private static readonly NOISE_FLOOR = 10_000;
  // Don't let the adaptive reference fall below this, so an almost-idle network
  // doesn't turn faint background chatter into a full storm.
  private static readonly MIN_REFERENCE = 1_000_000;

  computeWeather(devices: Device[], links: Link[]): WeatherSignals {
    const stormIntensity: Record<string, number> = {};
    const fogLevel: Record<string, number> = {};
    const heat: Record<string, number> = {};
    const lightningEvents: Array<{ linkId: string; deviceId: string; ts: number }> = [];

    const now = Date.now();

    // A link's load is the throughput of the device hanging off it (toId). Find
    // the busiest device so everything scales relative to current activity —
    // the busiest link is always a visible storm, the rest scale down from it.
    const deviceById = new Map(devices.map(d => [d.id, d]));
    const throughputOf = (d: Device | undefined) =>
      d ? Math.max(0, d.txBytes) + Math.max(0, d.rxBytes) : 0;

    let peak = WeatherEngine.MIN_REFERENCE;
    for (const device of devices) peak = Math.max(peak, throughputOf(device));

    // Compute storm intensity per link from the child device's throughput.
    for (const link of links) {
      const linkId = `${link.fromId}-${link.toId}`;
      const throughput = throughputOf(deviceById.get(link.toId));
      let intensity = this.logScale(throughput, peak);

      // Sudden jump vs the previous sample → traffic spike → lightning.
      const previous = this.getPreviousLinkStorm(linkId);
      if (previous !== null && intensity > previous + 0.3) {
        intensity = Math.min(1, intensity + 0.2);
        lightningEvents.push({ linkId, deviceId: link.toId, ts: now });
      }

      stormIntensity[linkId] = intensity;
    }

    // Compute fog and heat per device.
    for (const device of devices) {
      // Fog: offline = full fog; otherwise scaled by packet loss.
      let fog = 0;
      if (!device.online) {
        fog = 1.0;
      } else if (device.packetLoss !== undefined) {
        fog = Math.min(1, device.packetLoss / 10); // 10% loss = full fog
      }

      // Heat: real device load (CPU + load average) blended with its traffic, so
      // a busy gateway/AP glows even when the LAN is quiet.
      let deviceHeat = 0;
      if (device.online) {
        const cpuHeat = device.cpuPct !== undefined ? device.cpuPct / 100 : 0;
        const loadHeat = device.loadAvg !== undefined ? device.loadAvg / 4 : 0;
        const trafficHeat = this.logScale(throughputOf(device), peak);
        deviceHeat = Math.min(1, Math.max(cpuHeat, loadHeat, trafficHeat * 0.8));
      }

      // Latency spikes add heat and, when severe, lightning.
      if (device.latencyMs !== undefined && device.latencyMs > 100) {
        deviceHeat = Math.max(deviceHeat, Math.min(1, device.latencyMs / 500));
        if (device.latencyMs > 200) {
          lightningEvents.push({
            linkId: `${device.parentDeviceId}-${device.id}`,
            deviceId: device.id,
            ts: now,
          });
        }
      }

      fogLevel[device.id] = fog;
      heat[device.id] = deviceHeat;
    }

    return {
      stormIntensity,
      fogLevel,
      heat,
      lightningEvents,
    };
  }

  /**
   * Map a throughput value to 0..1 on a log scale between a noise floor and an
   * adaptive reference (the network's current peak). Idle stays at 0; the peak
   * reaches 1; everything in between spreads across orders of magnitude so even
   * a modest home-scale link is visibly active.
   */
  private logScale(value: number, reference: number): number {
    const floor = WeatherEngine.NOISE_FLOOR;
    if (value <= floor) return 0;
    const ref = Math.max(reference, floor * 10);
    const scaled = (Math.log10(value) - Math.log10(floor)) /
      (Math.log10(ref) - Math.log10(floor));
    return Math.max(0, Math.min(1, scaled));
  }

  /**
   * Add snapshot to history
   */
  addToHistory(sample: HistorySample): void {
    this.history.push(sample);

    // Keep only recent history
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }
  }

  /**
   * Get history samples for a time range
   */
  getHistory(minutes: number): HistorySample[] {
    const cutoff = Date.now() - minutes * 60 * 1000;
    return this.history.filter(s => s.timestamp >= cutoff);
  }

  /**
   * Clear old history beyond retention period
   */
  clearOldHistory(retentionMinutes: number): void {
    const cutoff = Date.now() - retentionMinutes * 60 * 1000;
    this.history = this.history.filter(s => s.timestamp >= cutoff);
  }

  private getPreviousLinkStorm(linkId: string): number | null {
    if (this.history.length < 1) return null;

    const previousSample = this.history[this.history.length - 1];
    const intensity = previousSample.weather?.stormIntensity?.[linkId];
    return typeof intensity === 'number' ? intensity : null;
  }
}

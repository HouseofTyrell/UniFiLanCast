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
  computeWeather(devices: Device[], links: Link[]): WeatherSignals {
    const stormIntensity: Record<string, number> = {};
    const fogLevel: Record<string, number> = {};
    const heat: Record<string, number> = {};
    const lightningEvents: Array<{ linkId: string; deviceId: string; ts: number }> = [];

    const now = Date.now();

    // Compute storm intensity for each link (based on utilization + spikes)
    for (const link of links) {
      const linkId = `${link.fromId}-${link.toId}`;
      let intensity = link.utilizationScore;

      // Check for sudden spikes in traffic
      const previousSample = this.getPreviousLinkUtilization(linkId);
      if (previousSample !== null && link.utilizationScore > previousSample + 0.3) {
        intensity = Math.min(1, intensity + 0.3);
        lightningEvents.push({
          linkId,
          deviceId: link.fromId,
          ts: now,
        });
      }

      stormIntensity[linkId] = intensity;
    }

    // Compute fog level and heat for each device
    for (const device of devices) {
      let fog = 0;
      let deviceHeat = 0;

      // Fog: based on packet loss or offline status
      if (!device.online) {
        fog = 1.0;
      } else if (device.packetLoss !== undefined) {
        fog = Math.min(1, device.packetLoss / 10); // 10% loss = full fog
      }

      // Heat: based on traffic volume
      const totalBytes = device.txBytes + device.rxBytes;
      if (totalBytes > 0) {
        // Normalize to 0-1 (assuming 100MB is "hot")
        deviceHeat = Math.min(1, totalBytes / (100 * 1024 * 1024));
      }

      // Check for latency spikes
      if (device.latencyMs !== undefined && device.latencyMs > 100) {
        deviceHeat = Math.max(deviceHeat, Math.min(1, device.latencyMs / 500));

        // Add lightning event for severe latency
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

  private getPreviousLinkUtilization(linkId: string): number | null {
    if (this.history.length < 2) return null;

    const previousSample = this.history[this.history.length - 2];
    const link = previousSample.links.find(
      l => `${l.fromId}-${l.toId}` === linkId
    );

    return link ? link.utilizationScore : null;
  }
}

import { Device, NetworkEvent } from './models/types.js';

export interface HealthThresholds {
  latencyHighMs: number; // cross above → spike
  latencyLowMs: number; // fall below → recovered (hysteresis gap)
  lossHighPct: number; // fraction 0..1
  lossLowPct: number;
}

export const DEFAULT_HEALTH_THRESHOLDS: HealthThresholds = {
  latencyHighMs: 150,
  latencyLowMs: 80,
  lossHighPct: 0.05, // 5%
  lossLowPct: 0.02, // 2%
};

/**
 * Centralized health-event detection over the normalized snapshot — so latency
 * and packet-loss events are emitted identically regardless of which adapter
 * produced the data (instead of per-adapter ad-hoc event code).
 *
 * Uses hysteresis (separate high/low thresholds) and per-device state so a
 * metric hovering near the threshold doesn't flap a stream of alerts: a single
 * "spike"/"loss" event fires on crossing up, and a single "recovered"/"cleared"
 * (info) event fires only after it drops back below the low threshold.
 */
export class HealthMonitor {
  private latencyHigh = new Set<string>();
  private lossHigh = new Set<string>();
  private readonly t: HealthThresholds;

  constructor(thresholds: Partial<HealthThresholds> = {}) {
    this.t = { ...DEFAULT_HEALTH_THRESHOLDS, ...thresholds };
  }

  /** Evaluate a snapshot's devices and return any health transition events. */
  evaluate(devices: Device[], ts: number): NetworkEvent[] {
    const events: NetworkEvent[] = [];
    const seen = new Set<string>();

    for (const d of devices) {
      seen.add(d.id);

      if (typeof d.latencyMs === 'number') {
        const was = this.latencyHigh.has(d.id);
        if (!was && d.latencyMs >= this.t.latencyHighMs) {
          this.latencyHigh.add(d.id);
          events.push({
            ts,
            severity: 'warning',
            type: 'latency_spike',
            message: `High latency on ${d.name}: ${Math.round(d.latencyMs)} ms`,
            relatedIds: [d.id],
          });
        } else if (was && d.latencyMs <= this.t.latencyLowMs) {
          this.latencyHigh.delete(d.id);
          events.push({
            ts,
            severity: 'info',
            type: 'latency_spike',
            message: `Latency recovered on ${d.name}: ${Math.round(d.latencyMs)} ms`,
            relatedIds: [d.id],
          });
        }
      }

      if (typeof d.packetLoss === 'number') {
        const was = this.lossHigh.has(d.id);
        if (!was && d.packetLoss >= this.t.lossHighPct) {
          this.lossHigh.add(d.id);
          events.push({
            ts,
            severity: 'warning',
            type: 'packet_loss',
            message: `Packet loss on ${d.name}: ${(d.packetLoss * 100).toFixed(1)}%`,
            relatedIds: [d.id],
          });
        } else if (was && d.packetLoss <= this.t.lossLowPct) {
          this.lossHigh.delete(d.id);
          events.push({
            ts,
            severity: 'info',
            type: 'packet_loss',
            message: `Packet loss cleared on ${d.name}`,
            relatedIds: [d.id],
          });
        }
      }
    }

    // A device that vanished can't recover later; drop its state so a returning
    // device starts clean rather than emitting a stale recovery.
    for (const id of [...this.latencyHigh]) if (!seen.has(id)) this.latencyHigh.delete(id);
    for (const id of [...this.lossHigh]) if (!seen.has(id)) this.lossHigh.delete(id);

    return events;
  }
}

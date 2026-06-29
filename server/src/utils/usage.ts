import { HistorySample } from '../models/types.js';

/**
 * Skip integration across gaps longer than this (seconds) — a restart or a
 * stalled capture loop would otherwise be integrated as if traffic continued.
 */
export const MAX_GAP_SECONDS = 180;

export interface RatePoint {
  t: number; // epoch ms
  down: number; // bits/sec
  up: number; // bits/sec
}

/**
 * Trapezoidally integrate a bits/sec rate series into bytes (÷8), skipping
 * non-positive and over-long intervals. Pure — the core of all usage figures.
 */
export function integrateSeries(series: RatePoint[]): { downBytes: number; upBytes: number } {
  let downBytes = 0;
  let upBytes = 0;
  for (let i = 1; i < series.length; i++) {
    const dt = (series[i].t - series[i - 1].t) / 1000;
    if (dt <= 0 || dt > MAX_GAP_SECONDS) continue;
    downBytes += ((series[i - 1].down + series[i].down) / 2) * dt / 8;
    upBytes += ((series[i - 1].up + series[i].up) / 2) * dt / 8;
  }
  return { downBytes, upBytes };
}

/**
 * Per-device usage (bytes) over a set of history samples, in a single pass that
 * reuses the previous sample's device map. rxBytes/txBytes hold bits/sec rates.
 */
export function integrateDeviceUsages(
  samples: HistorySample[]
): Record<string, { down: number; up: number }> {
  const totals: Record<string, { down: number; up: number }> = {};
  let prev = samples.length
    ? new Map(samples[0].devices.map(d => [d.id, d]))
    : new Map<string, HistorySample['devices'][number]>();
  for (let i = 1; i < samples.length; i++) {
    const dt = (samples[i].timestamp - samples[i - 1].timestamp) / 1000;
    const cur = new Map(samples[i].devices.map(d => [d.id, d]));
    if (dt > 0 && dt <= MAX_GAP_SECONDS) {
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

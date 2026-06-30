import { describe, it, expect } from 'vitest';
import { integrateSeries, integrateDeviceUsages, MAX_GAP_SECONDS } from './usage.js';

describe('integrateSeries', () => {
  it('integrates a constant bits/sec rate into bytes (÷8)', () => {
    // 8000 bits/sec for 10s = 80,000 bits = 10,000 bytes
    const { downBytes, upBytes } = integrateSeries([
      { t: 0, down: 8000, up: 800 },
      { t: 10_000, down: 8000, up: 800 },
    ]);
    expect(downBytes).toBeCloseTo(10_000, 6);
    expect(upBytes).toBeCloseTo(1000, 6);
  });

  it('skips gaps longer than the max (restart/stall) instead of over-counting', () => {
    const { downBytes } = integrateSeries([
      { t: 0, down: 8000, up: 0 },
      { t: (MAX_GAP_SECONDS + 10) * 1000, down: 8000, up: 0 },
    ]);
    expect(downBytes).toBe(0);
  });

  it('skips non-positive intervals', () => {
    const { downBytes } = integrateSeries([
      { t: 5000, down: 8000, up: 0 },
      { t: 5000, down: 8000, up: 0 }, // dt == 0
      { t: 0, down: 8000, up: 0 }, // dt < 0
    ]);
    expect(downBytes).toBe(0);
  });

  it('returns zero for fewer than two points', () => {
    expect(integrateSeries([]).downBytes).toBe(0);
    expect(integrateSeries([{ t: 0, down: 100, up: 100 }]).downBytes).toBe(0);
  });
});

describe('integrateDeviceUsages', () => {
  it('accumulates per-device usage across samples', () => {
    const totals = integrateDeviceUsages([
      { timestamp: 0, devices: [{ id: 'a', type: 'client', rxBps: 8000, txBps: 800 }] },
      { timestamp: 10_000, devices: [{ id: 'a', type: 'client', rxBps: 8000, txBps: 800 }] },
    ] as any);
    expect(totals.a.down).toBeCloseTo(10_000, 6);
    expect(totals.a.up).toBeCloseTo(1000, 6);
  });

  it('only counts a device present in both consecutive samples', () => {
    const totals = integrateDeviceUsages([
      { timestamp: 0, devices: [{ id: 'a', rxBps: 8000, txBps: 0 }] },
      {
        timestamp: 10_000,
        devices: [
          { id: 'a', rxBps: 8000, txBps: 0 },
          { id: 'b', rxBps: 8000, txBps: 0 }, // first appearance — no prior point
        ],
      },
    ] as any);
    expect(totals.a.down).toBeCloseTo(10_000, 6);
    expect(totals.b).toBeUndefined();
  });

  it('returns an empty map for empty history', () => {
    expect(integrateDeviceUsages([])).toEqual({});
  });
});

import { describe, it, expect } from 'vitest';
import { rateLevel, usageScale, tierMaxUsage, nodeRadius } from './scale';

describe('rateLevel', () => {
  it('is 0 at/below zero and clamps to 1 at high rates', () => {
    expect(rateLevel(0)).toBe(0);
    expect(rateLevel(-5)).toBe(0);
    expect(rateLevel(50_000_000)).toBe(1);
    expect(rateLevel(500_000_000)).toBe(1); // clamped
  });
  it('rises monotonically across the band', () => {
    expect(rateLevel(500_000)).toBeGreaterThan(rateLevel(50_000));
    expect(rateLevel(5_000_000)).toBeGreaterThan(rateLevel(500_000));
  });
});

describe('usageScale', () => {
  it('returns 0 for no usage or no max', () => {
    expect(usageScale(0, 1000)).toBe(0);
    expect(usageScale(1000, 0)).toBe(0);
  });
  it('puts the busiest device at 1 and keeps a real range when max is small', () => {
    expect(usageScale(1000, 1000)).toBeCloseTo(1, 5);
    // small max must not collapse everything to idle
    expect(usageScale(1000, 1000)).toBeGreaterThan(usageScale(100, 1000));
  });
});

describe('tierMaxUsage', () => {
  it('tracks the busiest client and infra separately, ignoring the gateway', () => {
    const map = {
      c1: { down: 100, up: 0 },
      c2: { down: 900, up: 100 }, // busiest client = 1000
      sw: { down: 5000, up: 0 }, // infra
      gw: { down: 99999, up: 0 }, // gateway excluded
    };
    const types: Record<string, any> = { c1: 'client', c2: 'client', sw: 'switch', gw: 'gateway' };
    const { client, infra } = tierMaxUsage(map, id => types[id]);
    expect(client).toBe(1000);
    expect(infra).toBe(5000);
  });
});

describe('nodeRadius', () => {
  it('keeps the gateway fixed and scales infra/clients by activity', () => {
    expect(nodeRadius('gateway', 0)).toBe(24);
    expect(nodeRadius('gateway', 1)).toBe(24);
    expect(nodeRadius('switch', 0)).toBe(11);
    expect(nodeRadius('switch', 1)).toBe(22);
    expect(nodeRadius('client', 0)).toBe(5);
    expect(nodeRadius('client', 1)).toBe(21);
  });
});

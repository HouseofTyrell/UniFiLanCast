import { describe, it, expect } from 'vitest';
import { HealthMonitor } from './HealthMonitor.js';

const dev = (over: Record<string, unknown> = {}) =>
  ({ id: 'd1', name: 'Gateway', type: 'gateway', ...over }) as any;

describe('HealthMonitor latency', () => {
  it('emits one spike on crossing up, nothing while it stays high', () => {
    const hm = new HealthMonitor({ latencyHighMs: 150, latencyLowMs: 80 });
    expect(hm.evaluate([dev({ latencyMs: 40 })], 1)).toHaveLength(0); // normal
    const spike = hm.evaluate([dev({ latencyMs: 220 })], 2);
    expect(spike).toHaveLength(1);
    expect(spike[0]).toMatchObject({ type: 'latency_spike', severity: 'warning' });
    expect(hm.evaluate([dev({ latencyMs: 210 })], 3)).toHaveLength(0); // still high, no repeat
  });

  it('does not flap in the hysteresis band, recovers only below the low threshold', () => {
    const hm = new HealthMonitor({ latencyHighMs: 150, latencyLowMs: 80 });
    hm.evaluate([dev({ latencyMs: 200 })], 1); // spike
    expect(hm.evaluate([dev({ latencyMs: 120 })], 2)).toHaveLength(0); // between low and high → no event
    const rec = hm.evaluate([dev({ latencyMs: 60 })], 3); // below low → recovered
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatchObject({ type: 'latency_spike', severity: 'info' });
    // can spike again afterwards
    expect(hm.evaluate([dev({ latencyMs: 300 })], 4)).toHaveLength(1);
  });
});

describe('HealthMonitor packet loss', () => {
  it('emits a packet_loss warning on crossing up and clears below the low threshold', () => {
    const hm = new HealthMonitor({ lossHighPct: 0.05, lossLowPct: 0.02 });
    const loss = hm.evaluate([dev({ packetLoss: 0.08 })], 1);
    expect(loss).toHaveLength(1);
    expect(loss[0]).toMatchObject({ type: 'packet_loss', severity: 'warning' });
    expect(hm.evaluate([dev({ packetLoss: 0.03 })], 2)).toHaveLength(0); // hysteresis band
    const clear = hm.evaluate([dev({ packetLoss: 0.0 })], 3);
    expect(clear).toHaveLength(1);
    expect(clear[0].severity).toBe('info');
  });
});

describe('HealthMonitor edge cases', () => {
  it('ignores devices with no latency/loss metrics', () => {
    const hm = new HealthMonitor();
    expect(hm.evaluate([dev({})], 1)).toHaveLength(0);
  });

  it('drops state for a vanished device (no stale recovery on return)', () => {
    const hm = new HealthMonitor({ latencyHighMs: 150, latencyLowMs: 80 });
    hm.evaluate([dev({ latencyMs: 200 })], 1); // spike, now "high"
    hm.evaluate([], 2); // device gone → state cleared
    // device returns healthy: should NOT emit a recovery (state was cleared)
    expect(hm.evaluate([dev({ latencyMs: 40 })], 3)).toHaveLength(0);
  });
});

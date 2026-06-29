import { describe, it, expect } from 'vitest';
import { DataManager } from './DataManager.js';
import { NetworkSnapshot } from './models/types.js';

/** Minimal adapter returning one device with a controllable latency. */
function fakeAdapter(latencyMs: number) {
  return {
    name: 'fake',
    initialize: async () => {},
    destroy: async () => {},
    getStatus: () => ({ name: 'fake', connected: true, lastUpdate: 0, deviceCount: 1 }),
    fetchData: async () => ({
      devices: [{ id: 'gw', name: 'Gateway', type: 'gateway', online: true, latencyMs }],
      links: [],
      events: [],
    }),
  } as any;
}

function firstSnapshot(dm: DataManager): Promise<NetworkSnapshot> {
  return new Promise(resolve => {
    dm.on('update', (s: NetworkSnapshot) => resolve(s));
    dm.start();
  });
}

describe('DataManager + HealthMonitor wiring', () => {
  it('emits a latency_spike event for a high-latency device from any adapter', async () => {
    const dm = new DataManager([fakeAdapter(300)], {
      healthThresholds: { latencyHighMs: 150, latencyLowMs: 80 },
    });
    const snap = await firstSnapshot(dm);
    await dm.stop();
    expect(snap.events.some(e => e.type === 'latency_spike' && e.severity === 'warning')).toBe(true);
  });

  it('emits no health events for a healthy device', async () => {
    const dm = new DataManager([fakeAdapter(20)], {
      healthThresholds: { latencyHighMs: 150, latencyLowMs: 80 },
    });
    const snap = await firstSnapshot(dm);
    await dm.stop();
    expect(snap.events.some(e => e.type === 'latency_spike')).toBe(false);
  });
});

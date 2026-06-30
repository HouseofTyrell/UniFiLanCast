import { describe, it, expect } from 'vitest';
import { migrateSample } from './Store.js';

describe('migrateSample (rxBytes/txBytes → rxBps/txBps back-compat)', () => {
  it('maps legacy rate fields when the new ones are absent', () => {
    const old: any = {
      timestamp: 1,
      devices: [{ id: 'g', type: 'gateway', rxBytes: 8000, txBytes: 800 }],
      links: [],
      events: [],
      weather: {},
    };
    const m = migrateSample(old);
    expect(m.devices[0].rxBps).toBe(8000);
    expect(m.devices[0].txBps).toBe(800);
  });

  it('does not clobber already-migrated samples', () => {
    const cur: any = {
      timestamp: 1,
      devices: [{ id: 'g', type: 'gateway', rxBps: 5, txBps: 6, rxBytes: 999 }],
      links: [],
      events: [],
      weather: {},
    };
    expect(migrateSample(cur).devices[0].rxBps).toBe(5); // kept, not overwritten by rxBytes
  });

  it('tolerates a sample with no devices array', () => {
    expect(() => migrateSample({ timestamp: 1 })).not.toThrow();
  });
});

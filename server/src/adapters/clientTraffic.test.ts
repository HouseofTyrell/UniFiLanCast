import { describe, it, expect } from 'vitest';
import { resolveClientTraffic } from './clientTraffic.js';

describe('resolveClientTraffic', () => {
  it('uses legacy stat/sta rates and totals when a match exists', () => {
    const t = resolveClientTraffic(999, 999, {
      downRate: 8_000_000,
      upRate: 1_000_000,
      totalDown: 5_000_000_000,
      totalUp: 200_000_000,
    });
    expect(t).toEqual({
      rxBytes: 8_000_000, // download rate
      txBytes: 1_000_000, // upload rate
      totalRxBytes: 5_000_000_000,
      totalTxBytes: 200_000_000,
    });
  });

  it('never treats cumulative byte counters as a rate when there is no legacy match', () => {
    // raw cumulative tx=3 GB (download), rx=400 MB (upload)
    const t = resolveClientTraffic(3_000_000_000, 400_000_000);
    expect(t.rxBytes).toBe(0); // rate unknown, NOT the cumulative counter
    expect(t.txBytes).toBe(0);
    expect(t.totalRxBytes).toBe(3_000_000_000); // download total (client tx = download)
    expect(t.totalTxBytes).toBe(400_000_000); // upload total
  });

  it('defaults missing cumulative counters to zero', () => {
    expect(resolveClientTraffic(undefined, undefined)).toEqual({
      rxBytes: 0,
      txBytes: 0,
      totalRxBytes: 0,
      totalTxBytes: 0,
    });
  });
});

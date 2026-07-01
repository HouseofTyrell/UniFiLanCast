import { describe, it, expect } from 'vitest';
import { resolveClientTraffic, extractLegacyClientRate, deltaRate } from './clientTraffic.js';

describe('resolveClientTraffic', () => {
  it('uses legacy stat/sta rates and totals when a match exists', () => {
    const t = resolveClientTraffic(999, 999, {
      downRate: 8_000_000,
      upRate: 1_000_000,
      totalDown: 5_000_000_000,
      totalUp: 200_000_000,
    });
    expect(t).toEqual({
      rxBps: 8_000_000, // download rate
      txBps: 1_000_000, // upload rate
      totalRxBytes: 5_000_000_000,
      totalTxBytes: 200_000_000,
    });
  });

  it('never treats cumulative byte counters as a rate when there is no legacy match', () => {
    // raw cumulative tx=3 GB (download), rx=400 MB (upload)
    const t = resolveClientTraffic(3_000_000_000, 400_000_000);
    expect(t.rxBps).toBe(0); // rate unknown, NOT the cumulative counter
    expect(t.txBps).toBe(0);
    expect(t.totalRxBytes).toBe(3_000_000_000); // download total (client tx = download)
    expect(t.totalTxBytes).toBe(400_000_000); // upload total
  });

  it('defaults missing cumulative counters to zero', () => {
    expect(resolveClientTraffic(undefined, undefined)).toEqual({
      rxBps: 0,
      txBps: 0,
      totalRxBytes: 0,
      totalTxBytes: 0,
    });
  });
});

describe('extractLegacyClientRate', () => {
  it('reads bare keys for a wireless client (bytes/sec → bits/sec)', () => {
    const r = extractLegacyClientRate({
      'tx_bytes-r': 1000,
      'rx_bytes-r': 250,
      tx_bytes: 5_000_000_000,
      rx_bytes: 200_000_000,
    });
    expect(r).toEqual({
      downRate: 8000, // 1000 B/s × 8
      upRate: 2000, // 250 B/s × 8
      totalDown: 5_000_000_000,
      totalUp: 200_000_000,
    });
  });

  it('reads wired- prefixed keys for a wired client (the 7950x3d case)', () => {
    // Real payload shape: wired clients expose only `wired-` prefixed counters,
    // and the bare tx_bytes/rx_bytes come back null — previously read as 0.
    const r = extractLegacyClientRate({
      tx_bytes: null,
      rx_bytes: null,
      'tx_bytes-r': null,
      'rx_bytes-r': null,
      'wired-tx_bytes': 18_020_831_195,
      'wired-rx_bytes': 34_665_293_222,
      'wired-tx_bytes-r': 4671.79,
      'wired-rx_bytes-r': 599.86,
    });
    expect(r.totalDown).toBe(18_020_831_195);
    expect(r.totalUp).toBe(34_665_293_222);
    expect(r.downRate).toBeCloseTo(4671.79 * 8);
    expect(r.upRate).toBeCloseTo(599.86 * 8);
  });

  it('prefers bare keys over wired- when both are present', () => {
    const r = extractLegacyClientRate({
      tx_bytes: 100,
      'wired-tx_bytes': 999,
    });
    expect(r.totalDown).toBe(100);
  });

  it('returns zeros when no traffic fields are present', () => {
    expect(extractLegacyClientRate({ mac: 'aa:bb:cc:dd:ee:ff' })).toEqual({
      downRate: 0,
      upRate: 0,
      totalDown: 0,
      totalUp: 0,
    });
  });
});

describe('deltaRate', () => {
  it('derives bits/sec from cumulative counter deltas', () => {
    // +9 Mb of download bytes over 10s → 9 Mbps. (9e6 bits = 1.125e6 bytes)
    const prev = { rx: 1_000_000, tx: 500_000, t: 10_000 };
    const r = deltaRate(prev, 1_000_000 + 1_125_000, 500_000, 20_000);
    expect(r).not.toBeNull();
    expect(r!.rxBps).toBeCloseTo(900_000); // (1_125_000 bytes ×8) / 10s = 900 Kbps
    expect(r!.txBps).toBe(0);
  });

  it('returns null with no prior sample (caller keeps the reported rate)', () => {
    expect(deltaRate(undefined, 100, 100, 5000)).toBeNull();
  });

  it('returns null on a counter reset instead of a bogus spike', () => {
    const prev = { rx: 5_000_000_000, tx: 1_000_000_000, t: 0 };
    expect(deltaRate(prev, 10_000, 0, 5000)).toBeNull(); // rx dropped → reconnect
  });

  it('ignores intervals shorter than the floor', () => {
    const prev = { rx: 0, tx: 0, t: 1000 };
    expect(deltaRate(prev, 1_000_000, 0, 1500)).toBeNull(); // 500ms < 1500ms
  });
});

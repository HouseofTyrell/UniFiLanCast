import { describe, it, expect } from 'vitest';
import { formatBitrate, formatBitrateStr, formatBytes } from './format';

describe('formatBitrate', () => {
  it('scales bits/sec across units', () => {
    expect(formatBitrate(500)).toEqual({ value: '500', unit: 'bps' });
    expect(formatBitrate(8_000)).toEqual({ value: '8.0', unit: 'Kbps' });
    expect(formatBitrate(8_000_000)).toEqual({ value: '8.0', unit: 'Mbps' });
    expect(formatBitrate(2_000_000_000)).toEqual({ value: '2.00', unit: 'Gbps' });
  });

  it('clamps negatives to zero', () => {
    expect(formatBitrate(-5)).toEqual({ value: '0', unit: 'bps' });
  });

  it('formatBitrateStr joins value and unit', () => {
    expect(formatBitrateStr(8_000_000)).toBe('8.0 Mbps');
  });
});

describe('formatBytes', () => {
  it('formats decimal byte volumes', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(1500)).toBe('1.50 KB');
    expect(formatBytes(2_000_000)).toBe('2.00 MB');
    expect(formatBytes(5_000_000_000)).toBe('5.00 GB');
  });

  it('clamps negatives to zero', () => {
    expect(formatBytes(-1)).toBe('0 B');
  });
});

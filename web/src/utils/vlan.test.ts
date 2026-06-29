import { describe, it, expect } from 'vitest';
import { vlanColor } from './vlan';

describe('vlanColor', () => {
  it('assigns distinct colors to distinct VLANs (no modulo collision)', () => {
    const c10 = vlanColor(10);
    const c20 = vlanColor(20);
    const c30 = vlanColor(30);
    expect(new Set([c10, c20, c30]).size).toBe(3);
  });

  it('is stable for the same VLAN id', () => {
    expect(vlanColor(40)).toBe(vlanColor(40));
  });

  it('returns a hex color string', () => {
    expect(vlanColor(50)).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

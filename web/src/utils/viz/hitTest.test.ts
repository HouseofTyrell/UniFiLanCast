import { describe, it, expect } from 'vitest';
import { pickNodeAt } from './hitTest';

const pts = [
  { id: 'gw', x: 100, y: 100, radius: 24 },
  { id: 'c1', x: 300, y: 300, radius: 4 }, // tiny dot
];

describe('pickNodeAt', () => {
  it('hits a node within its radius', () => {
    expect(pickNodeAt(pts, 110, 105)).toBe('gw');
  });
  it('returns null when the point is outside every node', () => {
    expect(pickNodeAt(pts, 500, 500)).toBeNull();
  });
  it('pads small dots to a minimum hit radius', () => {
    // 7px away from c1 (radius 4) — only hits because of the 9px minimum
    expect(pickNodeAt(pts, 307, 300)).toBe('c1');
  });
  it('returns the nearest node when two overlap', () => {
    const overlap = [
      { id: 'a', x: 0, y: 0, radius: 50 },
      { id: 'b', x: 10, y: 0, radius: 50 },
    ];
    expect(pickNodeAt(overlap, 9, 0)).toBe('b'); // closer to b
  });
});

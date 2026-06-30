import { describe, it, expect } from 'vitest';
import { reconnectDelay } from './backoff';

describe('reconnectDelay', () => {
  const noJitter = { rand: () => 0.5 }; // 0.5 → jitter term = 0

  it('grows exponentially from the base', () => {
    expect(reconnectDelay(0, noJitter)).toBe(1000);
    expect(reconnectDelay(1, noJitter)).toBe(2000);
    expect(reconnectDelay(2, noJitter)).toBe(4000);
    expect(reconnectDelay(3, noJitter)).toBe(8000);
  });

  it('caps the delay', () => {
    expect(reconnectDelay(20, noJitter)).toBe(30000);
  });

  it('applies bounded jitter (±25%) and never goes below the base', () => {
    const lo = reconnectDelay(2, { rand: () => 0 }); // -25% → 3000
    const hi = reconnectDelay(2, { rand: () => 1 }); // +25% → 5000
    expect(lo).toBe(3000);
    expect(hi).toBe(5000);
    expect(reconnectDelay(0, { rand: () => 0 })).toBeGreaterThanOrEqual(1000);
  });
});

import { describe, it, expect } from 'vitest';
import { mapWithConcurrency } from './concurrency.js';

const tick = () => new Promise(r => setTimeout(r, 5));

describe('mapWithConcurrency', () => {
  it('preserves input order in the results', async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async n => {
      await tick();
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });

  it('never runs more than `limit` workers at once', async () => {
    let active = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      active++;
      peak = Math.max(peak, active);
      await tick();
      active--;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1); // actually ran concurrently
  });

  it('passes the index to the worker', async () => {
    const out = await mapWithConcurrency(['a', 'b', 'c'], 2, async (item, i) => `${i}:${item}`);
    expect(out).toEqual(['0:a', '1:b', '2:c']);
  });

  it('handles an empty list', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });

  it('works when the limit exceeds the item count', async () => {
    const out = await mapWithConcurrency([1, 2], 10, async n => n + 1);
    expect(out).toEqual([2, 3]);
  });
});

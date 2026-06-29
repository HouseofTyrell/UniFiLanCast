/**
 * Map over `items` running at most `limit` async workers at once, preserving
 * input order in the results. Bounds the load placed on an upstream API (here,
 * the UniFi controller) instead of firing one request per device sequentially
 * or all at once.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  if (items.length === 0) return results;
  let next = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

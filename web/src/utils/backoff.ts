/**
 * Reconnect delay (ms) with capped exponential backoff + jitter. Attempt 0 is
 * the first retry. Jitter (±25%) spreads reconnect storms when many clients
 * drop at once. `rand` is injectable for deterministic tests.
 */
export function reconnectDelay(
  attempt: number,
  opts: { baseMs?: number; capMs?: number; rand?: () => number } = {}
): number {
  const base = opts.baseMs ?? 1000;
  const cap = opts.capMs ?? 30000;
  const rand = opts.rand ?? Math.random;
  const exp = Math.min(cap, base * 2 ** Math.max(0, attempt));
  const jitter = exp * 0.25 * (rand() * 2 - 1); // ±25%
  return Math.max(base, Math.round(exp + jitter));
}

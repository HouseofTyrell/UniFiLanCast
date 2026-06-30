import { Device, DeviceType } from '../../types';

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Normalize a rate (bits/sec) to 0..1 on a log scale (~50Kbps..~50Mbps). */
export function rateLevel(bps: number): number {
  if (bps <= 0) return 0;
  const lo = Math.log10(50_000);
  const hi = Math.log10(50_000_000);
  return clamp01((Math.log10(bps) - lo) / (hi - lo));
}

/**
 * Normalize a device's windowed usage (bytes) to 0..1 relative to its tier's
 * busiest device. Spans ~2.5 decades below the max but always keeps a real
 * range so a small max doesn't collapse every node to idle (lo stays < hi).
 */
export function usageScale(bytes: number, max: number): number {
  if (bytes <= 0 || max <= 0) return 0;
  const hi = Math.log10(max);
  const lo = Math.min(hi - 0.5, Math.log10(Math.max(1, max * 0.003)));
  return clamp01((Math.log10(bytes) - lo) / (hi - lo));
}

/**
 * Busiest total usage among clients and among (non-gateway) infrastructure, so
 * each tier is scaled against its own peers.
 */
export function tierMaxUsage(
  usageMap: Record<string, { down: number; up: number }>,
  typeOf: (id: string) => DeviceType | undefined
): { client: number; infra: number } {
  let client = 0;
  let infra = 0;
  for (const [id, u] of Object.entries(usageMap)) {
    const total = (u.down || 0) + (u.up || 0);
    const type = typeOf(id);
    if (type === 'client') client = Math.max(client, total);
    else if (type && type !== 'gateway') infra = Math.max(infra, total);
  }
  return { client, infra };
}

/** Render radius for a device given its activity level (0..1). */
export function nodeRadius(type: Device['type'], activity: number): number {
  switch (type) {
    case 'gateway':
      return 24; // WAN anchor stays prominent
    case 'switch':
    case 'ap':
      return 11 + activity * 11; // idle infra recedes, busy grows
    case 'client':
      return 5 + activity * 16; // idle ~5px dots, busiest ~21px
    default:
      return 12 + activity * 8;
  }
}

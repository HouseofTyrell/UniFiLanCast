export interface HitPoint {
  x: number;
  y: number;
  radius: number;
  id: string;
}

/**
 * Return the id of the nearest node whose (padded) radius contains the point,
 * or null. Small dots get a minimum hit radius so they're still clickable.
 */
export function pickNodeAt(
  points: Iterable<HitPoint>,
  x: number,
  y: number,
  minRadius = 9
): string | null {
  let best: { id: string; d: number } | null = null;
  for (const p of points) {
    const d = Math.hypot(x - p.x, y - p.y);
    const hit = Math.max(p.radius, minRadius);
    if (d <= hit && (!best || d < best.d)) best = { id: p.id, d };
  }
  return best ? best.id : null;
}

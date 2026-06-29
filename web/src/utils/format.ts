/**
 * Format a throughput rate (bits per second) into a human-readable bitrate.
 * The adapter normalizes all device + client rates to bits/sec, so this just
 * scales to bps/Kbps/Mbps/Gbps.
 */
export function formatBitrate(bitsPerSec: number): { value: string; unit: string } {
  const bps = Math.max(0, bitsPerSec);
  if (bps < 1000) return { value: bps.toFixed(0), unit: 'bps' };
  if (bps < 1_000_000) return { value: (bps / 1000).toFixed(bps < 100_000 ? 1 : 0), unit: 'Kbps' };
  if (bps < 1_000_000_000) return { value: (bps / 1_000_000).toFixed(bps < 100_000_000 ? 1 : 0), unit: 'Mbps' };
  return { value: (bps / 1_000_000_000).toFixed(2), unit: 'Gbps' };
}

/** Single-string convenience form, e.g. "24.3 Mbps". */
export function formatBitrateStr(bitsPerSec: number): string {
  const { value, unit } = formatBitrate(bitsPerSec);
  return `${value} ${unit}`;
}

/** Format a data volume (bytes) as B/KB/MB/GB/TB (decimal). */
export function formatBytes(bytes: number): string {
  const b = Math.max(0, bytes);
  if (b < 1000) return `${b.toFixed(0)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = b / 1000;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0)} ${units[i]}`;
}

/** Compact relative duration since an epoch-ms timestamp, e.g. "3d 4h". */
export function formatSince(epochMs: number): string {
  const secs = Math.max(0, (Date.now() - epochMs) / 1000);
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

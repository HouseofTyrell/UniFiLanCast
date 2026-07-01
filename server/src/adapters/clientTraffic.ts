/**
 * Resolve a client's traffic fields with correct, unambiguous units.
 *
 * The Integration API `/clients` payload exposes only **cumulative** byte
 * counters (`tx_bytes`/`rx_bytes`), never an instantaneous rate. The legacy
 * `stat/sta` endpoint provides real per-client rates (already converted to
 * bits/sec and direction-normalized by the caller). So:
 *
 *  - When a legacy match exists, use its rates and totals.
 *  - Otherwise the rate is **unknown → 0** (never the cumulative counter), and
 *    the cumulative bytes are kept as session totals.
 *
 * Direction convention (matches the legacy path): for a client, the controller's
 * `tx_bytes` is the **download** (AP→client), so it maps to rx/total-rx.
 *
 * `rxBytes`/`txBytes` here are RATES (bits/sec); `totalRxBytes`/`totalTxBytes`
 * are cumulative bytes.
 */
export interface LegacyClientRate {
  downRate: number; // bits/sec
  upRate: number; // bits/sec
  totalDown: number; // bytes
  totalUp: number; // bytes
}

export interface ClientTraffic {
  rxBps: number; // download rate, bits/sec
  txBps: number; // upload rate, bits/sec
  totalRxBytes: number; // cumulative download bytes
  totalTxBytes: number; // cumulative upload bytes
}

/**
 * Pull a client's rates + cumulative totals out of a raw legacy `stat/sta`
 * record. The controller reports these under bare keys for WIRELESS clients
 * (`tx_bytes`, `tx_bytes-r`, …) but under a `wired-` prefix for WIRED clients
 * (`wired-tx_bytes`, `wired-tx_bytes-r`, …). We accept either so a wired PC
 * doesn't read as zero activity. The `-r` rate fields are BYTES/sec → ×8 to
 * bits/sec. Direction: infra `tx` = sent to client = the client's DOWNLOAD.
 */
export function extractLegacyClientRate(raw: any): LegacyClientRate {
  const num = (keys: string[]): number => {
    for (const key of keys) {
      const v = raw?.[key];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    }
    return 0;
  };
  return {
    downRate: num(['tx_bytes-r', 'wired-tx_bytes-r']) * 8,
    upRate: num(['rx_bytes-r', 'wired-rx_bytes-r']) * 8,
    totalDown: num(['tx_bytes', 'wired-tx_bytes']),
    totalUp: num(['rx_bytes', 'wired-rx_bytes']),
  };
}

export interface RateSample {
  rx: number; // cumulative download bytes at time t
  tx: number; // cumulative upload bytes at time t
  t: number; // epoch ms
}

/**
 * Instantaneous rate (bits/sec) from the change in cumulative byte counters
 * between two samples — far more reliable than UniFi's coarse, laggy `*-r`
 * fields. Returns null when there's no usable prior sample so the caller can
 * fall back to the controller-reported rate. Guards counter resets (a device
 * reconnect zeroes the counters) and intervals too short to be meaningful.
 */
export function deltaRate(
  prev: RateSample | undefined,
  rx: number,
  tx: number,
  now: number,
  minMs = 1500
): { rxBps: number; txBps: number } | null {
  if (!prev) return null;
  const dtMs = now - prev.t;
  if (dtMs < minMs) return null;
  const drx = rx - prev.rx;
  const dtx = tx - prev.tx;
  if (drx < 0 || dtx < 0) return null; // counter reset — don't emit a garbage spike
  const dt = dtMs / 1000;
  return { rxBps: (drx * 8) / dt, txBps: (dtx * 8) / dt };
}

export function resolveClientTraffic(
  rawCumulativeTx: number | undefined,
  rawCumulativeRx: number | undefined,
  legacy?: LegacyClientRate
): ClientTraffic {
  if (legacy) {
    return {
      rxBps: legacy.downRate,
      txBps: legacy.upRate,
      totalRxBytes: legacy.totalDown,
      totalTxBytes: legacy.totalUp,
    };
  }
  return {
    rxBps: 0,
    txBps: 0,
    totalRxBytes: rawCumulativeTx ?? 0, // client tx = download
    totalTxBytes: rawCumulativeRx ?? 0,
  };
}

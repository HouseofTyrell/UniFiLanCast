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

import { execFile } from 'child_process';
import { logger } from './utils/logger.js';

export interface PingResult {
  latencyMs?: number; // average RTT
  lossPct?: number; // fraction 0..1
}

/**
 * Parse `ping` summary output (BSD/macOS, iputils/Linux, or busybox/alpine).
 * Pure + tolerant: returns whatever it can find.
 *  - "X% packet loss"               → lossPct
 *  - "... = min/avg/max[/mdev] ms"  → latencyMs (the avg)
 */
export function parsePing(output: string): PingResult {
  const result: PingResult = {};
  const loss = output.match(/([\d.]+)\s*%\s*packet loss/i);
  if (loss) result.lossPct = Math.min(1, Math.max(0, parseFloat(loss[1]) / 100));
  // min/avg/max[/mdev|/stddev] — capture the second number (avg).
  const rtt = output.match(/=\s*[\d.]+\/([\d.]+)\/[\d.]+/);
  if (rtt) result.latencyMs = parseFloat(rtt[1]);
  return result;
}

const VALID_TARGET = /^[a-zA-Z0-9._:-]+$/;

/**
 * Periodically pings a target and caches the latest latency/loss. Uses the
 * system `ping` via execFile (no shell → no injection) so it works without raw
 * sockets/root. DataManager attributes the result to the gateway each capture.
 */
export class PingProbe {
  private latest?: PingResult;
  private timer?: NodeJS.Timeout;
  private readonly target: string;
  private readonly intervalMs: number;
  private readonly count: number;

  constructor(target = '1.1.1.1', intervalMs = 15000, count = 4) {
    this.target = VALID_TARGET.test(target) ? target : '1.1.1.1';
    if (this.target !== target) {
      logger.warn({ target }, 'Invalid ping target — falling back to 1.1.1.1');
    }
    this.intervalMs = Math.max(3000, intervalMs);
    this.count = Math.max(1, Math.min(10, count));
  }

  start(): void {
    if (this.timer) return;
    this.run();
    this.timer = setInterval(() => this.run(), this.intervalMs);
    logger.info({ target: this.target, intervalMs: this.intervalMs }, 'WAN ping probe started');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  getLatest(): PingResult | undefined {
    return this.latest;
  }

  private run(): void {
    execFile('ping', ['-c', String(this.count), this.target], { timeout: 12000 }, (err, stdout) => {
      const out = stdout || '';
      // Only trust results when ping actually produced a summary. If the binary
      // is missing/blocked or output is empty, skip rather than fabricating
      // 100% loss (which would fire false alerts in offline/ICMP-blocked envs).
      const ran = /packets? transmitted|packet loss|statistics/i.test(out);
      if (!ran) {
        logger.debug({ err: err?.message }, 'ping produced no summary; skipping this cycle');
        return;
      }
      // ping ran: a parsed "100% packet loss" is a genuine unreachable target.
      this.latest = parsePing(out);
    });
  }
}

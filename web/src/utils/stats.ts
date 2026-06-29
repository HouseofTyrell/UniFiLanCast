import { NetworkSnapshot, Device } from '../types';

export interface TopTalker {
  device: Device;
  rate: number; // tx + rx, bits/sec
}

export interface NetworkStats {
  /** WAN throughput from the gateway uplink (bits/sec). */
  wanDown: number;
  wanUp: number;
  /** Total throughput across all devices (bits/sec). */
  totalThroughput: number;
  deviceCount: number;
  infraCount: number;
  clientCount: number;
  onlineCount: number;
  offlineCount: number;
  wifiCount: number;
  topTalkers: TopTalker[];
}

const EMPTY: NetworkStats = {
  wanDown: 0,
  wanUp: 0,
  totalThroughput: 0,
  deviceCount: 0,
  infraCount: 0,
  clientCount: 0,
  onlineCount: 0,
  offlineCount: 0,
  wifiCount: 0,
  topTalkers: [],
};

/** Derive headline bandwidth/health stats from a snapshot. */
export function computeStats(snapshot: NetworkSnapshot | null): NetworkStats {
  if (!snapshot) return EMPTY;
  const { devices } = snapshot;

  const gateway = devices.find(d => d.type === 'gateway');
  // Gateway uplink: rx = inbound from WAN (download), tx = outbound (upload).
  const wanDown = gateway?.rxBytes ?? 0;
  const wanUp = gateway?.txBytes ?? 0;

  let totalThroughput = 0;
  let infraCount = 0;
  let clientCount = 0;
  let onlineCount = 0;
  let offlineCount = 0;
  let wifiCount = 0;

  const talkers: TopTalker[] = [];
  for (const d of devices) {
    if (d.type === 'client') clientCount++;
    else infraCount++;
    if (d.online) onlineCount++;
    else offlineCount++;
    if (d.wiredOrWifi === 'wifi') wifiCount++;

    // The gateway's throughput is the WAN (already shown in the header), so
    // exclude it from LAN top-talkers and the total to avoid double-counting.
    const rate = (d.txBytes ?? 0) + (d.rxBytes ?? 0);
    if (d.type !== 'gateway') {
      totalThroughput += rate;
      if (rate > 0) talkers.push({ device: d, rate });
    }
  }

  talkers.sort((a, b) => b.rate - a.rate);

  return {
    wanDown,
    wanUp,
    totalThroughput,
    deviceCount: devices.length,
    infraCount,
    clientCount,
    onlineCount,
    offlineCount,
    wifiCount,
    topTalkers: talkers.slice(0, 6),
  };
}

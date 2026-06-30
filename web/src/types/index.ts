export type DeviceType = 'gateway' | 'switch' | 'ap' | 'client' | 'server' | 'unknown';

export interface Device {
  id: string;
  name: string;
  type: DeviceType;
  mac?: string;
  ip?: string;
  parentDeviceId?: string;
  uplinkPort?: string;
  wiredOrWifi: 'wired' | 'wifi' | 'unknown';
  siteId: string;
  vlanId?: number;
  ssid?: string;
  rssi?: number;
  txBps: number;
  rxBps: number;
  lastSeen: number;
  online: boolean;
  latencyMs?: number;
  jitterMs?: number;
  packetLoss?: number;
  cpuPct?: number;
  memPct?: number;
  loadAvg?: number;
  totalRxBytes?: number;
  totalTxBytes?: number;
  connectedSince?: number;
  experience?: number;
  vendor?: string;
  osName?: string;
  channel?: number;
  network?: string;
}

export type LinkKind = 'uplink' | 'client' | 'gateway';

export interface Link {
  fromId: string;
  toId: string;
  kind: LinkKind;
  utilizationScore: number;
  healthScore: number;
  lastChangeTs: number;
}

export type EventSeverity = 'info' | 'warning' | 'error';
export type EventType = 'new_device' | 'offline' | 'latency_spike' | 'wan_issue' | 'device_reconnect';

export interface NetworkEvent {
  ts: number;
  severity: EventSeverity;
  type: EventType;
  message: string;
  relatedIds: string[];
}

export interface WeatherSignals {
  stormIntensity: Record<string, number>;
  fogLevel: Record<string, number>;
  heat: Record<string, number>;
  lightningEvents: Array<{
    linkId: string;
    deviceId: string;
    ts: number;
  }>;
}

export interface NetworkSnapshot {
  timestamp: number;
  devices: Device[];
  links: Link[];
  events: NetworkEvent[];
  weather: WeatherSignals;
}

export interface AdapterStatus {
  name: string;
  connected: boolean;
  lastUpdate: number;
  error?: string;
  deviceCount: number;
  /** Resolved active site name (single-site mode). */
  site?: string;
}

export interface HistorySample {
  timestamp: number;
  devices: Device[];
  links: Link[];
  events: NetworkEvent[];
  weather: WeatherSignals;
}

export interface VisualizationNode {
  device: Device;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  targetX?: number;
  targetY?: number;
}

export interface Filter {
  wiredOnly: boolean;
  wifiOnly: boolean;
  issuesOnly: boolean;
  search: string;
}

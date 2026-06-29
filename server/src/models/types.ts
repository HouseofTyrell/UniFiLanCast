/**
 * Core data models for Network Weather Map
 */

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
  txBytes: number;
  rxBytes: number;
  lastSeen: number;
  online: boolean;
  latencyMs?: number;
  jitterMs?: number;
  packetLoss?: number;
  /** Device CPU utilization, 0..100. */
  cpuPct?: number;
  /** Device memory utilization, 0..100. */
  memPct?: number;
  /** 1-minute load average. */
  loadAvg?: number;
  /** Cumulative bytes downloaded this session (inbound). */
  totalRxBytes?: number;
  /** Cumulative bytes uploaded this session (outbound). */
  totalTxBytes?: number;
  /** When this device/client connected (epoch ms). */
  connectedSince?: number;
  /** Experience / satisfaction score, 0..100. */
  experience?: number;
  /** Vendor (from MAC OUI). */
  vendor?: string;
  /** Reported OS name, if known. */
  osName?: string;
  /** WiFi channel. */
  channel?: number;
  /** Network/VLAN name (e.g. "Trusted"). */
  network?: string;
}

export type LinkKind = 'uplink' | 'client' | 'gateway';

export interface Link {
  fromId: string;
  toId: string;
  kind: LinkKind;
  utilizationScore: number; // 0..1
  healthScore: number; // 0..1
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
  stormIntensity: Record<string, number>; // linkId -> 0..1
  fogLevel: Record<string, number>; // deviceId -> 0..1
  heat: Record<string, number>; // deviceId -> 0..1
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
}

export interface HistorySample {
  timestamp: number;
  devices: Device[];
  links: Link[];
  events: NetworkEvent[];
  weather: WeatherSignals;
}

/**
 * Configuration types
 */
export interface Config {
  adapters: {
    mock?: {
      enabled: boolean;
      deviceCount?: number;
    };
    siteManager?: {
      enabled: boolean;
      apiKey: string;
      pollingInterval?: number;
    };
    localNetwork?: {
      enabled: boolean;
      baseUrl: string;
      username: string;
      password: string;
      pollingInterval?: number;
      useProxyPrefix?: boolean;
      verifySsl?: boolean;
    };
    integrationApi?: {
      enabled: boolean;
      baseUrl: string;
      /** API key. If omitted, read from the env var named by apiKeyEnv. */
      apiKey?: string;
      /** Name of the env var holding the API key (default: UNIFI_API_KEY). */
      apiKeyEnv?: string;
      /** Restrict to a single site id; if omitted, all visible sites are polled. */
      siteId?: string;
      pollingInterval?: number;
      verifySsl?: boolean;
    };
  };
  server: {
    port: number;
    historyRetentionMinutes: number;
    logLevel: string;
    /** Directory for the SQLite store (default: <repo>/data). */
    dataDir?: string;
    /**
     * Interface to bind. Defaults to 127.0.0.1 (loopback only). Set to
     * '0.0.0.0' to expose on the LAN — strongly recommended only with
     * auth.enabled = true.
     */
    host?: string;
  };
  auth?: {
    enabled: boolean;
    username: string;
    /** Password. If omitted, read from the env var named by passwordEnv. */
    password?: string;
    passwordEnv?: string;
  };
  alerts?: {
    enabled: boolean;
    /** Webhook URL. If omitted, read from the env var named by webhookEnv. */
    webhookUrl?: string;
    webhookEnv?: string;
    format?: 'auto' | 'discord' | 'slack' | 'json';
    throttleSeconds?: number;
    minSeverity?: EventSeverity;
    rules?: {
      newDevice?: boolean;
      deviceOffline?: boolean;
      latencySpike?: boolean;
      packetLoss?: boolean;
      wanIssue?: boolean;
    };
  };
}

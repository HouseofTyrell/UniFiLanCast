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
  };
  server: {
    port: number;
    historyRetentionMinutes: number;
    logLevel: string;
  };
}

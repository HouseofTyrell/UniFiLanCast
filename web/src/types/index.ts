// Domain contracts are owned by the server (single source of truth) and
// re-exported here, so the server and web can't silently drift — a server-side
// contract change now surfaces as a type error in the web build.
export type {
  DeviceType,
  Device,
  LinkKind,
  Link,
  EventSeverity,
  EventType,
  NetworkEvent,
  WeatherSignals,
  NetworkSnapshot,
  AdapterStatus,
  HistorySample,
} from '../../../server/src/models/types';

import type { Device } from '../../../server/src/models/types';

// --- Web-only view models (not part of the shared contract) ------------------

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

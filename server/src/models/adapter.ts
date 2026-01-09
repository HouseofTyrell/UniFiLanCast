import { Device, Link, NetworkEvent, AdapterStatus } from './types.js';

/**
 * Base adapter interface for network data sources
 */
export interface NetworkAdapter {
  name: string;

  /**
   * Initialize the adapter (authenticate, validate config, etc.)
   */
  initialize(): Promise<void>;

  /**
   * Fetch current network state
   */
  fetchData(): Promise<{
    devices: Device[];
    links: Link[];
    events: NetworkEvent[];
  }>;

  /**
   * Get adapter status
   */
  getStatus(): AdapterStatus;

  /**
   * Clean up resources
   */
  destroy(): Promise<void>;
}

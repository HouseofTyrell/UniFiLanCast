import axios, { AxiosInstance } from 'axios';
import { NetworkAdapter } from '../models/adapter.js';
import {
  Device,
  Link,
  NetworkEvent,
  AdapterStatus,
  DeviceType,
} from '../models/types.js';
import { logger } from '../utils/logger.js';

interface SiteManagerConfig {
  apiKey: string;
  pollingInterval?: number;
}

/**
 * Adapter for UniFi Site Manager API (cloud, read-only)
 */
export class SiteManagerAdapter implements NetworkAdapter {
  name = 'site-manager';
  private client: AxiosInstance;
  private lastUpdate = 0;
  private isConnected = false;
  private lastError?: string;
  private deviceCache: Device[] = [];

  constructor(private config: SiteManagerConfig) {
    this.client = axios.create({
      baseURL: 'https://api.ui.com',
      headers: {
        'X-API-KEY': config.apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });
  }

  async initialize(): Promise<void> {
    logger.info('Initializing Site Manager adapter...');

    try {
      // Test connection by listing hosts
      const response = await this.client.get('/ea/hosts');
      this.isConnected = true;
      this.lastError = undefined;
      logger.info('Site Manager adapter initialized successfully');
    } catch (error) {
      this.isConnected = false;
      this.lastError = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error }, 'Failed to initialize Site Manager adapter');
      throw error;
    }
  }

  async fetchData(): Promise<{
    devices: Device[];
    links: Link[];
    events: NetworkEvent[];
  }> {
    const now = Date.now();
    const devices: Device[] = [];
    const links: Link[] = [];
    const events: NetworkEvent[] = [];

    try {
      // Fetch hosts
      const hostsResponse = await this.client.get('/ea/hosts');
      const hosts = hostsResponse.data.data || [];

      // Fetch devices for each host
      for (const host of hosts) {
        try {
          const devicesResponse = await this.client.get(
            `/ea/hosts/${host.id}/devices`
          );
          const hostDevices = devicesResponse.data.data || [];

          for (const rawDevice of hostDevices) {
            const device = this.normalizeDevice(rawDevice, host.id);
            devices.push(device);

            // Check for state changes
            const cached = this.deviceCache.find(d => d.id === device.id);
            if (cached && cached.online !== device.online) {
              events.push({
                ts: now,
                severity: device.online ? 'info' : 'warning',
                type: device.online ? 'device_reconnect' : 'offline',
                message: `${device.name} ${device.online ? 'came online' : 'went offline'}`,
                relatedIds: [device.id],
              });
            } else if (!cached) {
              events.push({
                ts: now,
                severity: 'info',
                type: 'new_device',
                message: `New device discovered: ${device.name}`,
                relatedIds: [device.id],
              });
            }
          }

          // Fetch ISP metrics if available
          try {
            const ispResponse = await this.client.get(
              `/ea/hosts/${host.id}/isp/metrics`
            );
            const ispMetrics = ispResponse.data.data;

            if (ispMetrics?.latency) {
              // Find gateway device and update latency
              const gateway = devices.find(
                d => d.type === 'gateway' && d.siteId === host.id
              );
              if (gateway) {
                gateway.latencyMs = ispMetrics.latency;
              }
            }
          } catch (error) {
            // ISP metrics may not be available for all hosts
            logger.debug({ hostId: host.id }, 'ISP metrics not available');
          }
        } catch (error) {
          logger.warn({ hostId: host.id, error }, 'Failed to fetch devices for host');
        }
      }

      // Build links based on device hierarchy
      for (const device of devices) {
        if (device.parentDeviceId) {
          links.push({
            fromId: device.parentDeviceId,
            toId: device.id,
            kind: device.type === 'client' ? 'client' : 'uplink',
            utilizationScore: this.calculateUtilization(device),
            healthScore: device.online ? 1 : 0,
            lastChangeTs: now,
          });
        }
      }

      this.deviceCache = devices;
      this.lastUpdate = now;
      this.isConnected = true;
      this.lastError = undefined;

      return { devices, links, events };
    } catch (error) {
      this.isConnected = false;
      this.lastError = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error }, 'Failed to fetch data from Site Manager');

      // Return cached data if available
      return {
        devices: this.deviceCache,
        links: [],
        events: [
          {
            ts: now,
            severity: 'error',
            type: 'wan_issue',
            message: `Site Manager API error: ${this.lastError}`,
            relatedIds: [],
          },
        ],
      };
    }
  }

  getStatus(): AdapterStatus {
    return {
      name: this.name,
      connected: this.isConnected,
      lastUpdate: this.lastUpdate,
      error: this.lastError,
      deviceCount: this.deviceCache.length,
    };
  }

  async destroy(): Promise<void> {
    logger.info('Site Manager adapter destroyed');
  }

  private normalizeDevice(raw: any, siteId: string): Device {
    return {
      id: raw.id || raw.mac,
      name: raw.name || raw.hostname || raw.mac || 'Unknown',
      type: this.mapDeviceType(raw.type),
      mac: raw.mac,
      ip: raw.ip,
      parentDeviceId: raw.uplink_device_id,
      uplinkPort: raw.uplink_port,
      wiredOrWifi: raw.is_wired ? 'wired' : 'wifi',
      siteId,
      vlanId: raw.vlan,
      ssid: raw.essid,
      rssi: raw.rssi,
      txBps: raw.tx_bytes || 0,
      rxBps: raw.rx_bytes || 0,
      lastSeen: raw.last_seen ? raw.last_seen * 1000 : Date.now(),
      online: raw.state === 1 || raw.state === 'connected',
      latencyMs: raw.latency,
    };
  }

  private mapDeviceType(rawType: string): DeviceType {
    const type = (rawType || '').toLowerCase();
    if (type.includes('gateway') || type.includes('udm') || type.includes('usg')) {
      return 'gateway';
    }
    if (type.includes('switch') || type.includes('usw')) {
      return 'switch';
    }
    if (type.includes('ap') || type.includes('uap')) {
      return 'ap';
    }
    if (type.includes('client')) {
      return 'client';
    }
    return 'unknown';
  }

  private calculateUtilization(device: Device): number {
    const totalBytes = device.txBps + device.rxBps;
    // Normalize to 0-1 (1Gbps = full)
    return Math.min(1, totalBytes / (1024 * 1024 * 1024));
  }
}

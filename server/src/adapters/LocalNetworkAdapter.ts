import axios, { AxiosInstance } from 'axios';
import https from 'https';
import { NetworkAdapter } from '../models/adapter.js';
import {
  Device,
  Link,
  NetworkEvent,
  AdapterStatus,
  DeviceType,
} from '../models/types.js';
import { logger } from '../utils/logger.js';

interface LocalNetworkConfig {
  baseUrl: string;
  username: string;
  password: string;
  pollingInterval?: number;
  useProxyPrefix?: boolean;
  verifySsl?: boolean;
}

/**
 * Adapter for local UniFi Network Application API
 */
export class LocalNetworkAdapter implements NetworkAdapter {
  name = 'local-network';
  private client: AxiosInstance;
  private lastUpdate = 0;
  private isConnected = false;
  private lastError?: string;
  private deviceCache: Device[] = [];
  private authCookie?: string;
  private useProxyPrefix: boolean;

  constructor(private config: LocalNetworkConfig) {
    this.useProxyPrefix = config.useProxyPrefix ?? true;

    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: 10000,
      httpsAgent: new https.Agent({
        rejectUnauthorized: config.verifySsl ?? false,
      }),
    });
  }

  async initialize(): Promise<void> {
    logger.info('Initializing Local Network adapter...');

    try {
      await this.authenticate();
      this.isConnected = true;
      this.lastError = undefined;
      logger.info('Local Network adapter initialized successfully');
    } catch (error) {
      this.isConnected = false;
      this.lastError = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error }, 'Failed to initialize Local Network adapter');
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
      // Re-authenticate if needed
      if (!this.authCookie) {
        await this.authenticate();
      }

      const apiPrefix = this.useProxyPrefix ? '/proxy/network' : '';

      // Fetch sites
      const sitesResponse = await this.apiRequest('get', `${apiPrefix}/api/self/sites`);
      const sites = sitesResponse.data?.data || [];

      for (const site of sites) {
        const siteName = site.name || 'default';

        try {
          // Fetch devices
          const devicesResponse = await this.apiRequest(
            'get',
            `${apiPrefix}/api/s/${siteName}/stat/device`
          );
          const rawDevices = devicesResponse.data?.data || [];

          for (const rawDevice of rawDevices) {
            const device = this.normalizeDevice(rawDevice, site._id || siteName);
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

          // Fetch active clients
          const clientsResponse = await this.apiRequest(
            'get',
            `${apiPrefix}/api/s/${siteName}/stat/sta`
          );
          const rawClients = clientsResponse.data?.data || [];

          for (const rawClient of rawClients) {
            const client = this.normalizeClient(rawClient, site._id || siteName);
            devices.push(client);

            const cached = this.deviceCache.find(d => d.id === client.id);
            if (!cached) {
              events.push({
                ts: now,
                severity: 'info',
                type: 'new_device',
                message: `Client connected: ${client.name}`,
                relatedIds: [client.id],
              });
            }
          }

          // Fetch health metrics
          try {
            const healthResponse = await this.apiRequest(
              'get',
              `${apiPrefix}/api/s/${siteName}/stat/health`
            );
            const health = healthResponse.data?.data || [];

            for (const healthItem of health) {
              if (healthItem.subsystem === 'wan' && healthItem.status !== 'ok') {
                events.push({
                  ts: now,
                  severity: 'warning',
                  type: 'wan_issue',
                  message: `WAN issue detected: ${healthItem.status}`,
                  relatedIds: [],
                });
              }
            }
          } catch (error) {
            logger.debug('Health metrics not available');
          }
        } catch (error) {
          logger.warn({ siteName, error }, 'Failed to fetch data for site');
        }
      }

      // Build links
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
      logger.error({ error }, 'Failed to fetch data from Local Network');

      // Try to re-authenticate on next fetch
      this.authCookie = undefined;

      return {
        devices: this.deviceCache,
        links: [],
        events: [
          {
            ts: now,
            severity: 'error',
            type: 'wan_issue',
            message: `Local Network API error: ${this.lastError}`,
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
    if (this.authCookie) {
      try {
        const apiPrefix = this.useProxyPrefix ? '/proxy/network' : '';
        await this.apiRequest('post', `${apiPrefix}/api/logout`);
      } catch (error) {
        logger.debug('Logout failed');
      }
    }
    logger.info('Local Network adapter destroyed');
  }

  private async authenticate(): Promise<void> {
    const apiPrefix = this.useProxyPrefix ? '/proxy/network' : '';

    const response = await this.client.post(`${apiPrefix}/api/login`, {
      username: this.config.username,
      password: this.config.password,
    });

    const cookies = response.headers['set-cookie'];
    if (cookies) {
      this.authCookie = cookies
        .map(c => c.split(';')[0])
        .join('; ');
    }

    logger.debug('Authentication successful');
  }

  private async apiRequest(method: 'get' | 'post', url: string, data?: any): Promise<any> {
    return this.client.request({
      method,
      url,
      data,
      headers: {
        Cookie: this.authCookie || '',
      },
    });
  }

  private normalizeDevice(raw: any, siteId: string): Device {
    return {
      id: raw._id || raw.mac,
      name: raw.name || raw.hostname || raw.mac || 'Unknown',
      type: this.mapDeviceType(raw.type),
      mac: raw.mac,
      ip: raw.ip,
      parentDeviceId: raw.uplink?.uplink_mac,
      uplinkPort: raw.uplink?.uplink_remote_port,
      wiredOrWifi: 'wired',
      siteId,
      txBytes: raw['tx_bytes-r'] || raw.tx_bytes || 0,
      rxBytes: raw['rx_bytes-r'] || raw.rx_bytes || 0,
      lastSeen: raw.last_seen ? raw.last_seen * 1000 : Date.now(),
      online: raw.state === 1,
      latencyMs: raw.uplink_latency || raw.latency,
    };
  }

  private normalizeClient(raw: any, siteId: string): Device {
    return {
      id: raw._id || raw.mac,
      name: raw.hostname || raw.name || raw.mac || 'Unknown Client',
      type: 'client',
      mac: raw.mac,
      ip: raw.ip,
      parentDeviceId: raw.ap_mac || raw.sw_mac,
      wiredOrWifi: raw.is_wired ? 'wired' : 'wifi',
      siteId,
      ssid: raw.essid,
      rssi: raw.rssi,
      vlanId: raw.vlan,
      txBytes: raw['tx_bytes-r'] || raw.tx_bytes || 0,
      rxBytes: raw['rx_bytes-r'] || raw.rx_bytes || 0,
      lastSeen: raw.last_seen ? raw.last_seen * 1000 : Date.now(),
      online: true,
      latencyMs: raw.latency,
    };
  }

  private mapDeviceType(rawType: string): DeviceType {
    const type = (rawType || '').toLowerCase();
    if (type.includes('gateway') || type.includes('ugw') || type.includes('udm') || type.includes('usg')) {
      return 'gateway';
    }
    if (type.includes('switch') || type.includes('usw')) {
      return 'switch';
    }
    if (type.includes('ap') || type.includes('uap')) {
      return 'ap';
    }
    return 'unknown';
  }

  private calculateUtilization(device: Device): number {
    const totalBytes = device.txBytes + device.rxBytes;
    return Math.min(1, totalBytes / (1024 * 1024 * 1024));
  }
}

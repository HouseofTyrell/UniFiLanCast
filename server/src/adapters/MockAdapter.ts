import { NetworkAdapter } from '../models/adapter.js';
import {
  Device,
  Link,
  NetworkEvent,
  AdapterStatus,
  DeviceType,
} from '../models/types.js';
import { logger } from '../utils/logger.js';

interface MockDevice extends Device {
  trafficPattern: 'steady' | 'bursty' | 'idle';
  baseTraffic: number;
}

/**
 * Mock adapter that generates realistic network data for testing
 */
export class MockAdapter implements NetworkAdapter {
  name = 'mock';
  private devices: MockDevice[] = [];
  private links: Link[] = [];
  private lastUpdate = 0;
  private isInitialized = false;
  private deviceCount: number;

  constructor(deviceCount: number = 30) {
    this.deviceCount = deviceCount;
  }

  async initialize(): Promise<void> {
    logger.info('Initializing mock adapter...');
    this.generateMockNetwork();
    this.isInitialized = true;
    this.lastUpdate = Date.now();
    logger.info(`Mock adapter initialized with ${this.devices.length} devices`);
  }

  async fetchData(): Promise<{
    devices: Device[];
    links: Link[];
    events: NetworkEvent[];
  }> {
    const now = Date.now();
    const events: NetworkEvent[] = [];

    // Update traffic and status for all devices
    for (const device of this.devices) {
      this.updateDeviceTraffic(device);

      // Randomly simulate events
      if (Math.random() < 0.001) {
        // 0.1% chance per fetch
        if (device.online && Math.random() < 0.5) {
          device.online = false;
          events.push({
            ts: now,
            severity: 'warning',
            type: 'offline',
            message: `${device.name} went offline`,
            relatedIds: [device.id],
          });
        } else if (!device.online) {
          device.online = true;
          events.push({
            ts: now,
            severity: 'info',
            type: 'device_reconnect',
            message: `${device.name} reconnected`,
            relatedIds: [device.id],
          });
        }
      }

      // Simulate latency spikes + packet loss as device CONDITIONS only.
      // Detection/alerting is centralized in HealthMonitor (snapshot layer), so
      // mock and real adapters produce identical event semantics.
      if (device.online && Math.random() < 0.002) {
        device.latencyMs = 200 + Math.random() * 300;
      } else if (device.latencyMs && device.latencyMs > 50) {
        device.latencyMs = Math.max(1, device.latencyMs * 0.9); // decay back to normal
      }
      if (device.online && Math.random() < 0.0015) {
        device.packetLoss = 0.06 + Math.random() * 0.1; // 6–16% loss
      } else if (device.packetLoss && device.packetLoss > 0.005) {
        device.packetLoss = device.packetLoss * 0.8; // decay
      }

      device.lastSeen = device.online ? now : device.lastSeen;
    }

    // Update link utilization
    for (const link of this.links) {
      const fromDevice = this.devices.find(d => d.id === link.fromId);
      const toDevice = this.devices.find(d => d.id === link.toId);

      if (fromDevice && toDevice && toDevice.online) {
        const totalTraffic = toDevice.txBps + toDevice.rxBps;
        // Normalize to 0-1 (1Gbps = full utilization)
        link.utilizationScore = Math.min(
          1,
          totalTraffic / (1024 * 1024 * 1024)
        );
        link.healthScore = toDevice.packetLoss
          ? Math.max(0, 1 - toDevice.packetLoss / 10)
          : 1;
      } else {
        link.utilizationScore = 0;
        link.healthScore = 0;
      }
    }

    this.lastUpdate = now;

    return {
      devices: this.devices,
      links: this.links,
      events,
    };
  }

  getStatus(): AdapterStatus {
    return {
      name: this.name,
      connected: this.isInitialized,
      lastUpdate: this.lastUpdate,
      deviceCount: this.devices.length,
    };
  }

  async destroy(): Promise<void> {
    logger.info('Mock adapter destroyed');
  }

  private generateMockNetwork(): void {
    const now = Date.now();

    // Create gateway
    const gateway: MockDevice = {
      id: 'gateway-1',
      name: 'UDM Pro',
      type: 'gateway',
      mac: this.randomMac(),
      ip: '192.168.1.1',
      wiredOrWifi: 'wired',
      siteId: 'default',
      txBps: 0,
      rxBps: 0,
      lastSeen: now,
      online: true,
      trafficPattern: 'steady',
      baseTraffic: 50 * 1024 * 1024, // 50MB base
    };
    this.devices.push(gateway);

    // Create switches
    const switches: MockDevice[] = [];
    const switchCount = Math.min(3, Math.floor(this.deviceCount / 10));
    for (let i = 0; i < switchCount; i++) {
      const sw: MockDevice = {
        id: `switch-${i + 1}`,
        name: `Switch ${i + 1}`,
        type: 'switch',
        mac: this.randomMac(),
        ip: `192.168.1.${10 + i}`,
        parentDeviceId: gateway.id,
        uplinkPort: `${i + 1}`,
        wiredOrWifi: 'wired',
        siteId: 'default',
        txBps: 0,
        rxBps: 0,
        lastSeen: now,
        online: true,
        trafficPattern: 'steady',
        baseTraffic: 20 * 1024 * 1024,
      };
      switches.push(sw);
      this.devices.push(sw);

      this.links.push({
        fromId: gateway.id,
        toId: sw.id,
        kind: 'uplink',
        utilizationScore: 0,
        healthScore: 1,
        lastChangeTs: now,
      });
    }

    // Create APs
    const aps: MockDevice[] = [];
    const apCount = Math.min(4, Math.floor(this.deviceCount / 8));
    for (let i = 0; i < apCount; i++) {
      const parentSwitch =
        switches.length > 0
          ? switches[i % switches.length]
          : gateway;

      const ap: MockDevice = {
        id: `ap-${i + 1}`,
        name: `AP ${i + 1}`,
        type: 'ap',
        mac: this.randomMac(),
        ip: `192.168.1.${20 + i}`,
        parentDeviceId: parentSwitch.id,
        wiredOrWifi: 'wired',
        siteId: 'default',
        txBps: 0,
        rxBps: 0,
        lastSeen: now,
        online: true,
        trafficPattern: 'bursty',
        baseTraffic: 30 * 1024 * 1024,
      };
      aps.push(ap);
      this.devices.push(ap);

      this.links.push({
        fromId: parentSwitch.id,
        toId: ap.id,
        kind: 'uplink',
        utilizationScore: 0,
        healthScore: 1,
        lastChangeTs: now,
      });
    }

    // Create clients
    const infrastructureCount = 1 + switches.length + aps.length;
    const clientCount = this.deviceCount - infrastructureCount;

    for (let i = 0; i < clientCount; i++) {
      const isWifi = Math.random() < 0.6; // 60% wifi
      let parent: Device;

      if (isWifi && aps.length > 0) {
        parent = aps[Math.floor(Math.random() * aps.length)];
      } else if (switches.length > 0) {
        parent = switches[Math.floor(Math.random() * switches.length)];
      } else {
        parent = gateway;
      }

      const client: MockDevice = {
        id: `client-${i + 1}`,
        name: this.randomClientName(),
        type: 'client',
        mac: this.randomMac(),
        ip: `192.168.1.${100 + i}`,
        parentDeviceId: parent.id,
        wiredOrWifi: isWifi ? 'wifi' : 'wired',
        siteId: 'default',
        ssid: isWifi ? `HomeNet-${Math.floor(Math.random() * 2) + 1}` : undefined,
        rssi: isWifi ? -50 - Math.random() * 40 : undefined,
        txBps: 0,
        rxBps: 0,
        lastSeen: now,
        online: Math.random() < 0.9, // 90% online
        trafficPattern: Math.random() < 0.3 ? 'bursty' : Math.random() < 0.6 ? 'steady' : 'idle',
        baseTraffic: Math.random() * 10 * 1024 * 1024,
        latencyMs: 1 + Math.random() * 20,
      };
      this.devices.push(client);

      this.links.push({
        fromId: parent.id,
        toId: client.id,
        kind: 'client',
        utilizationScore: 0,
        healthScore: 1,
        lastChangeTs: now,
      });
    }
  }

  private updateDeviceTraffic(device: MockDevice): void {
    if (!device.online) {
      return;
    }

    let traffic = device.baseTraffic;

    switch (device.trafficPattern) {
      case 'bursty':
        // Random bursts
        if (Math.random() < 0.1) {
          traffic *= 5;
        }
        break;
      case 'idle':
        traffic *= 0.1;
        break;
      case 'steady':
        // Small variations
        traffic *= 0.8 + Math.random() * 0.4;
        break;
    }

    // Split between tx and rx
    const split = 0.4 + Math.random() * 0.2;
    device.txBps = Math.floor(traffic * split);
    device.rxBps = Math.floor(traffic * (1 - split));

    // Simulate packet loss occasionally
    if (Math.random() < 0.01) {
      device.packetLoss = Math.random() * 2;
    } else {
      device.packetLoss = undefined;
    }
  }

  private randomMac(): string {
    return Array.from({ length: 6 }, () =>
      Math.floor(Math.random() * 256)
        .toString(16)
        .padStart(2, '0')
    ).join(':');
  }

  private randomClientName(): string {
    const prefixes = [
      'iPhone',
      'iPad',
      'MacBook',
      'PC',
      'Laptop',
      'Desktop',
      'Tablet',
      'Android',
      'TV',
      'IoT',
      'Camera',
      'Printer',
    ];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    return `${prefix}-${Math.floor(Math.random() * 100)}`;
  }
}

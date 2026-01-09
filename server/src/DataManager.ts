import { NetworkAdapter } from './models/adapter.js';
import { NetworkSnapshot, HistorySample } from './models/types.js';
import { WeatherEngine } from './utils/weatherEngine.js';
import { logger } from './utils/logger.js';
import { EventEmitter } from 'events';

/**
 * Central data manager that coordinates adapters and provides unified network state
 */
export class DataManager extends EventEmitter {
  private adapters: NetworkAdapter[] = [];
  private weatherEngine: WeatherEngine;
  private pollingIntervals: Map<string, NodeJS.Timeout> = new Map();
  private isRunning = false;

  constructor(
    adapters: NetworkAdapter[],
    private retentionMinutes: number = 60
  ) {
    super();
    this.adapters = adapters;
    this.weatherEngine = new WeatherEngine();
  }

  async start(): Promise<void> {
    logger.info('Starting data manager...');

    // Initialize all adapters
    for (const adapter of this.adapters) {
      try {
        await adapter.initialize();
        logger.info(`Adapter ${adapter.name} initialized`);
      } catch (error) {
        logger.error({ adapter: adapter.name, error }, 'Failed to initialize adapter');
      }
    }

    this.isRunning = true;

    // Start polling for each adapter
    for (const adapter of this.adapters) {
      this.startPolling(adapter);
    }

    // Start history cleanup interval
    setInterval(() => {
      this.weatherEngine.clearOldHistory(this.retentionMinutes);
    }, 60000); // Clean up every minute

    logger.info('Data manager started');
  }

  async stop(): Promise<void> {
    logger.info('Stopping data manager...');
    this.isRunning = false;

    // Stop all polling
    for (const [name, interval] of this.pollingIntervals) {
      clearInterval(interval);
      logger.debug(`Stopped polling for ${name}`);
    }
    this.pollingIntervals.clear();

    // Destroy all adapters
    for (const adapter of this.adapters) {
      try {
        await adapter.destroy();
      } catch (error) {
        logger.error({ adapter: adapter.name, error }, 'Error destroying adapter');
      }
    }

    logger.info('Data manager stopped');
  }

  /**
   * Get current network snapshot
   */
  async getSnapshot(): Promise<NetworkSnapshot> {
    const allDevices = [];
    const allLinks = [];
    const allEvents = [];

    // Collect data from all adapters
    for (const adapter of this.adapters) {
      try {
        const data = await adapter.fetchData();
        allDevices.push(...data.devices);
        allLinks.push(...data.links);
        allEvents.push(...data.events);
      } catch (error) {
        logger.error({ adapter: adapter.name, error }, 'Failed to fetch data from adapter');
      }
    }

    // Deduplicate devices by ID (prefer data from later adapters)
    const deviceMap = new Map();
    for (const device of allDevices) {
      deviceMap.set(device.id, device);
    }
    const devices = Array.from(deviceMap.values());

    // Deduplicate links
    const linkMap = new Map();
    for (const link of allLinks) {
      const key = `${link.fromId}-${link.toId}`;
      linkMap.set(key, link);
    }
    const links = Array.from(linkMap.values());

    // Compute weather signals
    const weather = this.weatherEngine.computeWeather(devices, links);

    const snapshot: NetworkSnapshot = {
      timestamp: Date.now(),
      devices,
      links,
      events: allEvents,
      weather,
    };

    // Add to history
    this.weatherEngine.addToHistory({
      timestamp: snapshot.timestamp,
      devices: snapshot.devices,
      links: snapshot.links,
      events: snapshot.events,
      weather: snapshot.weather,
    });

    return snapshot;
  }

  /**
   * Get historical data
   */
  getHistory(minutes: number): HistorySample[] {
    return this.weatherEngine.getHistory(minutes);
  }

  /**
   * Get status of all adapters
   */
  getAdapterStatus() {
    return this.adapters.map(a => a.getStatus());
  }

  private startPolling(adapter: NetworkAdapter): void {
    // Initial fetch
    this.pollAdapter(adapter);

    // Set up interval (default 5 seconds)
    const interval = setInterval(() => {
      if (this.isRunning) {
        this.pollAdapter(adapter);
      }
    }, 5000);

    this.pollingIntervals.set(adapter.name, interval);
  }

  private async pollAdapter(adapter: NetworkAdapter): Promise<void> {
    try {
      await adapter.fetchData();

      // Emit update event
      this.emit('update', adapter.name);
    } catch (error) {
      logger.error({ adapter: adapter.name, error }, 'Polling error');
    }
  }
}

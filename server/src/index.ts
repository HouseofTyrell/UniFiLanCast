import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { DataManager } from './DataManager.js';
import { MockAdapter } from './adapters/MockAdapter.js';
import { SiteManagerAdapter } from './adapters/SiteManagerAdapter.js';
import { LocalNetworkAdapter } from './adapters/LocalNetworkAdapter.js';
import { registerApiRoutes } from './routes/api.js';
import { logger } from './utils/logger.js';
import { Config } from './models/types.js';
import { NetworkAdapter } from './models/adapter.js';

/**
 * Load configuration from file or use defaults
 */
function loadConfig(): Config {
  const configPath = process.env.CONFIG_PATH || join(process.cwd(), 'config.json');

  if (existsSync(configPath)) {
    logger.info(`Loading config from ${configPath}`);
    const configData = readFileSync(configPath, 'utf-8');
    return JSON.parse(configData);
  }

  logger.info('No config file found, using defaults (mock mode)');
  return {
    adapters: {
      mock: {
        enabled: true,
        deviceCount: 30,
      },
    },
    server: {
      port: 3001,
      historyRetentionMinutes: 60,
      logLevel: 'info',
    },
  };
}

/**
 * Initialize adapters based on configuration
 */
function initializeAdapters(config: Config): NetworkAdapter[] {
  const adapters: NetworkAdapter[] = [];

  if (config.adapters.mock?.enabled) {
    logger.info('Enabling mock adapter');
    adapters.push(new MockAdapter(config.adapters.mock.deviceCount));
  }

  if (config.adapters.siteManager?.enabled) {
    logger.info('Enabling Site Manager adapter');
    adapters.push(
      new SiteManagerAdapter({
        apiKey: config.adapters.siteManager.apiKey,
        pollingInterval: config.adapters.siteManager.pollingInterval,
      })
    );
  }

  if (config.adapters.localNetwork?.enabled) {
    logger.info('Enabling Local Network adapter');
    adapters.push(
      new LocalNetworkAdapter({
        baseUrl: config.adapters.localNetwork.baseUrl,
        username: config.adapters.localNetwork.username,
        password: config.adapters.localNetwork.password,
        pollingInterval: config.adapters.localNetwork.pollingInterval,
        useProxyPrefix: config.adapters.localNetwork.useProxyPrefix,
        verifySsl: config.adapters.localNetwork.verifySsl,
      })
    );
  }

  if (adapters.length === 0) {
    logger.warn('No adapters enabled, enabling mock adapter as fallback');
    adapters.push(new MockAdapter(30));
  }

  return adapters;
}

/**
 * Main application entry point
 */
async function main() {
  const config = loadConfig();

  // Create Fastify instance
  const fastify = Fastify({
    logger: false, // Using pino directly
  });

  // Register CORS
  await fastify.register(cors, {
    origin: true,
  });

  // Serve static files in production
  if (process.env.NODE_ENV === 'production') {
    const staticPath = join(process.cwd(), 'public');
    if (existsSync(staticPath)) {
      await fastify.register(staticPlugin, {
        root: staticPath,
        prefix: '/',
      });
      logger.info(`Serving static files from ${staticPath}`);
    }
  }

  // Initialize adapters and data manager
  const adapters = initializeAdapters(config);
  const dataManager = new DataManager(
    adapters,
    config.server.historyRetentionMinutes
  );

  // Register API routes
  await registerApiRoutes(fastify, dataManager);

  // Start data manager
  await dataManager.start();

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    await dataManager.stop();
    await fastify.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Start server
  const port = config.server.port;
  const host = '0.0.0.0';

  try {
    await fastify.listen({ port, host });
    logger.info(`Server listening on http://${host}:${port}`);
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

// Start the application
main().catch(error => {
  logger.error({ error }, 'Unhandled error');
  process.exit(1);
});

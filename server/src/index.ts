import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import { join, dirname } from 'path';
import { readFileSync, existsSync } from 'fs';
import { timingSafeEqual } from 'crypto';
import { DataManager } from './DataManager.js';
import { Store } from './Store.js';
import { AlertManager } from './AlertManager.js';
import { MockAdapter } from './adapters/MockAdapter.js';
import { SiteManagerAdapter } from './adapters/SiteManagerAdapter.js';
import { LocalNetworkAdapter } from './adapters/LocalNetworkAdapter.js';
import { IntegrationApiAdapter } from './adapters/IntegrationApiAdapter.js';
import { registerApiRoutes } from './routes/api.js';
import { logger } from './utils/logger.js';
import { Config } from './models/types.js';
import { NetworkAdapter } from './models/adapter.js';

/**
 * Walk up from the current directory looking for a file. Lets the server find
 * the repo-root `config.json` / `.env` whether it's launched from the repo root
 * (production) or from `server/` (the `npm run dev` workspace cwd).
 */
function findUp(filename: string, maxDepth = 4): string | undefined {
  let dir = process.cwd();
  for (let i = 0; i <= maxDepth; i++) {
    const candidate = join(dir, filename);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * Minimal .env loader (no dependency). Populates process.env from the nearest
 * `.env` without overwriting variables already set in the environment.
 */
function loadEnvFile(): void {
  const envPath = findUp('.env');
  if (!envPath) return;
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
  logger.info(`Loaded environment from ${envPath}`);
}

/**
 * Load configuration from file or use defaults
 */
function loadConfig(): Config {
  const configPath =
    process.env.CONFIG_PATH || findUp('config.json') || join(process.cwd(), 'config.json');

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

  if (config.adapters.integrationApi?.enabled) {
    const cfg = config.adapters.integrationApi;
    const apiKey = cfg.apiKey || process.env[cfg.apiKeyEnv || 'UNIFI_API_KEY'] || '';
    if (!apiKey) {
      logger.error(
        `Integration API adapter enabled but no API key found ` +
          `(set ${cfg.apiKeyEnv || 'UNIFI_API_KEY'} or config.adapters.integrationApi.apiKey)`
      );
    } else {
      logger.info('Enabling Integration API adapter');
      adapters.push(
        new IntegrationApiAdapter({
          baseUrl: cfg.baseUrl,
          apiKey,
          siteId: cfg.siteId,
          pollingInterval: cfg.pollingInterval,
          verifySsl: cfg.verifySsl,
        })
      );
    }
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
  loadEnvFile();
  const config = loadConfig();

  // Create Fastify instance
  const fastify = Fastify({
    logger: false, // Using pino directly
  });

  // Register CORS
  await fastify.register(cors, {
    origin: true,
  });

  // Optional HTTP Basic auth over everything (API, SSE, static).
  if (config.auth?.enabled) {
    const username = config.auth.username;
    const password =
      config.auth.password || process.env[config.auth.passwordEnv || 'UNIFI_AUTH_PASSWORD'] || '';
    if (!username || !password) {
      logger.error('Auth enabled but username/password missing — refusing to start unprotected');
      process.exit(1);
    }
    const expected = `${username}:${password}`;
    const safeEqual = (a: string, b: string) => {
      const ab = Buffer.from(a);
      const bb = Buffer.from(b);
      return ab.length === bb.length && timingSafeEqual(ab, bb);
    };
    fastify.addHook('onRequest', async (request, reply) => {
      const header = request.headers.authorization ?? '';
      const [scheme, encoded] = header.split(' ');
      const provided =
        scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString('utf-8') : '';
      if (!provided || !safeEqual(provided, expected)) {
        reply
          .code(401)
          .header('WWW-Authenticate', 'Basic realm="UniFiLanCast"')
          .send({ error: 'Authentication required' });
      }
    });
    logger.info('HTTP Basic auth enabled');
  }

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

  // Set up persistence. The data dir sits next to config.json by default so
  // it's found whether the server runs from the repo root or from server/.
  let store: Store | undefined;
  try {
    const configPath = process.env.CONFIG_PATH || findUp('config.json');
    const root = configPath ? dirname(configPath) : process.cwd();
    const dataDir = process.env.DATA_DIR || config.server.dataDir || join(root, 'data');
    store = new Store(join(dataDir, 'weather.db'));
  } catch (error) {
    logger.error({ error }, 'Failed to open persistence store — running in-memory only');
  }

  // Initialize adapters and data manager
  const adapters = initializeAdapters(config);
  const dataManager = new DataManager(adapters, {
    retentionMinutes: config.server.historyRetentionMinutes,
    store,
  });

  // Wire alerting: dispatch qualifying events from each capture to a webhook.
  if (config.alerts?.enabled) {
    const webhookUrl =
      config.alerts.webhookUrl ||
      process.env[config.alerts.webhookEnv || 'UNIFI_ALERT_WEBHOOK'] ||
      undefined;
    if (!webhookUrl) {
      logger.error(
        `Alerts enabled but no webhook URL (set ${config.alerts.webhookEnv || 'UNIFI_ALERT_WEBHOOK'} or config.alerts.webhookUrl)`
      );
    } else {
      const alertManager = new AlertManager({ ...config.alerts, webhookUrl });
      dataManager.on('update', (snapshot: { events: import('./models/types.js').NetworkEvent[] }) => {
        alertManager.process(snapshot.events).catch(error =>
          logger.error({ error }, 'Alert processing error')
        );
      });
    }
  }

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

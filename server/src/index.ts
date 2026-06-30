import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import { join, dirname } from 'path';
import { readFileSync, existsSync } from 'fs';
import { timingSafeEqual } from 'crypto';
import { DataManager } from './DataManager.js';
import { PingProbe } from './PingProbe.js';
import { Store } from './Store.js';
import { AlertManager } from './AlertManager.js';
import { MockAdapter } from './adapters/MockAdapter.js';
import { SiteManagerAdapter } from './adapters/SiteManagerAdapter.js';
import { LocalNetworkAdapter } from './adapters/LocalNetworkAdapter.js';
import { IntegrationApiAdapter } from './adapters/IntegrationApiAdapter.js';
import { registerApiRoutes } from './routes/api.js';
import { logger } from './utils/logger.js';
import { findUp, resolveConfigPath } from './utils/paths.js';
import { Config } from './models/types.js';
import { NetworkAdapter } from './models/adapter.js';

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
  const configPath = resolveConfigPath();

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
      // Fail closed: a configured real adapter must never silently degrade to
      // simulated data (a failed setup would otherwise look healthy).
      logger.error(
        `Integration API adapter enabled but no API key found ` +
          `(set ${cfg.apiKeyEnv || 'UNIFI_API_KEY'} or config.adapters.integrationApi.apiKey). Refusing to start.`
      );
      process.exit(1);
    }
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

  // No silent mock fallback. Mock data is only ever shown when explicitly
  // enabled (config.adapters.mock). If nothing is configured, fail loudly.
  if (adapters.length === 0) {
    logger.error(
      'No adapters enabled. Enable a real adapter (integrationApi/localNetwork/siteManager) ' +
        'or set adapters.mock.enabled = true for simulated data. Refusing to start.'
    );
    process.exit(1);
  }

  return adapters;
}

/**
 * Main application entry point
 */
async function main() {
  loadEnvFile();
  const config = loadConfig();

  // Honor the configured log level (env LOG_LEVEL still wins if set explicitly).
  if (!process.env.LOG_LEVEL && config.server.logLevel) {
    logger.level = config.server.logLevel;
  }

  // Create Fastify instance
  const fastify = Fastify({
    logger: false, // Using pino directly
  });

  // Register CORS. The UI is served same-origin (and proxied in dev), so we
  // only need to allow same-origin/non-browser callers plus localhost dev
  // origins — never reflect arbitrary origins back (guards against a hostile
  // page scripting the API when the server is LAN-exposed).
  await fastify.register(cors, {
    origin: (origin, cb) => {
      if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        cb(null, true);
        return;
      }
      cb(null, false);
    },
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
    const root = dirname(resolveConfigPath());
    const dataDir = process.env.DATA_DIR || config.server.dataDir || join(root, 'data');
    store = new Store(join(dataDir, 'weather.db'));
  } catch (error) {
    logger.error({ error }, 'Failed to open persistence store — running in-memory only');
  }

  // Active WAN health probe (latency/loss for the gateway). Enabled by default;
  // disable with config.health.ping.enabled = false.
  const pingCfg = config.health?.ping;
  const probe =
    pingCfg?.enabled === false
      ? undefined
      : new PingProbe(pingCfg?.target, pingCfg?.intervalMs, pingCfg?.count);

  // Initialize adapters and data manager
  const adapters = initializeAdapters(config);
  const dataManager = new DataManager(adapters, {
    retentionMinutes: config.server.historyRetentionMinutes,
    store,
    healthThresholds: config.health,
    probe,
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

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    await dataManager.stop();
    await fastify.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Start server. Bind loopback by default; only expose on the LAN when the
  // operator explicitly sets server.host. Refuse to start LAN-exposed without
  // auth (fail-closed) — mirrors the existing auth-misconfig exit above.
  const port = config.server.port;
  // HOST env overrides config (handy in containers, where the container binds
  // 0.0.0.0 and the host port mapping controls real exposure).
  const host = process.env.HOST || config.server.host || '127.0.0.1';
  const isLoopback = host === '127.0.0.1' || host === '::1' || host === 'localhost';
  const allowInsecureBind =
    process.env.ALLOW_INSECURE_BIND === '1' || process.env.ALLOW_INSECURE_BIND === 'true';
  if (!isLoopback && !config.auth?.enabled && !allowInsecureBind) {
    logger.error(
      `Refusing to start: host "${host}" is not loopback but auth.enabled is false. ` +
        'Enable auth, bind 127.0.0.1, or set ALLOW_INSECURE_BIND=1 if the host port ' +
        'mapping already restricts exposure (e.g. a Docker 127.0.0.1:PORT:3001 mapping).'
    );
    process.exit(1);
  }
  if (!isLoopback && !config.auth?.enabled && allowInsecureBind) {
    logger.warn(`Binding ${host} without auth (ALLOW_INSECURE_BIND set) — ensure the port mapping restricts exposure`);
  }

  try {
    await fastify.listen({ port, host });
    logger.info(`Server listening on http://${host}:${port}`);
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }

  // Start capturing AFTER the server is listening, so the API/SSE are reachable
  // immediately even while adapters initialize or a controller is unavailable.
  dataManager.start().catch(error => {
    logger.error({ error }, 'Data manager failed to start');
  });
}

// Start the application
main().catch(error => {
  logger.error({ error }, 'Unhandled error');
  process.exit(1);
});

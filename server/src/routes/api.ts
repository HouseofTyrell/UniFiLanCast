import { FastifyInstance } from 'fastify';
import { readFile, writeFile, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { DataManager } from '../DataManager.js';
import { logger } from '../utils/logger.js';
import { Config } from '../models/types.js';

/** Mask a secret-bearing string so the value never leaves the server. */
function maskSecret(v: unknown): unknown {
  return typeof v === 'string' && v.length > 0 ? '********' : v;
}

/** Deep-clone config and redact every secret field before returning it. */
function redactConfig(config: any): any {
  const c = JSON.parse(JSON.stringify(config ?? {}));
  const a = c.adapters || {};
  if (a.siteManager) a.siteManager.apiKey = maskSecret(a.siteManager.apiKey);
  if (a.integrationApi) a.integrationApi.apiKey = maskSecret(a.integrationApi.apiKey);
  if (a.localNetwork) {
    a.localNetwork.password = maskSecret(a.localNetwork.password);
    a.localNetwork.username = maskSecret(a.localNetwork.username);
  }
  if (c.auth) c.auth.password = maskSecret(c.auth.password);
  if (c.alerts) c.alerts.webhookUrl = maskSecret(c.alerts.webhookUrl);
  return c;
}

/** Minimal runtime validation for a posted config (types are compile-time only). */
function validateConfig(body: unknown): string | null {
  if (!body || typeof body !== 'object') return 'Body must be a JSON object';
  const c = body as any;
  if (!c.adapters || typeof c.adapters !== 'object') return 'Missing or invalid "adapters"';
  if (!c.server || typeof c.server !== 'object') return 'Missing or invalid "server"';
  if (c.server.port !== undefined && typeof c.server.port !== 'number') return '"server.port" must be a number';
  if (c.auth !== undefined && typeof c.auth !== 'object') return '"auth" must be an object';
  if (c.alerts !== undefined && typeof c.alerts !== 'object') return '"alerts" must be an object';
  return null;
}

/**
 * Register API routes
 */
export async function registerApiRoutes(
  fastify: FastifyInstance,
  dataManager: DataManager
) {
  /**
   * GET /api/snapshot - Get current network state
   */
  fastify.get('/api/snapshot', async (request, reply) => {
    try {
      const snapshot = await dataManager.getSnapshot();
      return snapshot;
    } catch (error) {
      logger.error({ error }, 'Failed to get snapshot');
      reply.code(500).send({ error: 'Failed to get network snapshot' });
    }
  });

  /**
   * GET /api/history - Get historical data
   */
  fastify.get<{
    Querystring: { minutes?: string };
  }>('/api/history', async (request, reply) => {
    try {
      const minutes = Math.max(1, Math.min(1440, parseInt(request.query.minutes || '60', 10) || 60));
      const history = dataManager.getHistory(minutes);
      return history;
    } catch (error) {
      logger.error({ error }, 'Failed to get history');
      reply.code(500).send({ error: 'Failed to get history' });
    }
  });

  /**
   * GET /api/usage - Total WAN data transferred over a recent window
   */
  fastify.get<{
    Querystring: { minutes?: string; deviceId?: string };
  }>('/api/usage', async (request, reply) => {
    try {
      const minutes = Math.max(1, Math.min(1440, parseInt(request.query.minutes || '60', 10)));
      return dataManager.getWanUsage(minutes, request.query.deviceId);
    } catch (error) {
      logger.error({ error }, 'Failed to get usage');
      reply.code(500).send({ error: 'Failed to get usage' });
    }
  });

  /**
   * GET /api/usage/devices - Per-device data usage over a recent window
   */
  fastify.get<{
    Querystring: { minutes?: string };
  }>('/api/usage/devices', async (request, reply) => {
    try {
      const minutes = Math.max(1, Math.min(1440, parseInt(request.query.minutes || '60', 10)));
      return dataManager.getDeviceUsages(minutes);
    } catch (error) {
      logger.error({ error }, 'Failed to get device usage');
      reply.code(500).send({ error: 'Failed to get device usage' });
    }
  });

  /**
   * GET /api/status - Get adapter status
   */
  fastify.get('/api/status', async (request, reply) => {
    try {
      const status = dataManager.getAdapterStatus();
      return { adapters: status };
    } catch (error) {
      logger.error({ error }, 'Failed to get status');
      reply.code(500).send({ error: 'Failed to get status' });
    }
  });

  /**
   * GET /api/stream - Server-Sent Events stream for live updates
   */
  // Serialize each snapshot once and share the payload across all connected
  // clients (rather than re-stringifying the same object per client per tick).
  let cachedSnap: unknown = null;
  let cachedPayload = '';
  const serialize = (snapshot: unknown) => {
    if (snapshot !== cachedSnap) {
      cachedSnap = snapshot;
      cachedPayload = `data: ${JSON.stringify(snapshot)}\n\n`;
    }
    return cachedPayload;
  };

  fastify.get('/api/stream', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Send initial snapshot
    try {
      reply.raw.write(serialize(await dataManager.getSnapshot()));
    } catch (error) {
      logger.error({ error }, 'Failed to send initial snapshot');
    }

    // Set up listener for updates
    const updateListener = async () => {
      try {
        reply.raw.write(serialize(await dataManager.getSnapshot()));
      } catch (error) {
        logger.error({ error }, 'Failed to send update');
      }
    };

    dataManager.on('update', updateListener);

    // Clean up on disconnect
    request.raw.on('close', () => {
      dataManager.off('update', updateListener);
      logger.debug('Client disconnected from stream');
    });
  });

  /**
   * GET /api/config - Get current configuration
   */
  fastify.get('/api/config', async (request, reply) => {
    try {
      const configPath = process.env.CONFIG_PATH || join(process.cwd(), 'config.json');

      if (!existsSync(configPath)) {
        // Return default config if file doesn't exist
        return {
          adapters: {
            mock: {
              enabled: true,
              deviceCount: 30,
            },
            siteManager: {
              enabled: false,
              apiKey: '',
              pollingInterval: 15000,
            },
            localNetwork: {
              enabled: false,
              baseUrl: 'https://192.168.1.1',
              username: '',
              password: '',
              pollingInterval: 5000,
              useProxyPrefix: true,
              verifySsl: false,
            },
          },
          server: {
            port: 3001,
            historyRetentionMinutes: 60,
            logLevel: 'info',
          },
        };
      }

      const configData = await readFile(configPath, 'utf-8');
      return redactConfig(JSON.parse(configData));
    } catch (error) {
      logger.error({ error }, 'Failed to read config');
      reply.code(500).send({ error: 'Failed to read configuration' });
    }
  });

  /**
   * POST /api/config - Save configuration
   */
  fastify.post<{
    Body: Config;
  }>('/api/config', async (request, reply) => {
    try {
      const configPath = process.env.CONFIG_PATH || join(process.cwd(), 'config.json');
      const config = request.body as any;

      const error = validateConfig(config);
      if (error) {
        reply.code(400).send({ error });
        return;
      }

      // The UI receives a redacted config; if a secret comes back still masked,
      // preserve the real value from disk instead of clobbering it with the mask.
      if (existsSync(configPath)) {
        try {
          const existing = JSON.parse(await readFile(configPath, 'utf-8'));
          const restore = (objNew: any, objOld: any, key: string) => {
            if (objNew && objOld && objNew[key] === '********') objNew[key] = objOld[key];
          };
          const an = config.adapters || {};
          const ao = existing.adapters || {};
          restore(an.siteManager, ao.siteManager, 'apiKey');
          restore(an.integrationApi, ao.integrationApi, 'apiKey');
          restore(an.localNetwork, ao.localNetwork, 'password');
          restore(an.localNetwork, ao.localNetwork, 'username');
          restore(config.auth, existing.auth, 'password');
          restore(config.alerts, existing.alerts, 'webhookUrl');
        } catch {
          /* fall through with posted values */
        }
      }

      // Atomic write: temp file + rename so a crash can't truncate config.json.
      const tmp = `${configPath}.tmp`;
      await writeFile(tmp, JSON.stringify(config, null, 2), 'utf-8');
      await rename(tmp, configPath);

      logger.info('Configuration saved successfully');
      return { success: true, message: 'Configuration saved. Restart server to apply changes.' };
    } catch (error) {
      logger.error({ error }, 'Failed to save config');
      reply.code(500).send({ error: 'Failed to save configuration' });
    }
  });

  logger.info('API routes registered');
}

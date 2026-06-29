import { FastifyInstance } from 'fastify';
import { readFile, writeFile, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { DataManager } from '../DataManager.js';
import { logger } from '../utils/logger.js';
import { resolveConfigPath } from '../utils/paths.js';
import { redactConfig, validateConfig, preserveMaskedSecrets } from '../utils/configValidation.js';
import { Config } from '../models/types.js';

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
   * GET /api/events - Persisted recent events (so the feed survives refreshes).
   * Optional filters: limit (1..500), severity, type.
   */
  fastify.get<{
    Querystring: { limit?: string; severity?: string; type?: string };
  }>('/api/events', async (request, reply) => {
    try {
      const limit = Math.max(1, Math.min(500, parseInt(request.query.limit || '100', 10) || 100));
      let events = dataManager.getRecentEvents(limit);
      const { severity, type } = request.query;
      if (severity) events = events.filter(e => e.severity === severity);
      if (type) events = events.filter(e => e.type === type);
      return events;
    } catch (error) {
      logger.error({ error }, 'Failed to get events');
      reply.code(500).send({ error: 'Failed to get events' });
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
      const configPath = resolveConfigPath();

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
  }>('/api/config', { bodyLimit: 256 * 1024 }, async (request, reply) => {
    try {
      const configPath = resolveConfigPath();
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
          preserveMaskedSecrets(config, JSON.parse(await readFile(configPath, 'utf-8')));
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

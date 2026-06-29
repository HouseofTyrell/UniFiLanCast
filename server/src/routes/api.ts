import { FastifyInstance } from 'fastify';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { DataManager } from '../DataManager.js';
import { logger } from '../utils/logger.js';
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
      const minutes = parseInt(request.query.minutes || '60', 10);
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
    Querystring: { minutes?: string };
  }>('/api/usage', async (request, reply) => {
    try {
      const minutes = Math.max(1, Math.min(1440, parseInt(request.query.minutes || '60', 10)));
      return dataManager.getWanUsage(minutes);
    } catch (error) {
      logger.error({ error }, 'Failed to get usage');
      reply.code(500).send({ error: 'Failed to get usage' });
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
  fastify.get('/api/stream', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Send initial snapshot
    try {
      const snapshot = await dataManager.getSnapshot();
      reply.raw.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    } catch (error) {
      logger.error({ error }, 'Failed to send initial snapshot');
    }

    // Set up listener for updates
    const updateListener = async () => {
      try {
        const snapshot = await dataManager.getSnapshot();
        reply.raw.write(`data: ${JSON.stringify(snapshot)}\n\n`);
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
      return JSON.parse(configData);
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
      const config = request.body;

      // Validate config structure
      if (!config.adapters || !config.server) {
        reply.code(400).send({ error: 'Invalid configuration structure' });
        return;
      }

      // Write config to file
      await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

      logger.info('Configuration saved successfully');
      return { success: true, message: 'Configuration saved. Restart server to apply changes.' };
    } catch (error) {
      logger.error({ error }, 'Failed to save config');
      reply.code(500).send({ error: 'Failed to save configuration' });
    }
  });

  logger.info('API routes registered');
}

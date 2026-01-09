import { FastifyInstance } from 'fastify';
import { DataManager } from '../DataManager.js';
import { logger } from '../utils/logger.js';

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

  logger.info('API routes registered');
}

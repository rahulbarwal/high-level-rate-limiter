import { Router } from 'express';
import type { Redis } from 'ioredis';
import { checkRedisHealth } from '../redis/redisHealth';

export function createHealthRouter(redisClient?: Redis): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  router.get('/ready', async (_req, res) => {
    if (!redisClient) {
      res.status(503).json({ status: 'not_ready', redis: 'unavailable' });
      return;
    }
    const redisStatus = await checkRedisHealth(redisClient);
    if (redisStatus === 'ok') {
      res.status(200).json({ status: 'ready', redis: 'ok' });
    } else {
      res.status(503).json({ status: 'not_ready', redis: 'unavailable' });
    }
  });

  return router;
}

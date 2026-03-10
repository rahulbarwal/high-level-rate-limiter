import express, { Request, Response } from 'express';
import type { Redis } from 'ioredis';
import { collectMetrics, getMetricsContentType } from './metrics/metrics';
import { requestIdMiddleware } from './middleware/requestId';
import { createHealthRouter } from './routes/health';
import { createRateLimiterMiddleware } from './middleware/rateLimiter';
import type { ConfigCache } from './config/configCache';
import type { SpikeDetector } from './abuse/spikeDetector';

export interface AppDeps {
  redisClient: Redis;
  configCache: ConfigCache;
  spikeDetector?: SpikeDetector;
}

export function createApp(deps?: AppDeps): express.Application {
  const app = express();

  // a. Attach a request ID to every request before anything else touches it
  app.use(requestIdMiddleware);
  app.use(express.json());

  // b. Health and readiness probes — mounted before the rate limiter so they
  //    are never subject to rate limiting
  app.use(createHealthRouter(deps?.redisClient));

  // c. Per-tenant token-bucket rate limiter (only when fully wired)
  if (deps) {
    app.use(
      createRateLimiterMiddleware({
        cache: deps.configCache,
        redisClient: deps.redisClient,
        spikeDetector: deps.spikeDetector,
      }),
    );
  }

  // d. Test route used by E2E and load tests
  app.get('/api/test', (_req: Request, res: Response) => {
    res.status(200).json({ message: 'ok' });
  });

  // e. Prometheus metrics scrape endpoint
  app.get('/metrics', async (_req: Request, res: Response) => {
    res.set('Content-Type', getMetricsContentType());
    res.end(await collectMetrics());
  });

  return app;
}

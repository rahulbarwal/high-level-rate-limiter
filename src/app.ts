import express, { Request, Response } from 'express';
import type { Redis } from 'ioredis';
import { collectMetrics, getMetricsContentType } from './metrics/metrics';
import { requestIdMiddleware } from './middleware/requestId';
import { requestLoggerMiddleware } from './middleware/requestLogger';
import { createHealthRouter } from './routes/health';
import { createRateLimiterMiddleware } from './middleware/rateLimiter';
import type { ConfigCache } from './config/configCache';
import type { SpikeDetector } from './abuse/spikeDetector';
import type { GlobalLimiter } from './globalLimiter/globalLimiter';

export interface AppDeps {
  redisClient: Redis;
  configCache: ConfigCache;
  spikeDetector?: SpikeDetector;
  globalLimiter?: GlobalLimiter;
}

export function createApp(deps?: AppDeps): express.Application {
  const app = express();

  // a. Attach a request ID to every request before anything else touches it
  app.use(requestIdMiddleware);
  app.use(requestLoggerMiddleware);
  app.use(express.json());

  // b. Health and readiness probes — mounted before the rate limiter so they
  //    are never subject to rate limiting
  app.use(createHealthRouter(deps?.redisClient));

  // c. Prometheus metrics scrape endpoint — no tenant ID required
  app.get('/metrics', async (_req: Request, res: Response) => {
    res.set('Content-Type', getMetricsContentType());
    res.end(await collectMetrics());
  });

  // d. Per-tenant token-bucket rate limiter with optional global load shedding
  //    (only when fully wired)
  if (deps) {
    app.use(
      createRateLimiterMiddleware({
        cache: deps.configCache,
        redisClient: deps.redisClient,
        spikeDetector: deps.spikeDetector,
        globalLimiter: deps.globalLimiter,
      }),
    );
  }

  // e. Test route used by E2E and load tests
  app.get('/api/test', (_req: Request, res: Response) => {
    res.status(200).json({ message: 'ok' });
  });

  return app;
}

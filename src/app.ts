import express, { Request, Response } from "express";
import { collectMetrics, getMetricsContentType } from "./metrics/metrics";
import { requestIdMiddleware } from "./middleware/requestId";
import { createHealthRouter } from "./routes/health";
import type { Redis } from "ioredis";

export function createApp(redisClient?: Redis): express.Application {
  const app = express();

  app.use(requestIdMiddleware);
  app.use(express.json());

  // Health and readiness probes are mounted before any rate limiter middleware
  // so they are never subject to rate limiting.
  app.use(createHealthRouter(redisClient));

  app.get("/metrics", async (_req: Request, res: Response) => {
    res.set("Content-Type", getMetricsContentType());
    res.end(await collectMetrics());
  });

  return app;
}

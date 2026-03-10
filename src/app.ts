import express, { Request, Response } from "express";
import { collectMetrics, getMetricsContentType } from "./metrics/metrics";

export function createApp(): express.Application {
  const app = express();

  app.use(express.json());

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  app.get("/metrics", async (_req: Request, res: Response) => {
    res.set("Content-Type", getMetricsContentType());
    res.end(await collectMetrics());
  });

  return app;
}

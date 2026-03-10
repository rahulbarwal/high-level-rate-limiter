import express, { Request, Response } from "express";

export function createApp(): express.Application {
  const app = express();

  app.use(express.json());

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  return app;
}

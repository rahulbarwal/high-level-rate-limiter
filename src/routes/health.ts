import { Router } from 'express';
import type { Redis } from 'ioredis';

export function createHealthRouter(_redisClient: Redis): Router {
  // stub — returns an empty router; implementation added in Unit 13
  return Router();
}

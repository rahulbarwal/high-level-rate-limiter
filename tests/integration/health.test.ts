import express from 'express';
import request from 'supertest';
import type { Redis } from 'ioredis';
import { createHealthRouter } from '../../src/routes/health';

// ---------------------------------------------------------------------------
// Mock checkRedisHealth so tests can control Redis health state without a
// real Redis connection.
// ---------------------------------------------------------------------------

jest.mock('../../src/redis/redisHealth', () => ({
  checkRedisHealth: jest.fn(),
}));

import { checkRedisHealth } from '../../src/redis/redisHealth';
const mockCheckRedisHealth = checkRedisHealth as jest.MockedFunction<typeof checkRedisHealth>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal ioredis stub — health router only passes the client to checkRedisHealth. */
const fakeRedis = {} as Redis;

function buildApp(): express.Application {
  const app = express();
  app.use(createHealthRouter(fakeRedis));
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Health router', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // GET /health — liveness probe
  // -------------------------------------------------------------------------

  describe('GET /health', () => {
    it('returns 200 with { status: "ok" }', async () => {
      const res = await request(buildApp()).get('/health');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'ok' });
    });

    it('returns a timestamp field that is a valid ISO 8601 string', async () => {
      const res = await request(buildApp()).get('/health');

      expect(res.status).toBe(200);
      expect(typeof res.body.timestamp).toBe('string');
      expect(() => new Date(res.body.timestamp).toISOString()).not.toThrow();
      expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
    });

    it('does not set X-RateLimit-* headers (not affected by rate limiter middleware)', async () => {
      const res = await request(buildApp()).get('/health');

      expect(res.status).toBe(200);
      expect(res.headers).not.toHaveProperty('x-ratelimit-limit');
      expect(res.headers).not.toHaveProperty('x-ratelimit-remaining');
      expect(res.headers).not.toHaveProperty('x-ratelimit-reset');
    });
  });

  // -------------------------------------------------------------------------
  // GET /ready — readiness probe
  // -------------------------------------------------------------------------

  describe('GET /ready', () => {
    it('returns 200 with { status: "ready", redis: "ok" } when Redis is healthy', async () => {
      mockCheckRedisHealth.mockResolvedValue('ok');

      const res = await request(buildApp()).get('/ready');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'ready', redis: 'ok' });
    });

    it('returns 503 with { status: "not_ready", redis: "unavailable" } when Redis is down', async () => {
      mockCheckRedisHealth.mockResolvedValue('unavailable');

      const res = await request(buildApp()).get('/ready');

      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ status: 'not_ready', redis: 'unavailable' });
    });
  });
});

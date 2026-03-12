import express, { type Application } from 'express';
import request from 'supertest';
import { createRateLimiterMiddleware } from '../../src/middleware/rateLimiter';
import { ConfigCache } from '../../src/config/configCache';
import { ConfigStoreError, type TenantConfig, TierLevel } from '../../src/config/types';
import { RedisUnavailableError, type TokenBucketResult } from '../../src/redis/types';
import type { Redis } from 'ioredis';

// ---------------------------------------------------------------------------
// Module-level mock for checkAndConsume so tests can control its behaviour
// ---------------------------------------------------------------------------

jest.mock('../../src/redis/tokenBucket', () => ({
  checkAndConsume: jest.fn(),
}));

import { checkAndConsume } from '../../src/redis/tokenBucket';
const mockCheckAndConsume = checkAndConsume as jest.MockedFunction<typeof checkAndConsume>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW_MS = 1_700_000_000_000;

const makeConfig = (overrides: Partial<TenantConfig> = {}): TenantConfig => ({
  tenantId: 'tenant-abc',
  requestsPerSecond: 10,
  burstSize: 100,
  enabled: true,
  updatedAt: new Date('2024-01-15T10:00:00.000Z'),
  tier: TierLevel.FREE,
  ...overrides,
});

const makeResult = (overrides: Partial<TokenBucketResult> = {}): TokenBucketResult => ({
  allowed: true,
  tokensRemaining: 42,
  burstSize: 100,
  resetAtMs: NOW_MS + 10_000,
  ...overrides,
});

/** Minimal ConfigCache mock with a controllable getTenantConfig. */
function makeCache(config: TenantConfig = makeConfig()): jest.Mocked<Pick<ConfigCache, 'getTenantConfig'>> {
  return {
    getTenantConfig: jest.fn().mockResolvedValue(config),
  };
}

/** Minimal ioredis mock — the middleware only needs the client reference for checkAndConsume. */
const mockRedisClient = {} as Redis;

/** Build a minimal Express app with the rate-limiter middleware mounted on GET /api. */
function buildApp(
  cache: Pick<ConfigCache, 'getTenantConfig'>,
  getTenantId?: (req: express.Request) => string | null,
): Application {
  const app = express();
  app.use(
    '/api',
    createRateLimiterMiddleware({
      cache: cache as ConfigCache,
      redisClient: mockRedisClient,
      getTenantId,
    }),
  );
  app.get('/api', (_req, res) => res.status(200).json({ ok: true }));
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

describe('createRateLimiterMiddleware', () => {
  // -------------------------------------------------------------------------
  // Happy path — allowed
  // -------------------------------------------------------------------------

  describe('allowed request', () => {
    it('returns 200 and passes through to the route handler', async () => {
      const cache = makeCache();
      mockCheckAndConsume.mockResolvedValue(makeResult({ allowed: true }));

      const res = await request(buildApp(cache))
        .get('/api')
        .set('X-Tenant-ID', 'tenant-abc');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it('sets X-RateLimit-Limit header on allowed response', async () => {
      const config = makeConfig({ burstSize: 100 });
      const cache = makeCache(config);
      mockCheckAndConsume.mockResolvedValue(makeResult({ allowed: true, burstSize: 100 }));

      const res = await request(buildApp(cache))
        .get('/api')
        .set('X-Tenant-ID', 'tenant-abc');

      expect(res.headers['x-ratelimit-limit']).toBeDefined();
    });

    it('sets X-RateLimit-Remaining header on allowed response', async () => {
      const cache = makeCache();
      mockCheckAndConsume.mockResolvedValue(makeResult({ allowed: true }));

      const res = await request(buildApp(cache))
        .get('/api')
        .set('X-Tenant-ID', 'tenant-abc');

      expect(res.headers['x-ratelimit-remaining']).toBeDefined();
    });

    it('sets X-RateLimit-Reset header on allowed response', async () => {
      const cache = makeCache();
      mockCheckAndConsume.mockResolvedValue(makeResult({ allowed: true }));

      const res = await request(buildApp(cache))
        .get('/api')
        .set('X-Tenant-ID', 'tenant-abc');

      expect(res.headers['x-ratelimit-reset']).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Rate-limited — rejected
  // -------------------------------------------------------------------------

  describe('rejected request (rate limited)', () => {
    it('returns 429 when checkAndConsume returns allowed=false', async () => {
      const cache = makeCache();
      mockCheckAndConsume.mockResolvedValue(makeResult({ allowed: false, tokensRemaining: 0 }));

      const res = await request(buildApp(cache))
        .get('/api')
        .set('X-Tenant-ID', 'tenant-abc');

      expect(res.status).toBe(429);
    });

    it('returns body { error: "rate_limit_exceeded" } on 429', async () => {
      const cache = makeCache();
      mockCheckAndConsume.mockResolvedValue(makeResult({ allowed: false, tokensRemaining: 0 }));

      const res = await request(buildApp(cache))
        .get('/api')
        .set('X-Tenant-ID', 'tenant-abc');

      expect(res.body).toEqual({ error: 'rate_limit_exceeded' });
    });

    it('sets X-RateLimit-* headers on 429 response', async () => {
      const cache = makeCache();
      mockCheckAndConsume.mockResolvedValue(makeResult({ allowed: false, tokensRemaining: 0 }));

      const res = await request(buildApp(cache))
        .get('/api')
        .set('X-Tenant-ID', 'tenant-abc');

      expect(res.headers['x-ratelimit-limit']).toBeDefined();
      expect(res.headers['x-ratelimit-remaining']).toBeDefined();
      expect(res.headers['x-ratelimit-reset']).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Redis unavailable
  // -------------------------------------------------------------------------

  describe('Redis unavailable', () => {
    it('returns 503 when checkAndConsume throws RedisUnavailableError', async () => {
      const cache = makeCache();
      mockCheckAndConsume.mockRejectedValue(new RedisUnavailableError('ECONNREFUSED'));

      const res = await request(buildApp(cache))
        .get('/api')
        .set('X-Tenant-ID', 'tenant-abc');

      expect(res.status).toBe(503);
    });

    it('returns body { error: "service_unavailable" } when Redis is down', async () => {
      const cache = makeCache();
      mockCheckAndConsume.mockRejectedValue(new RedisUnavailableError('ECONNREFUSED'));

      const res = await request(buildApp(cache))
        .get('/api')
        .set('X-Tenant-ID', 'tenant-abc');

      expect(res.body).toEqual({ error: 'service_unavailable' });
    });
  });

  // -------------------------------------------------------------------------
  // Config unavailable
  // -------------------------------------------------------------------------

  describe('config unavailable', () => {
    it('returns 503 when cache.getTenantConfig throws ConfigStoreError', async () => {
      const cache = makeCache();
      (cache.getTenantConfig as jest.Mock).mockRejectedValue(
        new ConfigStoreError('No config found for tenant: tenant-abc'),
      );

      const res = await request(buildApp(cache))
        .get('/api')
        .set('X-Tenant-ID', 'tenant-abc');

      expect(res.status).toBe(503);
    });

    it('returns body { error: "service_unavailable" } when config is unavailable', async () => {
      const cache = makeCache();
      (cache.getTenantConfig as jest.Mock).mockRejectedValue(
        new ConfigStoreError('No config found for tenant: tenant-abc'),
      );

      const res = await request(buildApp(cache))
        .get('/api')
        .set('X-Tenant-ID', 'tenant-abc');

      expect(res.body).toEqual({ error: 'service_unavailable' });
    });
  });

  // -------------------------------------------------------------------------
  // Bypass when disabled
  // -------------------------------------------------------------------------

  describe('rate limiting disabled for tenant', () => {
    it('returns 200 and calls next() without invoking checkAndConsume', async () => {
      const config = makeConfig({ enabled: false });
      const cache = makeCache(config);

      const res = await request(buildApp(cache))
        .get('/api')
        .set('X-Tenant-ID', 'tenant-abc');

      expect(res.status).toBe(200);
      expect(mockCheckAndConsume).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Missing tenant ID
  // -------------------------------------------------------------------------

  describe('missing X-Tenant-ID header', () => {
    it('returns 400 when X-Tenant-ID header is absent', async () => {
      const cache = makeCache();

      const res = await request(buildApp(cache)).get('/api');

      expect(res.status).toBe(400);
    });

    it('returns body { error: "missing_tenant_id" } when header is absent', async () => {
      const cache = makeCache();

      const res = await request(buildApp(cache)).get('/api');

      expect(res.body).toEqual({ error: 'missing_tenant_id' });
    });
  });

  // -------------------------------------------------------------------------
  // Custom tenant ID extractor
  // -------------------------------------------------------------------------

  describe('custom getTenantId extractor', () => {
    it('uses the custom extractor instead of the default X-Tenant-ID header', async () => {
      const cache = makeCache(makeConfig({ tenantId: 'tenant-from-jwt' }));
      mockCheckAndConsume.mockResolvedValue(makeResult({ allowed: true }));

      // Extractor reads from a custom header rather than X-Tenant-ID
      const getTenantId = (req: express.Request): string | null =>
        (req.headers['x-custom-tenant'] as string) ?? null;

      const res = await request(buildApp(cache, getTenantId))
        .get('/api')
        .set('x-custom-tenant', 'tenant-from-jwt');

      expect(res.status).toBe(200);
      expect(cache.getTenantConfig).toHaveBeenCalledWith('tenant-from-jwt');
    });

    it('returns 400 when the custom extractor returns null', async () => {
      const cache = makeCache();
      const getTenantId = (_req: express.Request): string | null => null;

      const res = await request(buildApp(cache, getTenantId))
        .get('/api')
        .set('X-Tenant-ID', 'tenant-abc'); // header present but extractor ignores it

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'missing_tenant_id' });
    });
  });
});

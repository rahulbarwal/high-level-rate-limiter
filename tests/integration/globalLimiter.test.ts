import express, { type Application } from 'express';
import request from 'supertest';
import { createRateLimiterMiddleware } from '../../src/middleware/rateLimiter';
import { ConfigCache } from '../../src/config/configCache';
import { type TenantConfig } from '../../src/config/types';
import { TierLevel } from '../../src/globalLimiter/types';
import { RedisUnavailableError, type TokenBucketResult } from '../../src/redis/types';
import type { GlobalLimiter } from '../../src/globalLimiter/globalLimiter';
import type { Redis } from 'ioredis';

// ---------------------------------------------------------------------------
// Module-level mock for checkAndConsume
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
  tier: TierLevel.PAYING,
  ...overrides,
});

const makeResult = (overrides: Partial<TokenBucketResult> = {}): TokenBucketResult => ({
  allowed: true,
  tokensRemaining: 42,
  burstSize: 100,
  resetAtMs: NOW_MS + 10_000,
  ...overrides,
});

function makeCache(config: TenantConfig = makeConfig()): jest.Mocked<Pick<ConfigCache, 'getTenantConfig'>> {
  return {
    getTenantConfig: jest.fn().mockResolvedValue(config),
  };
}

/** Creates a mock GlobalLimiter with controllable tryConsume. */
function makeGlobalLimiter(allowed = true): jest.Mocked<Pick<GlobalLimiter, 'tryConsume'>> {
  return {
    tryConsume: jest.fn().mockResolvedValue(allowed),
  };
}

const mockRedisClient = {} as Redis;

function buildApp(
  cache: Pick<ConfigCache, 'getTenantConfig'>,
  globalLimiter?: Pick<GlobalLimiter, 'tryConsume'>,
): Application {
  const app = express();
  app.use(
    '/api',
    createRateLimiterMiddleware({
      cache: cache as ConfigCache,
      redisClient: mockRedisClient,
      globalLimiter: globalLimiter as GlobalLimiter | undefined,
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

describe('createRateLimiterMiddleware — global limiter integration', () => {
  // -------------------------------------------------------------------------
  // Global limiter allows — falls through to per-tenant check
  // -------------------------------------------------------------------------

  describe('global limiter allows the request', () => {
    it('proceeds to per-tenant check and returns 200 when both allow', async () => {
      const cache = makeCache();
      const globalLimiter = makeGlobalLimiter(true);
      mockCheckAndConsume.mockResolvedValue(makeResult({ allowed: true }));

      const res = await request(buildApp(cache, globalLimiter))
        .get('/api')
        .set('X-Tenant-ID', 'tenant-abc');

      expect(res.status).toBe(200);
      expect(globalLimiter.tryConsume).toHaveBeenCalledTimes(1);
      expect(mockCheckAndConsume).toHaveBeenCalledTimes(1);
    });

    it('calls tryConsume with the tenant tier from config', async () => {
      const config = makeConfig({ tier: TierLevel.FREE });
      const cache = makeCache(config);
      const globalLimiter = makeGlobalLimiter(true);
      mockCheckAndConsume.mockResolvedValue(makeResult({ allowed: true }));

      await request(buildApp(cache, globalLimiter))
        .get('/api')
        .set('X-Tenant-ID', 'tenant-abc');

      expect(globalLimiter.tryConsume).toHaveBeenCalledWith(TierLevel.FREE);
    });
  });

  // -------------------------------------------------------------------------
  // Global limiter sheds — 429 with load_shed error
  // -------------------------------------------------------------------------

  describe('global limiter sheds the request', () => {
    it('returns 429 when global limiter returns false', async () => {
      const cache = makeCache();
      const globalLimiter = makeGlobalLimiter(false);

      const res = await request(buildApp(cache, globalLimiter))
        .get('/api')
        .set('X-Tenant-ID', 'tenant-abc');

      expect(res.status).toBe(429);
    });

    it('returns body { error: "load_shed" } when global limit is hit', async () => {
      const cache = makeCache();
      const globalLimiter = makeGlobalLimiter(false);

      const res = await request(buildApp(cache, globalLimiter))
        .get('/api')
        .set('X-Tenant-ID', 'tenant-abc');

      expect(res.body).toEqual({ error: 'load_shed' });
    });

    it('does NOT call per-tenant checkAndConsume when global limiter sheds', async () => {
      const cache = makeCache();
      const globalLimiter = makeGlobalLimiter(false);

      await request(buildApp(cache, globalLimiter))
        .get('/api')
        .set('X-Tenant-ID', 'tenant-abc');

      expect(mockCheckAndConsume).not.toHaveBeenCalled();
    });

    it('sheds INTERNAL tier (Tier 4) requests when global limit is hit', async () => {
      const config = makeConfig({ tier: TierLevel.INTERNAL });
      const cache = makeCache(config);
      const globalLimiter = makeGlobalLimiter(false);

      const res = await request(buildApp(cache, globalLimiter))
        .get('/api')
        .set('X-Tenant-ID', 'tenant-abc');

      expect(res.status).toBe(429);
      expect(res.body).toEqual({ error: 'load_shed' });
    });

    it('sheds FREE tier (Tier 3) requests when global limit is hit', async () => {
      const config = makeConfig({ tier: TierLevel.FREE });
      const cache = makeCache(config);
      const globalLimiter = makeGlobalLimiter(false);

      const res = await request(buildApp(cache, globalLimiter))
        .get('/api')
        .set('X-Tenant-ID', 'tenant-abc');

      expect(res.status).toBe(429);
      expect(res.body).toEqual({ error: 'load_shed' });
    });

    it('sheds PAYING tier (Tier 2) requests when global limit is hit', async () => {
      const config = makeConfig({ tier: TierLevel.PAYING });
      const cache = makeCache(config);
      const globalLimiter = makeGlobalLimiter(false);

      const res = await request(buildApp(cache, globalLimiter))
        .get('/api')
        .set('X-Tenant-ID', 'tenant-abc');

      expect(res.status).toBe(429);
      expect(res.body).toEqual({ error: 'load_shed' });
    });
  });

  // -------------------------------------------------------------------------
  // Tier 1 (ENTERPRISE) — global limiter returns true, never shed
  // -------------------------------------------------------------------------

  describe('ENTERPRISE tier (Tier 1) — never shed by global limiter', () => {
    it('returns 200 for enterprise tenant even when global limiter would shed others', async () => {
      const config = makeConfig({ tier: TierLevel.ENTERPRISE });
      const cache = makeCache(config);
      // GlobalLimiter returns true for enterprise (bypasses Redis internally)
      const globalLimiter = makeGlobalLimiter(true);
      mockCheckAndConsume.mockResolvedValue(makeResult({ allowed: true }));

      const res = await request(buildApp(cache, globalLimiter))
        .get('/api')
        .set('X-Tenant-ID', 'tenant-enterprise');

      expect(res.status).toBe(200);
    });

    it('calls tryConsume with ENTERPRISE tier so GlobalLimiter can skip Redis', async () => {
      const config = makeConfig({ tier: TierLevel.ENTERPRISE });
      const cache = makeCache(config);
      const globalLimiter = makeGlobalLimiter(true);
      mockCheckAndConsume.mockResolvedValue(makeResult({ allowed: true }));

      await request(buildApp(cache, globalLimiter))
        .get('/api')
        .set('X-Tenant-ID', 'tenant-enterprise');

      expect(globalLimiter.tryConsume).toHaveBeenCalledWith(TierLevel.ENTERPRISE);
    });
  });

  // -------------------------------------------------------------------------
  // No global limiter — existing behaviour unchanged
  // -------------------------------------------------------------------------

  describe('no global limiter provided', () => {
    it('returns 200 when no global limiter is injected and per-tenant allows', async () => {
      const cache = makeCache();
      mockCheckAndConsume.mockResolvedValue(makeResult({ allowed: true }));

      const res = await request(buildApp(cache))
        .get('/api')
        .set('X-Tenant-ID', 'tenant-abc');

      expect(res.status).toBe(200);
    });

    it('returns 429 when no global limiter is injected and per-tenant rejects', async () => {
      const cache = makeCache();
      mockCheckAndConsume.mockResolvedValue(makeResult({ allowed: false, tokensRemaining: 0 }));

      const res = await request(buildApp(cache))
        .get('/api')
        .set('X-Tenant-ID', 'tenant-abc');

      expect(res.status).toBe(429);
      expect(res.body).toEqual({ error: 'rate_limit_exceeded' });
    });
  });

  // -------------------------------------------------------------------------
  // Global limiter Redis error — propagates as 503
  // -------------------------------------------------------------------------

  describe('global limiter Redis error', () => {
    it('returns 503 when global limiter throws RedisUnavailableError', async () => {
      const cache = makeCache();
      const globalLimiter: jest.Mocked<Pick<GlobalLimiter, 'tryConsume'>> = {
        tryConsume: jest.fn().mockRejectedValue(new RedisUnavailableError('ECONNREFUSED')),
      };

      const res = await request(buildApp(cache, globalLimiter as unknown as GlobalLimiter))
        .get('/api')
        .set('X-Tenant-ID', 'tenant-abc');

      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: 'service_unavailable' });
    });
  });
});

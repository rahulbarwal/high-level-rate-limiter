import type { Request, RequestHandler } from 'express';
import type { Redis } from 'ioredis';
import type { ConfigCache } from '../config/configCache';
import { ConfigStoreError } from '../config/types';
import { checkAndConsume } from '../redis/tokenBucket';
import { RedisUnavailableError } from '../redis/types';
import {
  rateLimitRequestsTotal,
  rateLimitRedisLatencyMs,
  rateLimitRedisUnavailableTotal,
} from '../metrics/metrics';
import { logger, logRejection } from '../logger';
import { setRateLimitHeaders } from './headers';

export interface RateLimiterDeps {
  cache: ConfigCache;
  redisClient: Redis;
  getTenantId?: (req: Request) => string | null;
}

const defaultGetTenantId = (req: Request): string | null =>
  (req.headers['x-tenant-id'] as string) || null;

/**
 * Creates an Express middleware that enforces per-tenant token-bucket rate limits.
 *
 * Flow:
 *   1. Extract tenant ID from X-Tenant-ID header (or custom extractor)
 *   2. Look up TenantConfig via ConfigCache
 *   3. If config.enabled === false, pass through immediately
 *   4. Call checkAndConsume() against Redis
 *   5. Set X-RateLimit-* headers on every response
 *   6. Allow (200/next) or reject (429) based on token availability
 *
 * Error handling:
 *   - Missing tenant ID          → 400 { error: 'missing_tenant_id' }
 *   - ConfigStoreError           → 503 { error: 'service_unavailable' }
 *   - RedisUnavailableError      → 503 { error: 'service_unavailable' }
 */
export function createRateLimiterMiddleware(deps: RateLimiterDeps): RequestHandler {
  const { cache, redisClient, getTenantId = defaultGetTenantId } = deps;

  return async (req, res, next) => {
    const requestId = req.requestId ?? (req.headers['x-request-id'] as string | undefined) ?? '';
    const timestamp = new Date().toISOString();

    // a. Extract tenant ID
    const tenantId = getTenantId(req);
    if (!tenantId) {
      res.status(400).json({ error: 'missing_tenant_id' });
      return;
    }

    // b. Fetch tenant config
    let config;
    try {
      config = await cache.getTenantConfig(tenantId);
    } catch (err) {
      if (err instanceof ConfigStoreError) {
        logger.warn({
          event: 'rate_limit_error',
          tenant_id: tenantId,
          reason: 'config_unavailable',
          request_id: requestId,
          timestamp,
        });
        res.status(503).json({ error: 'service_unavailable' });
        return;
      }
      throw err;
    }

    // c. Bypass when rate limiting is disabled for this tenant
    if (!config.enabled) {
      next();
      return;
    }

    // d. Check and consume a token, measuring Redis latency
    let result;
    const endTimer = rateLimitRedisLatencyMs.startTimer();
    try {
      result = await checkAndConsume(redisClient, tenantId, config, Date.now());
    } catch (err) {
      endTimer();
      if (err instanceof RedisUnavailableError) {
        rateLimitRedisUnavailableTotal.inc();
        logger.error({
          event: 'rate_limit_error',
          tenant_id: tenantId,
          reason: 'redis_unavailable',
          request_id: requestId,
          timestamp,
        });
        res.status(503).json({ error: 'service_unavailable' });
        return;
      }
      throw err;
    }
    endTimer();

    // e. Set rate-limit headers on every response
    setRateLimitHeaders(res, result, config);

    // f. Allow
    if (result.allowed) {
      rateLimitRequestsTotal.inc({ tenant: tenantId, result: 'allowed' });
      next();
      return;
    }

    // g. Reject
    rateLimitRequestsTotal.inc({ tenant: tenantId, result: 'rejected' });
    logRejection({
      event: 'rate_limit_rejected',
      tenant_id: tenantId,
      result: 'rejected',
      tokens_remaining: result.tokensRemaining,
      limit: config.burstSize,
      burst: config.burstSize,
      request_id: requestId,
      timestamp,
    });
    res.status(429).json({ error: 'rate_limit_exceeded' });
  };
}

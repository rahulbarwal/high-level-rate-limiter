import type { Request, RequestHandler } from 'express';
import type { Redis } from 'ioredis';
import type { ConfigCache } from '../config/configCache';

export interface RateLimiterDeps {
  cache: ConfigCache;
  redisClient: Redis;
  getTenantId?: (req: Request) => string | null;
}

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
  throw new Error('not implemented');
}

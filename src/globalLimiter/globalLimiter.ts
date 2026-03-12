import { checkAndConsume } from '../redis/tokenBucket';
import { TierLevel, GlobalLimiterConfig } from './types';

export const GLOBAL_LIMIT_RPS = 50_000;

/**
 * The synthetic TenantConfig-shaped object used for the global token bucket.
 * Key in Redis: rl:__global__
 */
const GLOBAL_BUCKET_CONFIG = {
  tenantId: '__global__',
  requestsPerSecond: GLOBAL_LIMIT_RPS,
  burstSize: GLOBAL_LIMIT_RPS,
  enabled: true,
  updatedAt: new Date(0),
  tier: TierLevel.ENTERPRISE, // unused for the global bucket itself
} as const;

/**
 * Redis-backed global rate limiter that enforces a shared token bucket across
 * all service instances. Uses the same Lua token-bucket script as per-tenant
 * limiting, keyed at `rl:__global__`.
 *
 * Priority-based load shedding:
 *   - Tier 1 (ENTERPRISE): always allowed — no Redis call made.
 *   - Tiers 2, 3, 4: consume from the global bucket; shed when exhausted.
 *     Tier 4 (INTERNAL) is shed first by design (lowest business priority),
 *     followed by Tier 3 (FREE), then Tier 2 (PAYING).
 */
export class GlobalLimiter {
  private readonly config: GlobalLimiterConfig;

  constructor(config: GlobalLimiterConfig) {
    this.config = config;
  }

  /**
   * Attempts to consume one token from the global bucket for the given tier.
   *
   * @param tier   - The tier of the requesting tenant.
   * @param nowMs  - Current epoch milliseconds (injectable for testability).
   * @returns `true` if the request should proceed, `false` if it should be shed.
   * @throws {RedisUnavailableError} if Redis is unreachable (non-enterprise only).
   */
  async tryConsume(tier: TierLevel, nowMs: number = Date.now()): Promise<boolean> {
    // Enterprise traffic is never subject to global load shedding.
    if (tier === TierLevel.ENTERPRISE) {
      return true;
    }

    const result = await checkAndConsume(
      this.config.redisClient,
      '__global__',
      GLOBAL_BUCKET_CONFIG,
      nowMs,
    );

    return result.allowed;
  }
}

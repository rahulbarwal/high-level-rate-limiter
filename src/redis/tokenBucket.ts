import type { Redis } from 'ioredis';
import { TenantConfig } from '../config/types';
import { TokenBucketResult, RedisUnavailableError } from './types';
import { RATE_LIMIT_SCRIPT } from './luaScript';

/**
 * Calls the token-bucket Lua script on Redis and returns a structured result.
 *
 * @param client   - ioredis client instance
 * @param tenantId - tenant identifier; the Redis key will be `rl:{tenantId}`
 * @param config   - tenant rate-limit configuration
 * @param nowMs    - current epoch milliseconds (injectable for testability)
 * @param cost     - number of tokens to consume (defaults to 1)
 *
 * @throws {RedisUnavailableError} when the Redis call fails
 */
export async function checkAndConsume(
  client: Redis,
  tenantId: string,
  config: TenantConfig,
  nowMs: number,
  cost?: number,
): Promise<TokenBucketResult> {
  const key = `rl:${tenantId}`;
  const effectiveCost = cost ?? 1;

  let raw: unknown;
  try {
    raw = await client.eval(
      RATE_LIMIT_SCRIPT,
      1,
      key,
      String(config.requestsPerSecond),
      String(config.burstSize),
      String(nowMs),
      String(effectiveCost),
    );
  } catch (err) {
    throw new RedisUnavailableError(
      err instanceof Error ? err.message : String(err),
    );
  }

  const result = raw as [number, number, number, number];
  const allowed = result[0] === 1;
  const tokensRemaining = Math.max(0, Math.floor(result[1]));
  const burstSize = result[2];
  const resetAtMs = Math.ceil(nowMs + (config.burstSize / config.requestsPerSecond) * 1000);

  return { allowed, tokensRemaining, burstSize, resetAtMs };
}

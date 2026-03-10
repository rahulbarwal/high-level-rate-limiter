import type { Redis } from 'ioredis';
import { TenantConfig } from '../config/types';
import { TokenBucketResult } from './types';

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
  throw new Error('not implemented');
}

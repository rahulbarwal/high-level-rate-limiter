import type { Response } from 'express';
import type { TokenBucketResult } from '../redis/types';
import type { TenantConfig } from '../config/types';

/**
 * Sets rate-limit response headers on every API response.
 *
 * Always set:
 *   X-RateLimit-Limit     — bucket capacity (burstSize)
 *   X-RateLimit-Remaining — tokens left after this request (floored, min 0)
 *   X-RateLimit-Reset     — Unix timestamp in seconds when the bucket refills
 *
 * Set only on rejected (429) responses:
 *   Retry-After           — seconds until the next token is available
 */
export function setRateLimitHeaders(
  res: Response,
  result: TokenBucketResult,
  config: TenantConfig,
): void {
  throw new Error('not implemented');
}

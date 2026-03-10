/**
 * Atomic token-bucket Lua script for Redis.
 * Checks and consumes tokens in a single round-trip.
 *
 * KEYS[1]  — rate-limit key: rl:{tenantId}
 * ARGV[1]  — requestsPerSecond (refill rate)
 * ARGV[2]  — burstSize (bucket capacity)
 * ARGV[3]  — nowMs (current epoch milliseconds, as string)
 * ARGV[4]  — cost (number of tokens to consume, defaults to 1)
 *
 * Returns a flat array: [allowed, tokensRemaining, burstSize, resetAtMs]
 *   allowed        — 1 if the request is permitted, 0 if rate-limited
 *   tokensRemaining — tokens left after this request
 *   burstSize       — echoed back from ARGV[2]
 *   resetAtMs       — epoch ms when the bucket will be full again
 */
export const RATE_LIMIT_SCRIPT = '';

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
export const RATE_LIMIT_SCRIPT = `
local key        = KEYS[1]
local rate       = tonumber(ARGV[1])
local burst      = tonumber(ARGV[2])
local now        = tonumber(ARGV[3])
local cost       = tonumber(ARGV[4])
local data       = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens     = tonumber(data[1]) or burst
local last       = tonumber(data[2]) or now
local elapsed    = math.max(0, now - last)
local refill     = (elapsed / 1000) * rate
tokens           = math.min(burst, tokens + refill)
if tokens >= cost then
  tokens = tokens - cost
  redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
  redis.call('PEXPIRE', key, math.ceil((burst / rate) * 3000))
  return 1
else
  redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
  return 0
end
`;

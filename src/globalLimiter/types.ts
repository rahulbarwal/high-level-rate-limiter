export enum TierLevel {
  ENTERPRISE = 1,
  PAYING = 2,
  FREE = 3,
  INTERNAL = 4,
}

export interface GlobalLimiterConfig {
  /** Maximum requests per second across all tenants combined. */
  globalLimitRps: number;
  /** Redis client used for the shared token bucket. */
  redisClient: import('ioredis').Redis;
}

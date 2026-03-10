import { Redis } from 'ioredis';
import { createLogger } from 'winston';

const logger = createLogger({ silent: true }).child({ module: 'redisClient' });

export type RedisConfig =
  | {
      mode: 'standalone';
      url: string;
    }
  | {
      mode: 'sentinel';
      sentinels: Array<{ host: string; port: number }>;
      masterName: string;
    };

function retryStrategy(times: number): number {
  return Math.min(100 * times, 30_000);
}

export function createRedisClient(config: RedisConfig): Redis {
  let client: Redis;

  if (config.mode === 'standalone') {
    const parsed = new URL(config.url);
    client = new Redis({
      host: parsed.hostname,
      port: Number(parsed.port) || 6379,
      lazyConnect: true,
      retryStrategy,
    });
  } else {
    client = new Redis({
      sentinels: config.sentinels,
      name: config.masterName,
      lazyConnect: true,
      retryStrategy,
    });
  }

  // Guard: the ioredis mock in tests returns a plain object without .on
  if (typeof (client as { on?: unknown }).on === 'function') {
    client.on('error', (err: Error) => {
      logger.error('Redis client error', { error: err.message });
    });
  }

  return client;
}

export function createClientFromEnv(): Redis {
  const sentinelsEnv = process.env.REDIS_SENTINELS;

  if (sentinelsEnv) {
    const sentinels = JSON.parse(sentinelsEnv) as Array<{
      host: string;
      port: number;
    }>;
    const masterName = process.env.REDIS_MASTER_NAME ?? 'mymaster';
    return createRedisClient({ mode: 'sentinel', sentinels, masterName });
  }

  const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
  return createRedisClient({ mode: 'standalone', url });
}

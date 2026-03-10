import { Redis } from 'ioredis';

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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function createRedisClient(_config: RedisConfig): Redis {
  throw new Error('not implemented');
}

export function createClientFromEnv(): Redis {
  throw new Error('not implemented');
}

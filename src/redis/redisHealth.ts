import { Redis } from 'ioredis';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function checkRedisHealth(_client: Redis): Promise<'ok' | 'unavailable'> {
  throw new Error('not implemented');
}

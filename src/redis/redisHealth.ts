import { Redis } from 'ioredis';

const HEALTH_TIMEOUT_MS = 2_000;

export async function checkRedisHealth(client: Redis): Promise<'ok' | 'unavailable'> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('ping timeout')), HEALTH_TIMEOUT_MS),
  );

  try {
    const response = await Promise.race([client.ping(), timeout]);
    return response === 'PONG' ? 'ok' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

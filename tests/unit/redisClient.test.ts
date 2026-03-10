import { createRedisClient } from '../../src/redis/redisClient';
import { checkRedisHealth } from '../../src/redis/redisHealth';

// ---------------------------------------------------------------------------
// Mock ioredis
// The mock must be a class so `new Redis(options)` works. We capture every
// set of constructor arguments so tests can inspect what was passed.
// ---------------------------------------------------------------------------

const mockPing = jest.fn<Promise<string>, []>();

const constructorCalls: unknown[] = [];

jest.mock('ioredis', () => {
  const MockRedis = jest.fn().mockImplementation((...args: unknown[]) => {
    constructorCalls.push(args);
    return { ping: mockPing };
  });
  return { Redis: MockRedis, default: MockRedis };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pull the options object out of the most-recent Redis constructor call. */
function lastConstructorOptions(): Record<string, unknown> {
  const call = constructorCalls[constructorCalls.length - 1] as unknown[];
  // ioredis accepts new Redis(options) — the first argument is the options bag.
  return call[0] as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockPing.mockReset();
  constructorCalls.length = 0;
});

// ---------------------------------------------------------------------------
// createRedisClient — standalone mode
// ---------------------------------------------------------------------------

describe('createRedisClient', () => {
  describe('standalone mode', () => {
    it('passes the url to the ioredis constructor', () => {
      createRedisClient({ mode: 'standalone', url: 'redis://localhost:6379' });

      const opts = lastConstructorOptions();
      expect(opts).toMatchObject({ lazyConnect: true });

      // The url must appear somewhere in the options (implementations may pass
      // it as `host`/`port` after parsing, or as a raw `url` field).
      const optsStr = JSON.stringify(opts);
      expect(optsStr).toContain('6379');
    });

    it('attaches a retryStrategy function', () => {
      createRedisClient({ mode: 'standalone', url: 'redis://localhost:6379' });

      const opts = lastConstructorOptions();
      expect(typeof opts['retryStrategy']).toBe('function');
    });
  });

  // -------------------------------------------------------------------------
  // createRedisClient — sentinel mode
  // -------------------------------------------------------------------------

  describe('sentinel mode', () => {
    const sentinels = [
      { host: 'sentinel-1', port: 26379 },
      { host: 'sentinel-2', port: 26379 },
    ];

    it('passes the sentinels array to the ioredis constructor', () => {
      createRedisClient({
        mode: 'sentinel',
        sentinels,
        masterName: 'mymaster',
      });

      const opts = lastConstructorOptions();
      expect(opts['sentinels']).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ host: 'sentinel-1', port: 26379 }),
          expect.objectContaining({ host: 'sentinel-2', port: 26379 }),
        ]),
      );
    });

    it('passes the masterName as the sentinel `name` option', () => {
      createRedisClient({
        mode: 'sentinel',
        sentinels,
        masterName: 'mymaster',
      });

      const opts = lastConstructorOptions();
      // ioredis uses `name` for the master group name in sentinel mode
      expect(opts['name']).toBe('mymaster');
    });

    it('attaches a retryStrategy function in sentinel mode', () => {
      createRedisClient({
        mode: 'sentinel',
        sentinels,
        masterName: 'mymaster',
      });

      const opts = lastConstructorOptions();
      expect(typeof opts['retryStrategy']).toBe('function');
    });
  });

  // -------------------------------------------------------------------------
  // retryStrategy — exponential backoff with cap
  // -------------------------------------------------------------------------

  describe('retryStrategy', () => {
    function getRetryStrategy(): (attempt: number) => number | null {
      createRedisClient({ mode: 'standalone', url: 'redis://localhost:6379' });
      const opts = lastConstructorOptions();
      return opts['retryStrategy'] as (attempt: number) => number | null;
    }

    it('returns 100ms * attempt for early attempts', () => {
      const retry = getRetryStrategy();
      expect(retry(1)).toBe(100);
      expect(retry(2)).toBe(200);
      expect(retry(5)).toBe(500);
    });

    it('caps the delay at 30 000ms', () => {
      const retry = getRetryStrategy();
      expect(retry(300)).toBe(30_000);
      expect(retry(1000)).toBe(30_000);
    });

    it('never returns a value greater than 30 000ms', () => {
      const retry = getRetryStrategy();
      for (const attempt of [1, 10, 50, 100, 500]) {
        const delay = retry(attempt) as number;
        expect(delay).toBeLessThanOrEqual(30_000);
        expect(delay).toBeGreaterThan(0);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// checkRedisHealth
// ---------------------------------------------------------------------------

describe('checkRedisHealth', () => {
  // We need a mock Redis instance whose `ping` we can control.
  // The ioredis mock returns { ping: mockPing } from its constructor, so we
  // create a client and cast it to the shape checkRedisHealth expects.
  function makeMockClient(): import('ioredis').Redis {
    return { ping: mockPing } as unknown as import('ioredis').Redis;
  }

  it('returns "ok" when client.ping() resolves with "PONG"', async () => {
    mockPing.mockResolvedValueOnce('PONG');
    const client = makeMockClient();

    const result = await checkRedisHealth(client);

    expect(result).toBe('ok');
  });

  it('returns "unavailable" when client.ping() rejects', async () => {
    mockPing.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const client = makeMockClient();

    const result = await checkRedisHealth(client);

    expect(result).toBe('unavailable');
  });

  it('returns "unavailable" when client.ping() takes longer than 2 seconds', async () => {
    jest.useFakeTimers();

    // A promise that never resolves — simulates a hung connection.
    mockPing.mockReturnValueOnce(new Promise<string>(() => {}));
    const client = makeMockClient();

    const healthPromise = checkRedisHealth(client);

    // Advance fake clock past the 2-second timeout threshold.
    jest.advanceTimersByTime(2001);

    const result = await healthPromise;
    expect(result).toBe('unavailable');

    jest.useRealTimers();
  });
});

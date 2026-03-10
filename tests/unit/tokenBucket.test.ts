import { checkAndConsume } from '../../src/redis/tokenBucket';
import { RedisUnavailableError } from '../../src/redis/types';
import { TenantConfig } from '../../src/config/types';
import type { Redis } from 'ioredis';

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

const makeConfig = (overrides: Partial<TenantConfig> = {}): TenantConfig => ({
  tenantId: 'tenant-abc',
  requestsPerSecond: 10,
  burstSize: 20,
  enabled: true,
  updatedAt: new Date('2024-01-15T10:00:00.000Z'),
  ...overrides,
});

const NOW_MS = 1_700_000_000_000;

/** Minimal Redis mock — only the methods the token bucket needs. */
function makeClient(evalResult: unknown = [1, 19, 20, NOW_MS + 2000]): {
  eval: jest.Mock;
  hgetall: jest.Mock;
} {
  return {
    eval: jest.fn().mockResolvedValue(evalResult),
    hgetall: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkAndConsume', () => {
  describe('allowed flag', () => {
    it('returns allowed=true when eval returns 1 as the first element', async () => {
      const client = makeClient([1, 19, 20, NOW_MS + 2000]);
      const result = await checkAndConsume(
        client as unknown as Redis,
        'tenant-abc',
        makeConfig(),
        NOW_MS,
      );

      expect(result.allowed).toBe(true);
    });

    it('returns allowed=false when eval returns 0 as the first element', async () => {
      const client = makeClient([0, 0, 20, NOW_MS + 2000]);
      const result = await checkAndConsume(
        client as unknown as Redis,
        'tenant-abc',
        makeConfig(),
        NOW_MS,
      );

      expect(result.allowed).toBe(false);
    });
  });

  describe('Redis error handling', () => {
    it('throws RedisUnavailableError (not a generic Error) when eval rejects', async () => {
      const client = makeClient();
      client.eval.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(
        checkAndConsume(
          client as unknown as Redis,
          'tenant-abc',
          makeConfig(),
          NOW_MS,
        ),
      ).rejects.toBeInstanceOf(RedisUnavailableError);
    });

    it('does NOT throw a plain Error when eval rejects', async () => {
      const client = makeClient();
      client.eval.mockRejectedValue(new Error('ECONNREFUSED'));

      let thrown: unknown;
      try {
        await checkAndConsume(
          client as unknown as Redis,
          'tenant-abc',
          makeConfig(),
          NOW_MS,
        );
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeDefined();
      expect((thrown as Error).constructor.name).toBe('RedisUnavailableError');
    });
  });

  describe('Redis key', () => {
    it('passes rl:{tenantId} as KEYS[1]', async () => {
      const client = makeClient([1, 19, 20, NOW_MS + 2000]);
      const tenantId = 'tenant-xyz';

      await checkAndConsume(
        client as unknown as Redis,
        tenantId,
        makeConfig({ tenantId }),
        NOW_MS,
      );

      const callArgs: unknown[] = client.eval.mock.calls[0] as unknown[];
      // ioredis eval signature: eval(script, numkeys, key1, ...args)
      // KEYS[1] is the first key argument, at index 2
      expect(callArgs[2]).toBe(`rl:${tenantId}`);
    });
  });

  describe('cost argument', () => {
    it('defaults cost to 1 (ARGV[4] === "1") when cost is not provided', async () => {
      const client = makeClient([1, 19, 20, NOW_MS + 2000]);

      await checkAndConsume(
        client as unknown as Redis,
        'tenant-abc',
        makeConfig(),
        NOW_MS,
        // cost intentionally omitted
      );

      const callArgs: unknown[] = client.eval.mock.calls[0] as unknown[];
      // ioredis eval: eval(script, numkeys, key1, argv1, argv2, argv3, argv4)
      // ARGV[4] is at index 6 (script=0, numkeys=1, key1=2, argv1=3, argv2=4, argv3=5, argv4=6)
      expect(callArgs[6]).toBe('1');
    });

    it('passes the provided cost as ARGV[4]', async () => {
      const client = makeClient([1, 17, 20, NOW_MS + 2000]);

      await checkAndConsume(
        client as unknown as Redis,
        'tenant-abc',
        makeConfig(),
        NOW_MS,
        3,
      );

      const callArgs: unknown[] = client.eval.mock.calls[0] as unknown[];
      expect(callArgs[6]).toBe('3');
    });
  });

  describe('resetAtMs', () => {
    it('equals Math.ceil(nowMs + (burstSize / requestsPerSecond) * 1000)', async () => {
      const config = makeConfig({ requestsPerSecond: 10, burstSize: 20 });
      const expectedResetAtMs = Math.ceil(NOW_MS + (config.burstSize / config.requestsPerSecond) * 1000);

      const client = makeClient([1, 19, 20, expectedResetAtMs]);
      const result = await checkAndConsume(
        client as unknown as Redis,
        'tenant-abc',
        config,
        NOW_MS,
      );

      expect(result.resetAtMs).toBe(expectedResetAtMs);
    });
  });

  describe('tokensRemaining', () => {
    it('is a non-negative number', async () => {
      const client = makeClient([1, 19, 20, NOW_MS + 2000]);
      const result = await checkAndConsume(
        client as unknown as Redis,
        'tenant-abc',
        makeConfig(),
        NOW_MS,
      );

      expect(typeof result.tokensRemaining).toBe('number');
      expect(result.tokensRemaining).toBeGreaterThanOrEqual(0);
    });

    it('is 0 when the bucket is exhausted', async () => {
      const client = makeClient([0, 0, 20, NOW_MS + 2000]);
      const result = await checkAndConsume(
        client as unknown as Redis,
        'tenant-abc',
        makeConfig(),
        NOW_MS,
      );

      expect(result.tokensRemaining).toBe(0);
    });
  });

  describe('burstSize', () => {
    it('is echoed back from the script response', async () => {
      const config = makeConfig({ burstSize: 50 });
      const client = makeClient([1, 49, 50, NOW_MS + 5000]);
      const result = await checkAndConsume(
        client as unknown as Redis,
        'tenant-abc',
        config,
        NOW_MS,
      );

      expect(result.burstSize).toBe(50);
    });
  });
});

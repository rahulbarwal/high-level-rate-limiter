import { GlobalLimiter, GLOBAL_LIMIT_RPS } from '../../src/globalLimiter/globalLimiter';
import { TierLevel } from '../../src/globalLimiter/types';
import { RedisUnavailableError } from '../../src/redis/types';
import type { Redis } from 'ioredis';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW_MS = 1_700_000_000_000;

/** Builds a minimal Redis mock whose eval resolves with the given result. */
function makeClient(evalResult: unknown = [1, GLOBAL_LIMIT_RPS - 1, GLOBAL_LIMIT_RPS, NOW_MS + 1000]): {
  eval: jest.Mock;
} {
  return { eval: jest.fn().mockResolvedValue(evalResult) };
}

function makeLimiter(client: { eval: jest.Mock }): GlobalLimiter {
  return new GlobalLimiter({
    globalLimitRps: GLOBAL_LIMIT_RPS,
    redisClient: client as unknown as Redis,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GlobalLimiter', () => {
  beforeEach(() => jest.clearAllMocks());

  // -------------------------------------------------------------------------
  // GLOBAL_LIMIT_RPS constant
  // -------------------------------------------------------------------------

  describe('GLOBAL_LIMIT_RPS', () => {
    it('is 50_000', () => {
      expect(GLOBAL_LIMIT_RPS).toBe(50_000);
    });
  });

  // -------------------------------------------------------------------------
  // Tier 1 (ENTERPRISE) — always allowed, no Redis call
  // -------------------------------------------------------------------------

  describe('Tier 1 — ENTERPRISE', () => {
    it('returns true without calling Redis when global bucket is full', async () => {
      const client = makeClient([1, GLOBAL_LIMIT_RPS - 1, GLOBAL_LIMIT_RPS, NOW_MS + 1000]);
      const limiter = makeLimiter(client);

      const result = await limiter.tryConsume(TierLevel.ENTERPRISE, NOW_MS);

      expect(result).toBe(true);
      expect(client.eval).not.toHaveBeenCalled();
    });

    it('returns true without calling Redis even when global bucket is exhausted', async () => {
      const client = makeClient([0, 0, GLOBAL_LIMIT_RPS, NOW_MS + 1000]);
      const limiter = makeLimiter(client);

      const result = await limiter.tryConsume(TierLevel.ENTERPRISE, NOW_MS);

      expect(result).toBe(true);
      expect(client.eval).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Tier 2 (PAYING) — allowed when global bucket has capacity
  // -------------------------------------------------------------------------

  describe('Tier 2 — PAYING', () => {
    it('returns true when the global bucket allows the request', async () => {
      const client = makeClient([1, GLOBAL_LIMIT_RPS - 1, GLOBAL_LIMIT_RPS, NOW_MS + 1000]);
      const limiter = makeLimiter(client);

      const result = await limiter.tryConsume(TierLevel.PAYING, NOW_MS);

      expect(result).toBe(true);
    });

    it('returns false (shed) when the global bucket is exhausted', async () => {
      const client = makeClient([0, 0, GLOBAL_LIMIT_RPS, NOW_MS + 1000]);
      const limiter = makeLimiter(client);

      const result = await limiter.tryConsume(TierLevel.PAYING, NOW_MS);

      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Tier 3 (FREE) — shed before PAYING
  // -------------------------------------------------------------------------

  describe('Tier 3 — FREE', () => {
    it('returns true when the global bucket allows the request', async () => {
      const client = makeClient([1, GLOBAL_LIMIT_RPS - 1, GLOBAL_LIMIT_RPS, NOW_MS + 1000]);
      const limiter = makeLimiter(client);

      const result = await limiter.tryConsume(TierLevel.FREE, NOW_MS);

      expect(result).toBe(true);
    });

    it('returns false (shed) when the global bucket is exhausted', async () => {
      const client = makeClient([0, 0, GLOBAL_LIMIT_RPS, NOW_MS + 1000]);
      const limiter = makeLimiter(client);

      const result = await limiter.tryConsume(TierLevel.FREE, NOW_MS);

      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Tier 4 (INTERNAL) — shed first
  // -------------------------------------------------------------------------

  describe('Tier 4 — INTERNAL', () => {
    it('returns true when the global bucket allows the request', async () => {
      const client = makeClient([1, GLOBAL_LIMIT_RPS - 1, GLOBAL_LIMIT_RPS, NOW_MS + 1000]);
      const limiter = makeLimiter(client);

      const result = await limiter.tryConsume(TierLevel.INTERNAL, NOW_MS);

      expect(result).toBe(true);
    });

    it('returns false (shed) when the global bucket is exhausted', async () => {
      const client = makeClient([0, 0, GLOBAL_LIMIT_RPS, NOW_MS + 1000]);
      const limiter = makeLimiter(client);

      const result = await limiter.tryConsume(TierLevel.INTERNAL, NOW_MS);

      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Redis key — must use rl:__global__
  // -------------------------------------------------------------------------

  describe('Redis key', () => {
    it('calls checkAndConsume with key rl:__global__ for non-enterprise tiers', async () => {
      const client = makeClient([1, GLOBAL_LIMIT_RPS - 1, GLOBAL_LIMIT_RPS, NOW_MS + 1000]);
      const limiter = makeLimiter(client);

      await limiter.tryConsume(TierLevel.FREE, NOW_MS);

      const callArgs: unknown[] = client.eval.mock.calls[0] as unknown[];
      // ioredis eval: eval(script, numkeys, key1, ...args) — KEYS[1] is at index 2
      expect(callArgs[2]).toBe('rl:__global__');
    });

    it('does NOT call Redis for enterprise tier (no key used)', async () => {
      const client = makeClient();
      const limiter = makeLimiter(client);

      await limiter.tryConsume(TierLevel.ENTERPRISE, NOW_MS);

      expect(client.eval).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Global config — must use GLOBAL_LIMIT_RPS for both rate and burst
  // -------------------------------------------------------------------------

  describe('global bucket config', () => {
    it('passes GLOBAL_LIMIT_RPS as requestsPerSecond (ARGV[1])', async () => {
      const client = makeClient([1, GLOBAL_LIMIT_RPS - 1, GLOBAL_LIMIT_RPS, NOW_MS + 1000]);
      const limiter = makeLimiter(client);

      await limiter.tryConsume(TierLevel.INTERNAL, NOW_MS);

      const callArgs: unknown[] = client.eval.mock.calls[0] as unknown[];
      // ARGV[1] = requestsPerSecond, at index 3
      expect(callArgs[3]).toBe(String(GLOBAL_LIMIT_RPS));
    });

    it('passes GLOBAL_LIMIT_RPS as burstSize (ARGV[2])', async () => {
      const client = makeClient([1, GLOBAL_LIMIT_RPS - 1, GLOBAL_LIMIT_RPS, NOW_MS + 1000]);
      const limiter = makeLimiter(client);

      await limiter.tryConsume(TierLevel.INTERNAL, NOW_MS);

      const callArgs: unknown[] = client.eval.mock.calls[0] as unknown[];
      // ARGV[2] = burstSize, at index 4
      expect(callArgs[4]).toBe(String(GLOBAL_LIMIT_RPS));
    });
  });

  // -------------------------------------------------------------------------
  // RedisUnavailableError propagation
  // -------------------------------------------------------------------------

  describe('Redis error handling', () => {
    it('propagates RedisUnavailableError when Redis eval rejects', async () => {
      const client = makeClient();
      client.eval.mockRejectedValue(new Error('ECONNREFUSED'));
      const limiter = makeLimiter(client);

      await expect(limiter.tryConsume(TierLevel.FREE, NOW_MS)).rejects.toBeInstanceOf(
        RedisUnavailableError,
      );
    });

    it('does NOT propagate RedisUnavailableError for enterprise tier (no Redis call)', async () => {
      const client = makeClient();
      client.eval.mockRejectedValue(new Error('ECONNREFUSED'));
      const limiter = makeLimiter(client);

      // Enterprise bypasses Redis — should not throw even if Redis is down
      await expect(limiter.tryConsume(TierLevel.ENTERPRISE, NOW_MS)).resolves.toBe(true);
    });

    it('wraps generic Redis errors in RedisUnavailableError', async () => {
      const client = makeClient();
      client.eval.mockRejectedValue(new Error('some redis error'));
      const limiter = makeLimiter(client);

      let thrown: unknown;
      try {
        await limiter.tryConsume(TierLevel.PAYING, NOW_MS);
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeDefined();
      expect((thrown as Error).constructor.name).toBe('RedisUnavailableError');
    });
  });

  // -------------------------------------------------------------------------
  // Shedding priority — Tier 4 shed before Tier 3, Tier 3 before Tier 2
  // -------------------------------------------------------------------------

  describe('shedding priority order', () => {
    it('sheds INTERNAL (Tier 4) when bucket is exhausted', async () => {
      const client = makeClient([0, 0, GLOBAL_LIMIT_RPS, NOW_MS + 1000]);
      const limiter = makeLimiter(client);

      expect(await limiter.tryConsume(TierLevel.INTERNAL, NOW_MS)).toBe(false);
    });

    it('sheds FREE (Tier 3) when bucket is exhausted', async () => {
      const client = makeClient([0, 0, GLOBAL_LIMIT_RPS, NOW_MS + 1000]);
      const limiter = makeLimiter(client);

      expect(await limiter.tryConsume(TierLevel.FREE, NOW_MS)).toBe(false);
    });

    it('sheds PAYING (Tier 2) when bucket is exhausted', async () => {
      const client = makeClient([0, 0, GLOBAL_LIMIT_RPS, NOW_MS + 1000]);
      const limiter = makeLimiter(client);

      expect(await limiter.tryConsume(TierLevel.PAYING, NOW_MS)).toBe(false);
    });

    it('never sheds ENTERPRISE (Tier 1) even when bucket is exhausted', async () => {
      const client = makeClient([0, 0, GLOBAL_LIMIT_RPS, NOW_MS + 1000]);
      const limiter = makeLimiter(client);

      expect(await limiter.tryConsume(TierLevel.ENTERPRISE, NOW_MS)).toBe(true);
      expect(client.eval).not.toHaveBeenCalled();
    });
  });
});

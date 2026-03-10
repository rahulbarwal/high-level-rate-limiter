import { setRateLimitHeaders } from '../../src/middleware/headers';
import type { TokenBucketResult } from '../../src/redis/types';
import type { TenantConfig } from '../../src/config/types';
import type { Response } from 'express';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW_MS = 1_700_000_000_000;

const makeConfig = (overrides: Partial<TenantConfig> = {}): TenantConfig => ({
  tenantId: 'tenant-abc',
  requestsPerSecond: 10,
  burstSize: 100,
  enabled: true,
  updatedAt: new Date('2024-01-15T10:00:00.000Z'),
  ...overrides,
});

const makeResult = (overrides: Partial<TokenBucketResult> = {}): TokenBucketResult => ({
  allowed: true,
  tokensRemaining: 42,
  burstSize: 100,
  resetAtMs: NOW_MS + 10_000,
  ...overrides,
});

/** Minimal Express Response mock. */
function makeRes(): { set: jest.Mock } {
  return { set: jest.fn() };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the value passed to res.set() for a given header name (case-insensitive). */
function getHeader(mock: { set: jest.Mock }, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const call of mock.set.mock.calls as [string, string | number][]) {
    if (call[0].toLowerCase() === lower) {
      return String(call[1]);
    }
  }
  return undefined;
}

/** Returns true if res.set() was ever called with the given header name. */
function hasHeader(mock: { set: jest.Mock }, name: string): boolean {
  return getHeader(mock, name) !== undefined;
}

// ---------------------------------------------------------------------------
// Tests — allowed responses
// ---------------------------------------------------------------------------

describe('setRateLimitHeaders — allowed response', () => {
  const config = makeConfig({ burstSize: 100, requestsPerSecond: 10 });
  const result = makeResult({ allowed: true, tokensRemaining: 42, resetAtMs: NOW_MS + 10_000 });

  let res: ReturnType<typeof makeRes>;

  beforeEach(() => {
    res = makeRes();
    setRateLimitHeaders(res as unknown as Response, result, config);
  });

  it('sets X-RateLimit-Limit to config.burstSize', () => {
    expect(getHeader(res, 'X-RateLimit-Limit')).toBe(String(config.burstSize));
  });

  it('sets X-RateLimit-Remaining to Math.floor(result.tokensRemaining)', () => {
    expect(getHeader(res, 'X-RateLimit-Remaining')).toBe(
      String(Math.floor(result.tokensRemaining)),
    );
  });

  it('sets X-RateLimit-Reset to Math.ceil(result.resetAtMs / 1000)', () => {
    expect(getHeader(res, 'X-RateLimit-Reset')).toBe(
      String(Math.ceil(result.resetAtMs / 1000)),
    );
  });

  it('does NOT set Retry-After', () => {
    expect(hasHeader(res, 'Retry-After')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests — rejected (rate-limited) responses
// ---------------------------------------------------------------------------

describe('setRateLimitHeaders — rejected response', () => {
  const config = makeConfig({ burstSize: 100, requestsPerSecond: 10 });
  const result = makeResult({ allowed: false, tokensRemaining: 0, resetAtMs: NOW_MS + 10_000 });

  let res: ReturnType<typeof makeRes>;

  beforeEach(() => {
    res = makeRes();
    setRateLimitHeaders(res as unknown as Response, result, config);
  });

  it('sets X-RateLimit-Limit to config.burstSize', () => {
    expect(getHeader(res, 'X-RateLimit-Limit')).toBe(String(config.burstSize));
  });

  it('sets X-RateLimit-Remaining to Math.floor(result.tokensRemaining)', () => {
    expect(getHeader(res, 'X-RateLimit-Remaining')).toBe(
      String(Math.floor(result.tokensRemaining)),
    );
  });

  it('sets X-RateLimit-Reset to Math.ceil(result.resetAtMs / 1000)', () => {
    expect(getHeader(res, 'X-RateLimit-Reset')).toBe(
      String(Math.ceil(result.resetAtMs / 1000)),
    );
  });

  it('sets Retry-After to Math.ceil(1 / config.requestsPerSecond)', () => {
    expect(getHeader(res, 'Retry-After')).toBe(
      String(Math.ceil(1 / config.requestsPerSecond)),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests — edge cases
// ---------------------------------------------------------------------------

describe('setRateLimitHeaders — edge cases', () => {
  it('clamps X-RateLimit-Remaining to 0 when tokensRemaining is negative', () => {
    const config = makeConfig();
    const result = makeResult({ tokensRemaining: -5 });
    const res = makeRes();

    setRateLimitHeaders(res as unknown as Response, result, config);

    expect(getHeader(res, 'X-RateLimit-Remaining')).toBe('0');
  });

  it('X-RateLimit-Reset is an integer in seconds (not milliseconds)', () => {
    const config = makeConfig();
    const result = makeResult({ resetAtMs: NOW_MS + 7_500 });
    const res = makeRes();

    setRateLimitHeaders(res as unknown as Response, result, config);

    const resetValue = Number(getHeader(res, 'X-RateLimit-Reset'));

    // A millisecond-epoch value would be ~1.7 trillion; a seconds-epoch is ~1.7 billion.
    // Current Unix time in seconds is well under 10 billion.
    expect(resetValue).toBeLessThan(10_000_000_000);
    expect(Number.isInteger(resetValue)).toBe(true);
  });
});

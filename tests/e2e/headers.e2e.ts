import { test, expect } from '@playwright/test';

/**
 * E2E tests for rate-limit response headers.
 *
 * These tests target a running server at the baseURL configured in
 * playwright.config.ts (default: http://localhost:3000).
 *
 * They will FAIL until:
 *   - setRateLimitHeaders() is implemented and wired into the request middleware
 *   - The token-bucket Lua script is implemented (Phase B)
 *   - The server is running with Redis and a seeded tenant database
 */

const TENANT_ID = 'tenant-headers-e2e';

test.describe('Rate-limit response headers', () => {
  test('X-RateLimit-Limit is present and is a positive integer', async ({ request }) => {
    const res = await request.get('/api/test', {
      headers: { 'X-Tenant-ID': TENANT_ID },
    });

    const value = res.headers()['x-ratelimit-limit'];
    expect(value).toBeDefined();

    const parsed = Number(value);
    expect(Number.isInteger(parsed)).toBe(true);
    expect(parsed).toBeGreaterThan(0);
  });

  test('X-RateLimit-Remaining is present and is a non-negative integer', async ({ request }) => {
    const res = await request.get('/api/test', {
      headers: { 'X-Tenant-ID': TENANT_ID },
    });

    const value = res.headers()['x-ratelimit-remaining'];
    expect(value).toBeDefined();

    const parsed = Number(value);
    expect(Number.isInteger(parsed)).toBe(true);
    expect(parsed).toBeGreaterThanOrEqual(0);
  });

  test('X-RateLimit-Reset is present and is a Unix timestamp in seconds greater than current time', async ({
    request,
  }) => {
    const nowSeconds = Math.floor(Date.now() / 1000);

    const res = await request.get('/api/test', {
      headers: { 'X-Tenant-ID': TENANT_ID },
    });

    const value = res.headers()['x-ratelimit-reset'];
    expect(value).toBeDefined();

    const parsed = Number(value);
    expect(Number.isInteger(parsed)).toBe(true);

    // Must be a seconds-epoch value (not milliseconds — that would be ~1.7 trillion)
    expect(parsed).toBeLessThan(10_000_000_000);
    expect(parsed).toBeGreaterThan(nowSeconds);
  });

  test('Retry-After is present and is a positive integer on a 429 response', async ({
    request,
  }) => {
    // Send requests until a 429 is received or we exhaust the attempt budget.
    // A real token bucket with a small burst will hit the limit quickly.
    const MAX_ATTEMPTS = 200;
    let retryAfterValue: string | undefined;

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const res = await request.get('/api/test', {
        headers: { 'X-Tenant-ID': TENANT_ID },
      });

      if (res.status() === 429) {
        retryAfterValue = res.headers()['retry-after'];
        break;
      }
    }

    expect(retryAfterValue).toBeDefined();

    const parsed = Number(retryAfterValue);
    expect(Number.isInteger(parsed)).toBe(true);
    expect(parsed).toBeGreaterThan(0);
  });
});

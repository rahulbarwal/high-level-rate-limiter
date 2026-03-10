import { test, expect } from '@playwright/test';

/**
 * E2E tests for the token-bucket rate limiter.
 *
 * These tests target a running server at the baseURL configured in
 * playwright.config.ts (default: http://localhost:3000).
 *
 * They will FAIL until:
 *   - The Lua token-bucket script is implemented (Phase B)
 *   - checkAndConsume() is wired into the request middleware
 *   - The middleware sets X-RateLimit-* response headers
 *   - The server is running with Redis and a seeded tenant database
 */

const TENANT_ID = 'tenant-e2e';

test.describe('Token-bucket rate limiter — response headers', () => {
  test('response includes X-RateLimit-Limit header', async ({ request }) => {
    const res = await request.get('/api/test', {
      headers: { 'X-Tenant-ID': TENANT_ID },
    });

    expect(res.headers()).toHaveProperty('x-ratelimit-limit');
  });

  test('response includes X-RateLimit-Remaining header', async ({ request }) => {
    const res = await request.get('/api/test', {
      headers: { 'X-Tenant-ID': TENANT_ID },
    });

    expect(res.headers()).toHaveProperty('x-ratelimit-remaining');
  });

  test('response includes X-RateLimit-Reset header', async ({ request }) => {
    const res = await request.get('/api/test', {
      headers: { 'X-Tenant-ID': TENANT_ID },
    });

    expect(res.headers()).toHaveProperty('x-ratelimit-reset');
  });

  test('X-RateLimit-Remaining decreases on successive requests', async ({
    request,
  }) => {
    const first = await request.get('/api/test', {
      headers: { 'X-Tenant-ID': TENANT_ID },
    });
    const second = await request.get('/api/test', {
      headers: { 'X-Tenant-ID': TENANT_ID },
    });

    expect(first.status()).toBe(200);
    expect(second.status()).toBe(200);

    const remainingAfterFirst = Number(first.headers()['x-ratelimit-remaining']);
    const remainingAfterSecond = Number(second.headers()['x-ratelimit-remaining']);

    expect(remainingAfterSecond).toBeLessThan(remainingAfterFirst);
  });

  test('X-RateLimit-Remaining is a non-negative integer', async ({ request }) => {
    const res = await request.get('/api/test', {
      headers: { 'X-Tenant-ID': TENANT_ID },
    });

    const remaining = Number(res.headers()['x-ratelimit-remaining']);
    expect(Number.isInteger(remaining)).toBe(true);
    expect(remaining).toBeGreaterThanOrEqual(0);
  });

  test('X-RateLimit-Reset is a future epoch millisecond timestamp', async ({
    request,
  }) => {
    const beforeMs = Date.now();

    const res = await request.get('/api/test', {
      headers: { 'X-Tenant-ID': TENANT_ID },
    });

    const resetAtMs = Number(res.headers()['x-ratelimit-reset']);
    expect(resetAtMs).toBeGreaterThan(beforeMs);
  });
});

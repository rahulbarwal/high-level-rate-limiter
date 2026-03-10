import { test, expect } from '@playwright/test';

/**
 * E2E tests for the core rate-limiter middleware.
 *
 * These tests target a running server at the baseURL configured in
 * playwright.config.ts (default: http://localhost:3000).
 *
 * They will FAIL until:
 *   - createRateLimiterMiddleware() is implemented and mounted
 *   - The token-bucket Lua script is wired into the request pipeline
 *   - The server is running with Redis and a seeded tenant database
 *   - The tenant used here ('tenant-e2e-rl') has a small burstSize (e.g. 5)
 *     so the burst exhaustion test completes quickly
 */

const TENANT_ID = 'tenant-e2e-rl';
const BURST_SIZE = 5; // must match the seeded config for TENANT_ID

test.describe('Rate-limiter middleware — burst behaviour', () => {
  test(`first ${BURST_SIZE} requests all succeed (200)`, async ({ request }) => {
    const responses = await Promise.all(
      Array.from({ length: BURST_SIZE }, () =>
        request.get('/api/test', { headers: { 'X-Tenant-ID': TENANT_ID } }),
      ),
    );

    for (const res of responses) {
      expect(res.status()).toBe(200);
    }
  });

  test('request N+1 (beyond burst) receives 429', async ({ request }) => {
    // Exhaust the bucket first
    for (let i = 0; i < BURST_SIZE; i++) {
      await request.get('/api/test', { headers: { 'X-Tenant-ID': TENANT_ID } });
    }

    const overflow = await request.get('/api/test', {
      headers: { 'X-Tenant-ID': TENANT_ID },
    });

    expect(overflow.status()).toBe(429);
  });

  test('request N+1 includes correct X-RateLimit-* headers on 429', async ({ request }) => {
    for (let i = 0; i < BURST_SIZE; i++) {
      await request.get('/api/test', { headers: { 'X-Tenant-ID': TENANT_ID } });
    }

    const overflow = await request.get('/api/test', {
      headers: { 'X-Tenant-ID': TENANT_ID },
    });

    expect(overflow.headers()['x-ratelimit-limit']).toBeDefined();
    expect(overflow.headers()['x-ratelimit-remaining']).toBeDefined();
    expect(overflow.headers()['x-ratelimit-reset']).toBeDefined();
    expect(overflow.headers()['retry-after']).toBeDefined();
  });

  test('429 response body is { error: "rate_limit_exceeded" }', async ({ request }) => {
    for (let i = 0; i < BURST_SIZE; i++) {
      await request.get('/api/test', { headers: { 'X-Tenant-ID': TENANT_ID } });
    }

    const overflow = await request.get('/api/test', {
      headers: { 'X-Tenant-ID': TENANT_ID },
    });

    expect(overflow.status()).toBe(429);
    expect(await overflow.json()).toEqual({ error: 'rate_limit_exceeded' });
  });

  test('after waiting 1 second a new request is allowed (token refill)', async ({ request }) => {
    // Exhaust the bucket
    for (let i = 0; i < BURST_SIZE; i++) {
      await request.get('/api/test', { headers: { 'X-Tenant-ID': TENANT_ID } });
    }

    // Confirm it's exhausted
    const before = await request.get('/api/test', {
      headers: { 'X-Tenant-ID': TENANT_ID },
    });
    expect(before.status()).toBe(429);

    // Wait for at least one token to refill
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const after = await request.get('/api/test', {
      headers: { 'X-Tenant-ID': TENANT_ID },
    });
    expect(after.status()).toBe(200);
  });
});

test.describe('Rate-limiter middleware — error responses', () => {
  test('503 response body is { error: "service_unavailable" } when FORCE_REDIS_DOWN=true', async ({
    request,
  }) => {
    // The server must be started with FORCE_REDIS_DOWN=true for this test to
    // exercise the Redis-unavailable code path. The test asserts the contract
    // regardless of whether the server honours the env var yet.
    const res = await request.get('/api/test', {
      headers: {
        'X-Tenant-ID': TENANT_ID,
        'X-Force-Redis-Down': 'true', // alternative: server reads FORCE_REDIS_DOWN env
      },
    });

    // Only assert the body shape when the server actually returns 503.
    // If the env var is not wired yet the test will fail at the status check.
    expect(res.status()).toBe(503);
    expect(await res.json()).toEqual({ error: 'service_unavailable' });
  });
});

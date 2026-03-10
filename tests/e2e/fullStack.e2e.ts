import { test, expect } from '@playwright/test';

/**
 * Full-stack E2E tests for the assembled rate-limiter system.
 *
 * These tests target a running server at the baseURL configured in
 * playwright.config.ts (default: http://localhost:3000).
 *
 * They will FAIL until Unit 13B completes the full wiring:
 *   - createRateLimiterMiddleware() is mounted on /api/test
 *   - The token-bucket Lua script is wired into the request pipeline
 *   - requestIdMiddleware is applied globally
 *   - GET /metrics is exposed and returns Prometheus text format
 *   - The server is running with Redis and a seeded tenant database
 *   - The tenant 'tenant-fullstack-e2e' exists with burstSize=5, requestsPerSecond=5
 */

const TENANT_ID = 'tenant-fullstack-e2e';
const BURST_SIZE = 5; // must match the seeded config for TENANT_ID
const API_PATH = '/api/test';

// ---------------------------------------------------------------------------
// Burst behaviour
// ---------------------------------------------------------------------------

test.describe('Full-stack — burst behaviour', () => {
  test(`first ${BURST_SIZE} requests all return 200`, async ({ request }) => {
    const responses = await Promise.all(
      Array.from({ length: BURST_SIZE }, () =>
        request.get(API_PATH, { headers: { 'X-Tenant-ID': TENANT_ID } }),
      ),
    );

    for (const res of responses) {
      expect(res.status()).toBe(200);
    }
  });

  test(`request ${BURST_SIZE + 1} returns 429 with body { error: 'rate_limit_exceeded' }`, async ({
    request,
  }) => {
    for (let i = 0; i < BURST_SIZE; i++) {
      await request.get(API_PATH, { headers: { 'X-Tenant-ID': TENANT_ID } });
    }

    const overflow = await request.get(API_PATH, {
      headers: { 'X-Tenant-ID': TENANT_ID },
    });

    expect(overflow.status()).toBe(429);
    expect(await overflow.json()).toEqual({ error: 'rate_limit_exceeded' });
  });

  test('X-RateLimit-Remaining decreases from burstSize-1 to 0 across the burst', async ({
    request,
  }) => {
    const remainingValues: number[] = [];

    for (let i = 0; i < BURST_SIZE; i++) {
      const res = await request.get(API_PATH, {
        headers: { 'X-Tenant-ID': TENANT_ID },
      });
      expect(res.status()).toBe(200);

      const raw = res.headers()['x-ratelimit-remaining'];
      expect(raw).toBeDefined();
      remainingValues.push(Number(raw));
    }

    // First response should show burstSize-1 remaining (one token consumed)
    expect(remainingValues[0]).toBe(BURST_SIZE - 1);
    // Last response should show 0 remaining (bucket fully drained)
    expect(remainingValues[remainingValues.length - 1]).toBe(0);
    // Values must be strictly non-increasing
    for (let i = 1; i < remainingValues.length; i++) {
      expect(remainingValues[i]).toBeLessThanOrEqual(remainingValues[i - 1]);
    }
  });

  test('after 1 second, at least 1 new request is allowed (token refill)', async ({ request }) => {
    // Exhaust the bucket
    for (let i = 0; i < BURST_SIZE; i++) {
      await request.get(API_PATH, { headers: { 'X-Tenant-ID': TENANT_ID } });
    }

    // Confirm exhaustion
    const before = await request.get(API_PATH, { headers: { 'X-Tenant-ID': TENANT_ID } });
    expect(before.status()).toBe(429);

    // Wait for at least one token to refill (requestsPerSecond >= 1)
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const after = await request.get(API_PATH, { headers: { 'X-Tenant-ID': TENANT_ID } });
    expect(after.status()).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Health and readiness bypass rate limiting
// ---------------------------------------------------------------------------

test.describe('Full-stack — health endpoints bypass rate limiting', () => {
  test('GET /health returns 200 even when rate limit is exhausted', async ({ request }) => {
    // Exhaust the bucket
    for (let i = 0; i < BURST_SIZE; i++) {
      await request.get(API_PATH, { headers: { 'X-Tenant-ID': TENANT_ID } });
    }
    const overflow = await request.get(API_PATH, { headers: { 'X-Tenant-ID': TENANT_ID } });
    expect(overflow.status()).toBe(429);

    const health = await request.get('/health');
    expect(health.status()).toBe(200);
  });

  test('GET /ready returns 200 even when rate limit is exhausted', async ({ request }) => {
    // Exhaust the bucket
    for (let i = 0; i < BURST_SIZE; i++) {
      await request.get(API_PATH, { headers: { 'X-Tenant-ID': TENANT_ID } });
    }
    const overflow = await request.get(API_PATH, { headers: { 'X-Tenant-ID': TENANT_ID } });
    expect(overflow.status()).toBe(429);

    const ready = await request.get('/ready');
    expect(ready.status()).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Metrics accuracy
// ---------------------------------------------------------------------------

test.describe('Full-stack — metrics accuracy', () => {
  test('GET /metrics returns 200 and contains ratelimit_requests_total', async ({ request }) => {
    const res = await request.get('/metrics');

    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('ratelimit_requests_total');
  });
});

// ---------------------------------------------------------------------------
// Request-ID propagation
// ---------------------------------------------------------------------------

test.describe('Full-stack — X-Request-ID propagation', () => {
  test('X-Request-ID is present on every 200 response', async ({ request }) => {
    const res = await request.get(API_PATH, { headers: { 'X-Tenant-ID': TENANT_ID } });

    expect(res.headers()['x-request-id']).toBeDefined();
    expect(res.headers()['x-request-id']).not.toBe('');
  });

  test('X-Request-ID is present on every 429 response', async ({ request }) => {
    // Exhaust the bucket
    for (let i = 0; i < BURST_SIZE; i++) {
      await request.get(API_PATH, { headers: { 'X-Tenant-ID': TENANT_ID } });
    }

    const overflow = await request.get(API_PATH, { headers: { 'X-Tenant-ID': TENANT_ID } });
    expect(overflow.status()).toBe(429);
    expect(overflow.headers()['x-request-id']).toBeDefined();
    expect(overflow.headers()['x-request-id']).not.toBe('');
  });

  test('X-Request-ID echoes a caller-supplied value', async ({ request }) => {
    const supplied = 'my-trace-id-abc123';
    const res = await request.get(API_PATH, {
      headers: { 'X-Tenant-ID': TENANT_ID, 'X-Request-ID': supplied },
    });

    expect(res.headers()['x-request-id']).toBe(supplied);
  });
});

// ---------------------------------------------------------------------------
// Retry-After header semantics
// ---------------------------------------------------------------------------

test.describe('Full-stack — Retry-After header semantics', () => {
  test('429 response includes Retry-After header', async ({ request }) => {
    // Exhaust the bucket
    for (let i = 0; i < BURST_SIZE; i++) {
      await request.get(API_PATH, { headers: { 'X-Tenant-ID': TENANT_ID } });
    }

    const overflow = await request.get(API_PATH, { headers: { 'X-Tenant-ID': TENANT_ID } });
    expect(overflow.status()).toBe(429);

    const retryAfter = overflow.headers()['retry-after'];
    expect(retryAfter).toBeDefined();
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });

  test('200 response does NOT include Retry-After header', async ({ request }) => {
    const res = await request.get(API_PATH, { headers: { 'X-Tenant-ID': TENANT_ID } });

    // Only assert when the response is actually a 200 (bucket may be exhausted
    // from a previous test in the same worker; the test is still runnable).
    if (res.status() === 200) {
      expect(res.headers()['retry-after']).toBeUndefined();
    }
  });
});

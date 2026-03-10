import { test, expect } from '@playwright/test';

/**
 * E2E tests for the readiness endpoint.
 *
 * These tests target a running server at the baseURL configured in
 * playwright.config.ts (default: http://localhost:3000).
 *
 * They will FAIL until:
 *   - GET /ready is implemented and wired to checkRedisHealth
 *   - The server is running with a reachable Redis instance
 *
 * The "Redis unavailable" test relies on the server reading the env var
 * FORCE_REDIS_UNAVAILABLE=true at startup and short-circuiting the health
 * check — no real network manipulation required in CI.
 */

test.describe('GET /ready', () => {
  test('returns 200 with { status: "ready", redis: "ok" } when Redis is reachable', async ({
    request,
  }) => {
    const response = await request.get('/ready');

    expect(response.status()).toBe(200);

    const body = await response.json() as { status: string; redis: string };

    expect(body.status).toBe('ready');
    expect(body.redis).toBe('ok');
  });

  test('returns 503 when Redis is unreachable (FORCE_REDIS_UNAVAILABLE=true)', async ({
    request,
  }) => {
    // This test assumes the server under test was started with the env var
    // FORCE_REDIS_UNAVAILABLE=true, causing checkRedisHealth to return
    // 'unavailable' without attempting a real connection.
    //
    // In CI, run a second server process with that env var set and point
    // a separate Playwright project at its port, or use the server fixture
    // pattern to restart the server with the env var before this test.
    const response = await request.get('/ready');

    expect(response.status()).toBe(503);

    const body = await response.json() as { status: string; redis: string };

    expect(body.redis).toBe('unavailable');
  });
});

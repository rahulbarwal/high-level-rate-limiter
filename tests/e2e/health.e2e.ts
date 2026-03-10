import { test, expect } from '@playwright/test';

/**
 * E2E tests for the health and readiness endpoints.
 *
 * These tests target a running server at the baseURL configured in
 * playwright.config.ts (default: http://localhost:3000).
 *
 * They will FAIL until:
 *   - createHealthRouter is fully implemented and mounted at the app root
 *   - GET /health and GET /ready are wired up
 *   - The server is running with a reachable Redis instance
 * (Expected to pass after Unit 13.)
 */

test.describe('Health endpoints', () => {
  test('GET /health returns 200', async ({ request }) => {
    const res = await request.get('/health');

    expect(res.status()).toBe(200);
  });

  test('GET /health response body contains { status: "ok" }', async ({ request }) => {
    const res = await request.get('/health');

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'ok' });
  });

  test('GET /ready returns 200 when server is running normally', async ({ request }) => {
    const res = await request.get('/ready');

    expect(res.status()).toBe(200);
  });

  test('GET /ready response body contains { status: "ready" }', async ({ request }) => {
    const res = await request.get('/ready');

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'ready' });
  });
});

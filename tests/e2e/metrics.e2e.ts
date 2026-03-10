import { test, expect } from '@playwright/test';

/**
 * E2E tests for the Prometheus metrics endpoint.
 *
 * These tests target a running server at the baseURL configured in
 * playwright.config.ts (default: http://localhost:3000).
 *
 * They will FAIL until:
 *   - The real metric objects are registered with prom-client (Phase C)
 *   - collectMetrics() / getMetricsContentType() are wired to the real registry
 *   - GET /metrics is exposed and returns Prometheus text format
 *   - The rate-limiter middleware increments ratelimit_requests_total
 *   - The server is running with Redis and a seeded tenant database
 */

const TENANT_ID = 'tenant-metrics-e2e';

test.describe('GET /metrics — endpoint availability', () => {
  test('returns HTTP 200', async ({ request }) => {
    const res = await request.get('/metrics');
    expect(res.status()).toBe(200);
  });

  test('Content-Type header contains "text/plain"', async ({ request }) => {
    const res = await request.get('/metrics');
    expect(res.headers()['content-type']).toContain('text/plain');
  });

  test('response body contains "ratelimit_requests_total"', async ({ request }) => {
    const res = await request.get('/metrics');
    const body = await res.text();
    expect(body).toContain('ratelimit_requests_total');
  });
});

test.describe('GET /metrics — ratelimit_requests_total counter', () => {
  test('ratelimit_requests_total{result="allowed"} is > 0 after an allowed request', async ({
    request,
  }) => {
    // Make an allowed request to increment the counter
    await request.get('/api/test', {
      headers: { 'X-Tenant-ID': TENANT_ID },
    });

    const metricsRes = await request.get('/metrics');
    expect(metricsRes.status()).toBe(200);

    const body = await metricsRes.text();

    // Prometheus text format: metric_name{label="value",...} numeric_value
    const match = body.match(
      /ratelimit_requests_total\{[^}]*result="allowed"[^}]*\}\s+(\d+(?:\.\d+)?)/,
    );

    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThan(0);
  });

  test('ratelimit_requests_total{result="rejected"} is > 0 after a rejected request', async ({
    request,
  }) => {
    // Exhaust the bucket to trigger a rejection
    const MAX_ATTEMPTS = 200;
    let got429 = false;

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const res = await request.get('/api/test', {
        headers: { 'X-Tenant-ID': TENANT_ID },
      });
      if (res.status() === 429) {
        got429 = true;
        break;
      }
    }

    // Only assert the metric if we actually triggered a rejection
    expect(got429).toBe(true);

    const metricsRes = await request.get('/metrics');
    expect(metricsRes.status()).toBe(200);

    const body = await metricsRes.text();

    const match = body.match(
      /ratelimit_requests_total\{[^}]*result="rejected"[^}]*\}\s+(\d+(?:\.\d+)?)/,
    );

    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThan(0);
  });
});

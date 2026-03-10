import { test, expect } from '@playwright/test';

/**
 * E2E tests for the in-process config cache.
 *
 * These tests target a running server at the baseURL configured in
 * playwright.config.ts (default: http://localhost:3000).
 *
 * They will FAIL until:
 *   - The ConfigCache is wired into the request pipeline
 *   - The admin/API routes are implemented
 *   - The Prometheus metrics endpoint is exposed at GET /metrics
 *   - The server is running with a seeded database
 * (Expected to pass after Unit 13.)
 */

test.describe('Config cache — cache-miss metric deduplication', () => {
  test('two rapid requests for the same tenant produce exactly one cache miss', async ({
    request,
  }) => {
    const tenantId = 'tenant-known';

    // Fire two requests back-to-back with the same tenant header.
    // The second request must be served from the in-process cache, so only
    // one ratelimit_config_cache_miss_total increment should occur.
    const [res1, res2] = await Promise.all([
      request.get('/api/test', { headers: { 'X-Tenant-ID': tenantId } }),
      request.get('/api/test', { headers: { 'X-Tenant-ID': tenantId } }),
    ]);

    // Both requests must succeed (exact status code depends on middleware
    // implementation; 200 is the expected happy-path value).
    expect(res1.status()).toBe(200);
    expect(res2.status()).toBe(200);

    // Fetch the Prometheus metrics scrape endpoint.
    const metricsRes = await request.get('/metrics');
    expect(metricsRes.status()).toBe(200);

    const metricsText = await metricsRes.text();

    // Parse the counter value for ratelimit_config_cache_miss_total.
    // Prometheus text format: `metric_name{labels} value`
    // We match the line that contains the metric name and extract its value.
    const missCounterMatch = metricsText.match(
      /^ratelimit_config_cache_miss_total(?:\{[^}]*\})?\s+(\d+(?:\.\d+)?)/m,
    );

    expect(missCounterMatch).not.toBeNull();

    const missCount = Number(missCounterMatch![1]);

    // Exactly one miss must have been recorded across the two requests.
    expect(missCount).toBe(1);
  });
});

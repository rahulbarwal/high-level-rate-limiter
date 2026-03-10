import { test, expect } from '@playwright/test';

/**
 * E2E tests for the SpikeDetector integration.
 *
 * These tests target a running server at the baseURL configured in
 * playwright.config.ts (default: http://localhost:3000).
 *
 * They will FAIL until:
 *   - SpikeDetector is fully implemented and wired into the request pipeline
 *   - The test tenant is seeded with a very low burst limit (e.g. burstSize: 1)
 *     so that the 200 rapid requests all receive 429 responses
 *   - The Prometheus metrics endpoint is exposed at GET /metrics
 *   - abuse_spike_total is registered and incremented on spike detection
 * (Expected to pass after Unit 13.)
 */

const SPIKE_TENANT_ID = 'tenant-spike-e2e';
const RAPID_REQUEST_COUNT = 200;
const METRICS_POLL_INTERVAL_MS = 500;
const METRICS_POLL_TIMEOUT_MS = 10_000;

test.describe('SpikeDetector — end-to-end spike detection', () => {
  test('abuse_spike_total is incremented after 200 rapid rejected requests', async ({
    request,
  }) => {
    // Send 200 rapid requests for the spike tenant. The tenant is configured
    // with a very low burst limit so all requests should be rejected (429).
    const responses = await Promise.all(
      Array.from({ length: RAPID_REQUEST_COUNT }, () =>
        request.get('/api/test', {
          headers: { 'X-Tenant-ID': SPIKE_TENANT_ID },
        }),
      ),
    );

    // All requests must be rate-limited (429) to satisfy the spike condition.
    for (const res of responses) {
      expect(res.status()).toBe(429);
    }

    // Poll GET /metrics until abuse_spike_total{tenant_id="..."} > 0 or timeout.
    const deadline = Date.now() + METRICS_POLL_TIMEOUT_MS;
    let spikeCount = 0;

    while (Date.now() < deadline) {
      const metricsRes = await request.get('/metrics');
      expect(metricsRes.status()).toBe(200);

      const metricsText = await metricsRes.text();

      // Prometheus text format line example:
      //   abuse_spike_total{tenant_id="tenant-spike-e2e"} 1
      const pattern = new RegExp(
        `abuse_spike_total\\{[^}]*tenant_id="${SPIKE_TENANT_ID}"[^}]*\\}\\s+(\\d+(?:\\.\\d+)?)`,
      );
      const match = metricsText.match(pattern);

      if (match) {
        spikeCount = Number(match[1]);
        if (spikeCount > 0) break;
      }

      await new Promise((resolve) => setTimeout(resolve, METRICS_POLL_INTERVAL_MS));
    }

    expect(spikeCount).toBeGreaterThan(0);
  });
});

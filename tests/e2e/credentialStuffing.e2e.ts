import { test, expect } from '@playwright/test';

/**
 * E2E tests for CredentialStuffingDetector integration.
 *
 * These tests target a running server at the baseURL configured in
 * playwright.config.ts (default: http://localhost:3000).
 *
 * The CredentialStuffingDetector is wired to the auth middleware layer,
 * NOT the rate limiter. Detection events are observable via a test-only
 * event log endpoint at GET /internal/abuse-events (enabled only when
 * NODE_ENV=test).
 *
 * All tests in this file are skipped until the auth middleware integration
 * exists. (Expected to pass after Unit 13.)
 */

const AUTH_TENANT_ID = 'tenant-cs-e2e';
const BAD_CREDENTIAL_REQUESTS = 60;
const EVENT_LOG_POLL_INTERVAL_MS = 500;
const EVENT_LOG_POLL_TIMEOUT_MS = 10_000;

test.describe('CredentialStuffingDetector — end-to-end detection', () => {
  /**
   * Send 60 POST /auth/verify requests with bad credentials for a single tenant.
   * The auth middleware records each 401 response via CredentialStuffingDetector.
   * With 60 auth errors out of 60 total (100% error rate, count > 50), the
   * onSuspected callback must fire and append an event to the internal log.
   */
  test.skip(
    'onSuspected fires after 60 bad-credential requests and is visible in the event log',
    async ({ request }) => {
      // Send 60 requests with bad credentials — all should return 401
      const responses = await Promise.all(
        Array.from({ length: BAD_CREDENTIAL_REQUESTS }, () =>
          request.post('/auth/verify', {
            headers: { 'X-Tenant-ID': AUTH_TENANT_ID },
            data: { username: 'attacker', password: 'wrong-password' },
          }),
        ),
      );

      for (const res of responses) {
        expect(res.status()).toBe(401);
      }

      // Poll the internal abuse-events log until a CREDENTIAL_STUFFING_SUSPECTED
      // entry appears for our tenant, or the timeout expires.
      const deadline = Date.now() + EVENT_LOG_POLL_TIMEOUT_MS;
      let detected = false;

      while (Date.now() < deadline) {
        const logRes = await request.get('/internal/abuse-events');
        expect(logRes.status()).toBe(200);

        const events: Array<{ type: string; tenantId: string }> = await logRes.json();

        detected = events.some(
          (e) => e.type === 'CREDENTIAL_STUFFING_SUSPECTED' && e.tenantId === AUTH_TENANT_ID,
        );

        if (detected) break;

        await new Promise((resolve) => setTimeout(resolve, EVENT_LOG_POLL_INTERVAL_MS));
      }

      expect(detected).toBe(true);
    },
  );
});

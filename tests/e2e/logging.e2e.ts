import { test, expect } from '@playwright/test';

/**
 * E2E tests for the request-ID middleware and structured logging layer.
 *
 * These tests target a running server at the baseURL configured in
 * playwright.config.ts (default: http://localhost:3000).
 *
 * They will FAIL until:
 *   - requestIdMiddleware is implemented and mounted globally in src/app.ts
 *   - The middleware sets X-Request-ID on every response
 *   - The server is running
 */

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test.describe('Request-ID propagation', () => {
  test('response includes an X-Request-ID header', async ({ request }) => {
    const res = await request.get('/api/test', {
      headers: { 'X-Tenant-ID': 'tenant-logging-e2e' },
    });

    expect(res.headers()['x-request-id']).toBeDefined();
    expect(res.headers()['x-request-id']).not.toBe('');
  });

  test('X-Request-ID sent in the request is echoed back in the response header', async ({
    request,
  }) => {
    const sentId = 'my-trace-id-abc123';

    const res = await request.get('/api/test', {
      headers: {
        'X-Tenant-ID': 'tenant-logging-e2e',
        'X-Request-ID': sentId,
      },
    });

    expect(res.headers()['x-request-id']).toBe(sentId);
  });

  test('a UUID v4 is generated and returned when X-Request-ID is not sent', async ({
    request,
  }) => {
    const res = await request.get('/api/test', {
      headers: { 'X-Tenant-ID': 'tenant-logging-e2e' },
      // X-Request-ID intentionally omitted
    });

    const generatedId = res.headers()['x-request-id'];
    expect(generatedId).toBeDefined();
    expect(generatedId).not.toBe('');
    expect(generatedId).toMatch(UUID_V4_REGEX);
  });
});

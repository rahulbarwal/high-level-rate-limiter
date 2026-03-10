import { test, expect } from '@playwright/test';
import type { TenantConfig } from '../../src/config/types';

/**
 * E2E tests for the admin config endpoint.
 *
 * These tests target a running server at the baseURL configured in
 * playwright.config.ts (default: http://localhost:3000).
 *
 * They will FAIL until the admin route
 *   GET /admin/tenants/:tenantId/config
 * is implemented and the server is running with a seeded database.
 */

test.describe('GET /admin/tenants/:tenantId/config', () => {
  test('returns 200 with a valid TenantConfig JSON body for a known tenant', async ({
    request,
  }) => {
    // "tenant-known" must be seeded in the test database before this suite runs.
    const response = await request.get('/admin/tenants/tenant-known/config');

    expect(response.status()).toBe(200);

    const body: TenantConfig = await response.json();

    // Shape assertions — every field must be present and correctly typed
    expect(typeof body.tenantId).toBe('string');
    expect(body.tenantId).toBe('tenant-known');

    expect(typeof body.requestsPerSecond).toBe('number');
    expect(body.requestsPerSecond).toBeGreaterThan(0);

    expect(typeof body.burstSize).toBe('number');
    expect(body.burstSize).toBeGreaterThan(0);

    expect(typeof body.enabled).toBe('boolean');

    // updatedAt arrives as an ISO string over the wire; it must be parseable
    expect(typeof body.updatedAt).toBe('string');
    expect(new Date(body.updatedAt as unknown as string).toString()).not.toBe(
      'Invalid Date',
    );
  });

  test('returns 404 for an unknown tenant', async ({ request }) => {
    const response = await request.get(
      '/admin/tenants/unknown-tenant/config',
    );

    expect(response.status()).toBe(404);
  });
});

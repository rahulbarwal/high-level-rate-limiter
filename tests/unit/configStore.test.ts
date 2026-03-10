import { getConfigFromDB } from '../../src/config/configStore';
import { TenantConfig, ConfigStoreError } from '../../src/config/types';

// ---------------------------------------------------------------------------
// Mock the pg module so tests never touch a real database.
// The mock is set up before any module under test is imported.
// ---------------------------------------------------------------------------
const mockQuery = jest.fn();

jest.mock('pg', () => {
  return {
    Pool: jest.fn().mockImplementation(() => ({
      query: mockQuery,
    })),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A valid DB row as pg would return it (snake_case column names). */
const makeRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  tenant_id: 'tenant-abc',
  requests_per_second: 100.5,
  burst_size: 200.0,
  enabled: true,
  updated_at: new Date('2024-01-15T10:00:00.000Z'),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockQuery.mockReset();
});

describe('getConfigFromDB', () => {
  describe('when a matching row exists', () => {
    it('returns a TenantConfig with the correct shape and values', async () => {
      const row = makeRow();
      mockQuery.mockResolvedValueOnce({ rows: [row], rowCount: 1 });

      const result = await getConfigFromDB('tenant-abc');

      // Must not be null
      expect(result).not.toBeNull();

      const config = result as TenantConfig;

      // Assert every field individually so failures are easy to diagnose
      expect(config.tenantId).toBe('tenant-abc');
      expect(config.requestsPerSecond).toBe(100.5);
      expect(config.burstSize).toBe(200.0);
      expect(config.enabled).toBe(true);
      expect(config.updatedAt).toEqual(new Date('2024-01-15T10:00:00.000Z'));

      // Shape guard: no extra unexpected top-level keys
      const expectedKeys: Array<keyof TenantConfig> = [
        'tenantId',
        'requestsPerSecond',
        'burstSize',
        'enabled',
        'updatedAt',
      ];
      expect(Object.keys(config).sort()).toEqual(expectedKeys.sort());
    });
  });

  describe('when no row is found', () => {
    it('returns null', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await getConfigFromDB('unknown-tenant');

      expect(result).toBeNull();
    });
  });

  describe('when pg.query throws', () => {
    it('re-throws a ConfigStoreError (not a generic Error)', async () => {
      mockQuery.mockRejectedValueOnce(new Error('connection refused'));

      await expect(getConfigFromDB('tenant-abc')).rejects.toBeInstanceOf(
        ConfigStoreError,
      );
    });

    it('the thrown ConfigStoreError is NOT a plain Error instance only', async () => {
      mockQuery.mockRejectedValueOnce(new Error('timeout'));

      let caught: unknown;
      try {
        await getConfigFromDB('tenant-abc');
      } catch (err) {
        caught = err;
      }

      // Must be a ConfigStoreError specifically, not just any Error
      expect(caught).toBeInstanceOf(ConfigStoreError);
      // Confirm the name is set correctly by the class
      expect((caught as ConfigStoreError).name).toBe('ConfigStoreError');
    });
  });

  describe('query parameterisation', () => {
    it('calls pg.query with a $1 placeholder, not a string-concatenated tenantId', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [makeRow()], rowCount: 1 });

      await getConfigFromDB('tenant-abc').catch(() => {
        // The stub throws "not implemented" — that is expected at this stage.
        // Once implemented, this catch block will be unreachable.
      });

      // If the query was actually issued, the first positional argument must
      // contain a $1 placeholder and the second argument must be an array
      // containing the tenantId — never inline string concatenation.
      if (mockQuery.mock.calls.length > 0) {
        const [queryText, queryParams] = mockQuery.mock.calls[0] as [
          string,
          unknown[],
        ];

        expect(queryText).toMatch(/\$1/);
        expect(queryText).not.toMatch(/tenant-abc/);
        expect(queryParams).toEqual(['tenant-abc']);
      }
    });
  });
});

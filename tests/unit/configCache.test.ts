import { ConfigCache } from '../../src/config/configCache';
import { TenantConfig, ConfigStoreError, TierLevel } from '../../src/config/types';

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

const makeConfig = (overrides: Partial<TenantConfig> = {}): TenantConfig => ({
  tenantId: 'tenant-abc',
  requestsPerSecond: 100,
  burstSize: 200,
  enabled: true,
  updatedAt: new Date('2024-01-15T10:00:00.000Z'),
  tier: TierLevel.FREE,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Advance the fake clock by `ms` milliseconds. */
function advanceTimeBy(ms: number): void {
  jest.spyOn(Date, 'now').mockReturnValue(Date.now() + ms);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConfigCache', () => {
  let getConfig: jest.Mock<Promise<TenantConfig | null>, [string]>;
  let nowSpy: jest.SpyInstance;

  beforeEach(() => {
    getConfig = jest.fn();
    // Pin Date.now() to a stable baseline so TTL arithmetic is deterministic.
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Cache miss
  // -------------------------------------------------------------------------

  describe('cache miss', () => {
    it('calls getConfig when no entry exists for the tenantId', async () => {
      getConfig.mockResolvedValueOnce(makeConfig());
      const cache = new ConfigCache({ getConfig, ttlSeconds: 60 });

      await cache.getTenantConfig('tenant-abc');

      expect(getConfig).toHaveBeenCalledTimes(1);
      expect(getConfig).toHaveBeenCalledWith('tenant-abc');
    });

    it('returns the TenantConfig returned by getConfig', async () => {
      const config = makeConfig();
      getConfig.mockResolvedValueOnce(config);
      const cache = new ConfigCache({ getConfig, ttlSeconds: 60 });

      const result = await cache.getTenantConfig('tenant-abc');

      expect(result).toEqual(config);
    });
  });

  // -------------------------------------------------------------------------
  // Cache hit
  // -------------------------------------------------------------------------

  describe('cache hit', () => {
    it('does NOT call getConfig on a second request within the TTL window', async () => {
      getConfig.mockResolvedValue(makeConfig());
      const cache = new ConfigCache({ getConfig, ttlSeconds: 60 });

      await cache.getTenantConfig('tenant-abc');
      await cache.getTenantConfig('tenant-abc');

      expect(getConfig).toHaveBeenCalledTimes(1);
    });

    it('returns the cached value on a hit', async () => {
      const config = makeConfig();
      getConfig.mockResolvedValue(config);
      const cache = new ConfigCache({ getConfig, ttlSeconds: 60 });

      await cache.getTenantConfig('tenant-abc');
      const result = await cache.getTenantConfig('tenant-abc');

      expect(result).toEqual(config);
    });
  });

  // -------------------------------------------------------------------------
  // TTL expiry
  // -------------------------------------------------------------------------

  describe('TTL expiry', () => {
    it('calls getConfig again after the TTL has elapsed', async () => {
      const TTL_SECONDS = 60;
      getConfig.mockResolvedValue(makeConfig());
      const cache = new ConfigCache({ getConfig, ttlSeconds: TTL_SECONDS });

      // First call — populates cache
      await cache.getTenantConfig('tenant-abc');
      expect(getConfig).toHaveBeenCalledTimes(1);

      // Advance clock past the TTL
      nowSpy.mockReturnValue(1_000_000 + TTL_SECONDS * 1000 + 1);

      // Second call — TTL expired, must re-fetch
      await cache.getTenantConfig('tenant-abc');
      expect(getConfig).toHaveBeenCalledTimes(2);
    });

    it('does NOT re-fetch when the TTL has not yet elapsed', async () => {
      const TTL_SECONDS = 60;
      getConfig.mockResolvedValue(makeConfig());
      const cache = new ConfigCache({ getConfig, ttlSeconds: TTL_SECONDS });

      await cache.getTenantConfig('tenant-abc');

      // Advance clock to just before expiry
      nowSpy.mockReturnValue(1_000_000 + TTL_SECONDS * 1000 - 1);

      await cache.getTenantConfig('tenant-abc');
      expect(getConfig).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Stale fallback
  // -------------------------------------------------------------------------

  describe('stale fallback', () => {
    it('returns the stale entry and does NOT throw when getConfig throws after TTL', async () => {
      const TTL_SECONDS = 60;
      const staleConfig = makeConfig();
      getConfig.mockResolvedValueOnce(staleConfig);
      const cache = new ConfigCache({ getConfig, ttlSeconds: TTL_SECONDS });

      // Populate cache
      await cache.getTenantConfig('tenant-abc');

      // Expire the entry
      nowSpy.mockReturnValue(1_000_000 + TTL_SECONDS * 1000 + 1);

      // DB is now down
      getConfig.mockRejectedValueOnce(new ConfigStoreError('DB unavailable'));

      const result = await cache.getTenantConfig('tenant-abc');

      expect(result).toEqual(staleConfig);
    });
  });

  // -------------------------------------------------------------------------
  // No stale fallback — error propagation
  // -------------------------------------------------------------------------

  describe('no stale fallback', () => {
    it('propagates ConfigStoreError when getConfig throws and no cached entry exists', async () => {
      getConfig.mockRejectedValueOnce(new ConfigStoreError('DB unavailable'));
      const cache = new ConfigCache({ getConfig, ttlSeconds: 60 });

      await expect(cache.getTenantConfig('tenant-abc')).rejects.toBeInstanceOf(
        ConfigStoreError,
      );
    });
  });

  // -------------------------------------------------------------------------
  // evict(tenantId)
  // -------------------------------------------------------------------------

  describe('evict(tenantId)', () => {
    it('removes the entry so the next call hits getConfig again', async () => {
      getConfig.mockResolvedValue(makeConfig());
      const cache = new ConfigCache({ getConfig, ttlSeconds: 60 });

      // Populate cache
      await cache.getTenantConfig('tenant-abc');
      expect(getConfig).toHaveBeenCalledTimes(1);

      cache.evict('tenant-abc');

      // Must re-fetch after eviction
      await cache.getTenantConfig('tenant-abc');
      expect(getConfig).toHaveBeenCalledTimes(2);
    });

    it('only removes the evicted tenant, not others', async () => {
      getConfig.mockResolvedValue(makeConfig());
      const cache = new ConfigCache({ getConfig, ttlSeconds: 60 });

      await cache.getTenantConfig('tenant-abc');
      await cache.getTenantConfig('tenant-xyz');
      expect(getConfig).toHaveBeenCalledTimes(2);

      cache.evict('tenant-abc');

      // tenant-xyz should still be cached
      await cache.getTenantConfig('tenant-xyz');
      expect(getConfig).toHaveBeenCalledTimes(2);

      // tenant-abc must re-fetch
      await cache.getTenantConfig('tenant-abc');
      expect(getConfig).toHaveBeenCalledTimes(3);
    });
  });

  // -------------------------------------------------------------------------
  // evictAll()
  // -------------------------------------------------------------------------

  describe('evictAll()', () => {
    it('clears all entries so every subsequent call hits getConfig', async () => {
      getConfig.mockResolvedValue(makeConfig());
      const cache = new ConfigCache({ getConfig, ttlSeconds: 60 });

      await cache.getTenantConfig('tenant-abc');
      await cache.getTenantConfig('tenant-xyz');
      expect(getConfig).toHaveBeenCalledTimes(2);

      cache.evictAll();

      await cache.getTenantConfig('tenant-abc');
      await cache.getTenantConfig('tenant-xyz');
      expect(getConfig).toHaveBeenCalledTimes(4);
    });
  });

  // -------------------------------------------------------------------------
  // onCacheMiss callback
  // -------------------------------------------------------------------------

  describe('onCacheMiss callback', () => {
    it('is invoked on a cache miss', async () => {
      const onCacheMiss = jest.fn();
      getConfig.mockResolvedValue(makeConfig());
      const cache = new ConfigCache({ getConfig, ttlSeconds: 60, onCacheMiss });

      await cache.getTenantConfig('tenant-abc');

      expect(onCacheMiss).toHaveBeenCalledTimes(1);
    });

    it('is NOT invoked on a cache hit', async () => {
      const onCacheMiss = jest.fn();
      getConfig.mockResolvedValue(makeConfig());
      const cache = new ConfigCache({ getConfig, ttlSeconds: 60, onCacheMiss });

      await cache.getTenantConfig('tenant-abc'); // miss
      await cache.getTenantConfig('tenant-abc'); // hit

      // Callback must have fired exactly once (for the miss only)
      expect(onCacheMiss).toHaveBeenCalledTimes(1);
    });

    it('is invoked again after TTL expiry (which is a miss)', async () => {
      const TTL_SECONDS = 60;
      const onCacheMiss = jest.fn();
      getConfig.mockResolvedValue(makeConfig());
      const cache = new ConfigCache({
        getConfig,
        ttlSeconds: TTL_SECONDS,
        onCacheMiss,
      });

      await cache.getTenantConfig('tenant-abc'); // miss #1
      nowSpy.mockReturnValue(1_000_000 + TTL_SECONDS * 1000 + 1);
      await cache.getTenantConfig('tenant-abc'); // miss #2 (expired)

      expect(onCacheMiss).toHaveBeenCalledTimes(2);
    });

    it('is invoked after evict(tenantId)', async () => {
      const onCacheMiss = jest.fn();
      getConfig.mockResolvedValue(makeConfig());
      const cache = new ConfigCache({ getConfig, ttlSeconds: 60, onCacheMiss });

      await cache.getTenantConfig('tenant-abc'); // miss
      cache.evict('tenant-abc');
      await cache.getTenantConfig('tenant-abc'); // miss again

      expect(onCacheMiss).toHaveBeenCalledTimes(2);
    });
  });
});

import { TenantConfig, ConfigStoreError } from './types';

export interface ConfigCacheDeps {
  getConfig: (tenantId: string) => Promise<TenantConfig | null>;
  ttlSeconds?: number;
  onCacheMiss?: () => void;
}

interface CacheEntry {
  config: TenantConfig;
  fetchedAt: number;
}

const DEFAULT_TTL_SECONDS = 60;

export class ConfigCache {
  private readonly store = new Map<string, CacheEntry>();
  private readonly getConfig: ConfigCacheDeps['getConfig'];
  private readonly ttlMs: number;
  private readonly onCacheMiss: (() => void) | undefined;

  constructor(deps: ConfigCacheDeps) {
    this.getConfig = deps.getConfig;
    this.ttlMs = (deps.ttlSeconds ?? DEFAULT_TTL_SECONDS) * 1000;
    this.onCacheMiss = deps.onCacheMiss;
  }

  async getTenantConfig(tenantId: string): Promise<TenantConfig> {
    const entry = this.store.get(tenantId);
    const now = Date.now();

    // Cache hit: entry exists and has not expired
    if (entry !== undefined && now - entry.fetchedAt < this.ttlMs) {
      return entry.config;
    }

    // Cache miss (no entry or expired): attempt a fresh fetch
    this.onCacheMiss?.();

    try {
      const fresh = await this.getConfig(tenantId);

      if (fresh === null) {
        throw new ConfigStoreError(`No config found for tenant: ${tenantId}`);
      }

      this.store.set(tenantId, { config: fresh, fetchedAt: now });
      return fresh;
    } catch (err) {
      // Stale fallback: if a previous entry exists, return it rather than
      // propagating the error — the DB may be temporarily unavailable.
      if (entry !== undefined) {
        console.warn(
          `[ConfigCache] Failed to refresh config for "${tenantId}", serving stale entry. Error: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return entry.config;
      }

      // No stale entry to fall back on — re-throw as ConfigStoreError.
      if (err instanceof ConfigStoreError) {
        throw err;
      }
      throw new ConfigStoreError(
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  evict(tenantId: string): void {
    this.store.delete(tenantId);
  }

  evictAll(): void {
    this.store.clear();
  }
}

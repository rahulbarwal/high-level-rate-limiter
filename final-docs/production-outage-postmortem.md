This document is a postmortem for a high-severity production incident on the rate-limiter service, which serves 10k+ tenants. All findings are grounded in the actual implementation: token-bucket Lua script in Redis, per-tenant `ConfigCache` backed by PostgreSQL, `GlobalLimiter` at `rl:__global__`, and `SpikeDetector` / `CredentialStuffingDetector` abuse monitors.

# Incident Timeline

**Severity:** P1

**Duration:** ~58 minutes (detection to full recovery)

**Affected surface:** All non-enterprise tenants on write-heavy API routes

**Key signals:**

| Signal                | Baseline | Peak              |
| :-------------------- | :------- | :---------------- |
| P99 latency           | 150 ms   | 4.5 s             |
| Pod CPU (6 pods)      | ~30%     | ~92%              |
| DB write queue depth  | ~0       | ~14k pending rows |
| Downstream retry rate | nominal  | 40× normal        |

A new feature was deployed 3 hours before the incident began.

# Root cause analysis

## T+0:00 — Deployment (3 hours before detection)

A new feature was deployed that records last_seen_at for tenants.

The implementation introduced an UPDATE tenant_rate_limit_configs executed for each allowed request on certain high-traffic routes.

This write path was not load tested.

## T+3:00 — First signal

`ratelimit_redis_latency_ms` P99 crossed 80 ms (normal: ~3 ms). No alert fired because the histogram bucket thresholds were not tuned for this metric.

## T+3:07 — Alert fires

Two alerts fired:

- P99 latency > 2 s for 5 minutes
- Pod CPU > 85%

The incident was acknowledged within a few minutes.

## T+3:10 — Degradation accelerates

- Latency climbed from 700 ms → 4,500 ms P99.

- `ratelimit_redis_unavailable_total` began incrementing — Redis was still reachable but responding slowly because the app pods were saturating their connection pool.
- At the same time PostgreSQL write queue depth started increasing steadily.

- The new background writer was issuing concurrent `UPDATE` statements on the same `tenant_rate_limit_configs` table, creating write–read contention and growing the write queue.

## T+3:22 — Investigation begins

- Initial suspicion was Redis degradation because the Redis latency metric was the first signal.
  However Redis CPU and memory looked normal.
- Infrastructure health checked — no node-level failure found.

- Database read latency stable; write queue depth and lock wait time both increasing.
  - Tracing showed something unexpected: the new last_seen_at writer was executing inside the request path for every allowed request.
  - `ratelimit_config_cache_miss_total` counter showed a 6× spike in cache misses, confirming pods had lost warm caches.
  - With ~10k tenants and a short TTL, this already produced a steady stream of reads. Once pods restarted and lost warm caches, that read pressure increased significantly.

- Retry telemetry from the downstream service showed it was retrying `503 service_unavailable` responses with no backoff — the downstream client had a fixed 100 ms retry interval and no retry budget.

- Deploy history correlated the new writer with the start of degradation.

## T+3:46 — Mitigation begins

Mitigation steps were taken:

1. The last_seen_at writer was disabled via feature flag.
2. Downstream client retry interval was increased from 100 ms to 5 s with a retry cap.
3. ConfigCache TTL was temporarily increased to reduce database reads.

Within several minutes the database write queue began draining.

## T+4:05 — Recovery

System metrics gradually returned to normal:

- P99 latency returned below 200 ms.
- Pod CPU normalised across all 6 pods.
- Redis latency normalizedrementing.
- Downstream retry rate returned to baseline.

---

# Root Cause Analysis

## Primary Root Cause — Synchronous DB write on the hot request path

The new feature inserted a synchronous `UPDATE` to `tenant_rate_limit_configs` inside `createRateLimiterMiddleware` on every allowed request. This is the highest-frequency path in the system — every single request that passes the token-bucket check triggers it.

At 10k+ tenants and realistic traffic volumes, this translated to thousands of concurrent writes per second against a single PostgreSQL table.

- The table is also the source of truth for `ConfigCache.getTenantConfig()`, which issues `SELECT` queries against the same table on every cache miss.
- Under load, write pressure caused lock contention and increasing latency for reads.
- Those slower reads delayed request handling in the application layer, increasing event loop pressure and CPU usage.

## Contributing factors

## 1.Cache miss amplification

Tenant configs are cached in memory with a TTL of 60 seconds.Under normal conditions cache misses generate a manageable amount of database traffic.

However when pods restarted during the incident they lost their caches and began issuing fresh SELECT queries.

The `ConfigCache` does have a stale fallback, however, multiple pods warming their caches simultaneously caused a burst of database reads. Pods that had restarted also had no stale cache entry to fall back on, which resulted in 503 responses when config retrieval failed.

However, pods that had restarted had no stale entry to fall back on, so they threw `ConfigStoreError` and returned `503`, which fed the retry storm.

### 2. Downstream retry storm

The downstream service retried every `503 service_unavailable` at a fixed 100 ms interval. The rate limiter returns `503` on both `ConfigStoreError` and `RedisUnavailableError`:

```text
try {
      config = await cache.getTenantConfig(tenantId);
    } catch (err) {
      if (err instanceof ConfigStoreError) {
        logger.warn({
          event: 'rate_limit_error',
          tenant_id: tenantId,
          reason: 'config_unavailable',
          request_id: requestId,
          timestamp,
        });
        res.status(503).json({ error: 'service_unavailable' });
        return;
      }
      throw err;
    }
```

With no backoff and no retry budget, each `503` immediately generated a retry, which hit the already-saturated system again. This amplified load by approximately 40× at peak.

### 3. Global bucket contention under load

The GlobalLimiter and per-tenant token buckets share the same Redis client.

Under heavy application load Redis calls queued behind each other, adding additional latency to every request.

While Redis itself was healthy, the client pool in the application became saturated.

### 4. SpikeDetector did not trigger early enough

SpikeDetector triggers based on rejection rate (429 responses).

During this incident the dominant failure mode was 503, which the detectors never recorded.

Because of this the abuse detection pipeline produced no early signal. The `503` path returns before the `d.record()` call:

```text
try {
      config = await cache.getTenantConfig(tenantId);
    } catch (err) {
      if (err instanceof ConfigStoreError) {
        ...
        res.status(503).json({ error: 'service_unavailable' });
        return;   // ← detectors never called
      }
```

This meant the abuse detectors were blind to the degradation and produced no early signal.

---

# Fix & Patch Plan

## 1. Remove synchronous writes from the request path

The `last_seen_at` writer must be moved off the hot path entirely. Options in order of preference:

- Write to a local in-process buffer and flush asynchronously on a timer (e.g. every 10 s).

- Publish to an internal queue and process writes in a separate worker.

- Drop `last_seen_at` tracking from the rate-limiter service and handle it in the application layer where it is actually needed.

No `UPDATE` or `INSERT` should execute inside `createRateLimiterMiddleware` on the allowed path.

## 2. Protect ConfigCache against stampede

Add a per-key in-flight deduplication guard so that concurrent misses for the same `tenantId` share a single in-flight `SELECT` rather than each issuing their own:

```typescript
// Sketch — add to ConfigCache
private readonly inflight = new Map<string, Promise<TenantConfig>>();
async getTenantConfig(tenantId: string): Promise<TenantConfig> {
  const entry = this.store.get(tenantId);
  if (entry && Date.now() - entry.fetchedAt < this.ttlMs) return entry.config;
  const existing = this.inflight.get(tenantId);
  if (existing) return existing;
  const fetch = this.getConfig(tenantId).then(...).finally(() => {
    this.inflight.delete(tenantId);
  });
  this.inflight.set(tenantId, fetch);
  return fetch;
}
```

Additionally, increase the default TTL from 60 s to at least 120 s for production, and expose it as an environment variable so it can be tuned without a deploy.

## 3. Fix retry behaviour on the downstream client

The downstream service must not retry `503` responses with a fixed interval. Required changes:

- Exponential backoff with full jitter (e.g. `min(cap, base * 2^attempt) * random(0, 1)`).

- Maximum 3 retry attempts per request.

- A retry budget: no more than 10% of in-flight requests may be retries at any given moment.

- Treat `Retry-After` headers (already set by the rate limiter on `429`) as authoritative.

## 4. Record 503 outcomes in abuse detectors

Pass `503` to `d.record()` so detectors can observe dependency-failure patterns, not only rate-limit rejections:

```typescript
// In createRateLimiterMiddleware, before returning 503:
for (const d of detectors) {
  d.record(tenantId, 503);
}
res.status(503).json({ error: "service_unavailable" });
return;
```

This allows `SpikeDetector` to flag tenants that are generating disproportionate `503` volume during degraded conditions.

## 5. Separate Redis connections for global and per-tenant buckets

The `GlobalLimiter` and per-tenant `checkAndConsume` calls currently share the same `ioredis` client. Under connection pool saturation, global bucket evals queue behind per-tenant evals. Provide `GlobalLimiter` with a dedicated Redis client so global capacity checks are never blocked by per-tenant traffic.

## 6. Add `Retry-After` to 503 responses

The rate limiter already sets `Retry-After` on `429` responses via `setRateLimitHeaders`. Extend this to `503` responses with a short fixed value (e.g. 2 s) so downstream clients have a signal to back off even when the error is not a rate-limit rejection.

---

# Long-Term Process Improvements

## Load testing

- Load tests must simulate dependency slowness, not only dependency failure. A test that kills PostgreSQL will catch fail-closed behaviour; a test that adds 200 ms latency to PostgreSQL will catch the write-contention and cache-stampede patterns that caused this incident.

- Add a dedicated load test scenario for cache cold-start: simulate all pods restarting simultaneously and measure how long it takes for `ratelimit_config_cache_miss_total` to stabilise.

- Test retry amplification explicitly: configure the downstream client with its production retry settings and verify that a 10% `503` rate does not cause total request volume to exceed 2× baseline.

## Deployment strategy

- Any change that touches `tenant_rate_limit_configs` (reads or writes) must go through a canary deploy covering at least 5% of traffic for 30 minutes before full rollout.

- Canary success criteria must include `ratelimit_redis_latency_ms P99 < 20 ms`, `ratelimit_config_cache_miss_total rate < 2× baseline`, and `DB write queue depth stable`.

- Automatic rollback should trigger if any of these thresholds are breached during canary.

## Alert coverage

The following metrics exist in the codebase but had no alerts configured at the time of the incident:

| Metric                                   | Recommended alert threshold |
| :--------------------------------------- | :-------------------------- |
| `ratelimit_redis_latency_ms` P99         | > 25 ms for 3 min           |
| `ratelimit_redis_unavailable_total` rate | > 10/min                    |
| `ratelimit_config_cache_miss_total` rate | > 3× 5-min baseline         |
| `global_limit_shed_total` rate           | > 1% of total requests      |
| DB write queue depth                     | > 1,000 pending rows        |

A composite alert combining `latency spike + cache miss spike + redis unavailable increments` should page at higher urgency than any single signal alone, as the combination is a strong indicator of the cascading failure pattern seen here.

## SLO definition

The current SLO covers end-to-end API latency only. The following additions are recommended:

- **Rate-limiter decision latency SLO:** 99% of `checkAndConsume` calls (measured via `ratelimit_redis_latency_ms`) must complete within 20 ms. This decouples rate-limiter health from application-level latency and makes it possible to detect Redis degradation before it affects P99.

- **Config availability SLO:** `ratelimit_config_cache_miss_total` rate must not exceed 5× the rolling 1-hour baseline. Breaching this indicates either a cache stampede or a PostgreSQL availability issue.

- **Error budget for dependency-induced degradation:** Define a separate error budget for `503` responses caused by `ConfigStoreError` or `RedisUnavailableError`. These are infrastructure failures, not application bugs, and should not consume the same budget as application-level `5xx` errors.

## Release checklist additions

Any PR that modifies `createRateLimiterMiddleware`, `ConfigCache`, `configStore`, or `GlobalLimiter` must include sign-off on:

- [ ] No synchronous database writes on the allowed request path

- [ ] Cache TTL and stampede behaviour reviewed

- [ ] Retry and timeout configuration for all downstream calls documented

- [ ] Load test covering the changed path at 2× expected peak RPS

- [ ] Rollback procedure and feature flag verified

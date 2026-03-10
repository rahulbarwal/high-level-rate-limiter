# Platform Rate Limiter — Technical Specification

**SaaS Multi-Tenant API Gateway | v1.0 | March 2026**

---

| Parameter     | Value                                         |
| ------------- | --------------------------------------------- |
| Scope         | Platform-level, applied at API gateway        |
| Tenants       | 10,000+ flat tenant accounts                  |
| Resource      | HTTP API requests                             |
| Topology      | Single region                                 |
| Algorithm     | Token bucket with per-tenant config           |
| Throttle type | Hard — 429 Too Many Requests                  |
| Failure mode  | Fail-closed                                   |
| Rollout       | Direct to enforcement (conservative defaults) |

---

## 1. Overview & Goals

This document specifies the design of a scalable, platform-level rate limiter for a SaaS product with 10,000+ tenants. It is intended as a complete handoff specification for the implementing developer team.

The rate limiter enforces per-tenant API request limits using a token bucket algorithm backed by Redis. Each tenant has individually configured limits. When limits are exceeded, requests are immediately rejected with HTTP 429. If the Redis store is unavailable, all requests are rejected (fail-closed).

Secondary goals include abuse detection for sudden traffic spikes and credential stuffing patterns.

---

## 2. Key Design Decisions

### 2.1 Algorithm: Token Bucket

We use the token bucket algorithm because traffic is expected to be bursty in nature. Token bucket naturally models two distinct behaviours simultaneously:

- **Burst capacity:** tokens accumulate up to a maximum bucket size, allowing short-term traffic spikes above the sustained rate
- **Sustained ceiling:** tokens refill at a fixed rate (the configured rate limit), preventing indefinite over-use

This is preferable to a fixed window or sliding window counter, which would either allow double-rate bursts at window boundaries (fixed window) or impose strict per-second uniformity that penalises legitimate bursty clients (sliding window).

> **Why not leaky bucket?** Leaky bucket enforces a perfectly smooth output rate by queuing excess requests. This requires a request queue per tenant (memory + latency overhead) and doesn't align with our hard-reject requirement. Token bucket with hard reject is simpler and better suited here.

### 2.2 Storage: Redis

Redis is used as the single source of truth for all rate limit counters. Its atomic Lua scripting capability allows us to implement check-and-decrement as a single indivisible operation, eliminating race conditions without distributed locking overhead.

Redis is deployed in high-availability mode (Redis Sentinel or Redis Cluster) to reduce the blast radius of the fail-closed policy.

### 2.3 Consistency: Exact

Because we are single-region with a single Redis cluster, we can use exact counters rather than approximate distributed counters. Every request atomically reads and decrements the token bucket state in Redis. There is no eventual consistency lag, no counter drift between nodes.

---

## 3. Data Model

### 3.1 Limit Configuration Store

Tenant limit configurations are stored separately from counters. This store is read on every request (with local caching — see Section 5.2). It is the source of truth for each tenant's token bucket parameters.

| Field                 | Description                                                   |
| --------------------- | ------------------------------------------------------------- |
| `tenant_id`           | Unique identifier for the tenant (string)                     |
| `requests_per_second` | Sustained refill rate — tokens added per second               |
| `burst_size`          | Maximum token capacity — peak burst allowed                   |
| `enabled`             | Boolean — if false, rate limiting is bypassed for this tenant |
| `updated_at`          | Timestamp of last config change (for cache invalidation)      |

Example values by tier:

| Tier       | requests_per_second / burst_size   |
| ---------- | ---------------------------------- |
| Free       | 10 req/s / 50 tokens               |
| Pro        | 100 req/s / 500 tokens             |
| Enterprise | 1,000 req/s / 5,000 tokens         |
| Custom     | Configured individually per tenant |

### 3.2 Redis Token Bucket State

Each tenant's live bucket state is stored in Redis as two fields:

```
Key pattern:   rl:{tenant_id}

Fields:
  tokens        float   — current token count in the bucket
  last_refill   float   — Unix timestamp (ms) of last refill calculation

TTL:  Set to (burst_size / requests_per_second) * 3
      Auto-expires inactive tenant buckets.
```

---

## 4. Token Bucket Algorithm

### 4.1 Per-Request Logic

Every inbound API request executes the following Lua script atomically in Redis. This is a single round-trip — no separate read-then-write.

```lua
-- Inputs (passed as ARGV):
--   rate          tokens per second (float)
--   burst_size    max token capacity (float)
--   now           current timestamp in ms (float)
--   cost          tokens consumed by this request (default: 1)

local key        = KEYS[1]
local rate       = tonumber(ARGV[1])
local burst      = tonumber(ARGV[2])
local now        = tonumber(ARGV[3])
local cost       = tonumber(ARGV[4])

local data       = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens     = tonumber(data[1]) or burst
local last       = tonumber(data[2]) or now

-- Refill tokens based on elapsed time
local elapsed    = math.max(0, now - last)
local refill     = (elapsed / 1000) * rate
tokens           = math.min(burst, tokens + refill)

-- Check and consume
if tokens >= cost then
  tokens = tokens - cost
  redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
  redis.call('PEXPIRE', key, math.ceil((burst / rate) * 3000))
  return 1   -- ALLOWED
else
  redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
  return 0   -- REJECTED
end
```

### 4.2 Response Headers

All API responses — allowed and rejected — must include the following rate limit headers to enable well-behaved clients and SDKs to self-throttle:

| Header                  | Value                                                      |
| ----------------------- | ---------------------------------------------------------- |
| `X-RateLimit-Limit`     | The tenant's configured `burst_size`                       |
| `X-RateLimit-Remaining` | Tokens remaining after this request                        |
| `X-RateLimit-Reset`     | Unix timestamp (seconds) when bucket will be full          |
| `Retry-After`           | Seconds until next request is likely to succeed (429 only) |

---

## 5. System Architecture

### 5.1 Component Overview

```
  Inbound Request
       |
       v
  [API Gateway / Middleware]
       |
       |-- 1. Extract tenant_id from auth token / API key
       |
       |-- 2. Fetch limit config  <-- [Config Store + Local Cache]
       |
       |-- 3. Execute Lua script  <-- [Redis HA Cluster]
       |
       |-- 4a. ALLOWED --> forward to upstream service
       |-- 4b. REJECTED --> return HTTP 429 with headers
       |-- 4c. REDIS DOWN --> return HTTP 503 (fail-closed)
```

### 5.2 Config Cache

Fetching tenant config from the database on every request is not acceptable at scale. The rate limiter middleware maintains a local in-process cache of tenant configurations with the following properties:

- **TTL:** 60 seconds — configs are re-fetched from the database after expiry
- **Invalidation:** a config change event (via pub/sub or polling) triggers immediate cache eviction for the affected tenant
- **Cold start:** on cache miss, fetch synchronously from DB and populate cache before proceeding
- **Fallback:** if DB is unavailable on a cache miss, use the last known cached value if available; otherwise fail-closed

### 5.3 Redis High Availability

Because the system is fail-closed on Redis unavailability, Redis availability directly determines API availability. The Redis deployment must be:

- **Redis Sentinel (recommended for single region):** 1 primary + 2 replicas + 3 sentinel nodes. Automatic failover in under 30 seconds.
- **OR Redis Cluster:** if horizontal scaling of the keyspace is needed (>10M tenants or very high throughput). Adds complexity; not recommended unless benchmarks show it is necessary.

The rate limiter client must use a Redis client library with built-in Sentinel support and automatic reconnection with exponential backoff.

---

## 6. Failure Handling

### 6.1 Redis Unavailability

**Policy: Fail-closed.** All requests are rejected with HTTP 503 (not 429) when Redis cannot be reached. This signals a platform error rather than a client rate limit.

> **503 vs 429:** Use 503 Service Unavailable (not 429) on Redis failure. This distinguishes a platform outage from a genuine rate limit breach, allowing monitoring systems and clients to handle them differently.

| Scenario                   | Behaviour                                                               |
| -------------------------- | ----------------------------------------------------------------------- |
| Redis connection timeout   | Reject with 503. Log error. Increment `redis_unavailable_total` metric. |
| Redis connection refused   | Reject with 503. Trigger PagerDuty alert if sustained > 10s.            |
| Lua script execution error | Reject with 503. Log full error with `tenant_id` for debugging.         |
| Redis slow (>50ms latency) | Allow request but log warning. Do not reject on latency alone.          |

### 6.2 Config Store Unavailability

If the tenant config cannot be fetched and no cached value exists, reject with 503. If a stale cached value exists, use it and log a warning. This prevents a config store outage from becoming a complete API outage.

---

## 7. Abuse Detection

The rate limiter infrastructure is extended with two passive detection signals. These do not block requests directly — they emit events consumed by a separate abuse response system (e.g. automatic tenant suspension, alerting, or manual review queue).

### 7.1 Sudden Spike Detection

**Trigger:** a tenant's 429 rate exceeds a threshold relative to their baseline within a rolling window.

```
Condition:  rejection_rate_1min(tenant) > 10x  AND
            total_requests_1min(tenant) > 2x baseline

Action:     emit SPIKE_DETECTED event with {tenant_id, rate, baseline, timestamp}
            increment abuse_spike_total{tenant_id} metric
```

Baseline is computed as the tenant's p95 request rate over the trailing 7 days. Baselines are recomputed daily and stored in the config store.

### 7.2 Credential Stuffing Detection

**Trigger:** a tenant's API key is producing an abnormally high rate of authentication errors (HTTP 401/403).

```
Condition:  error_rate_5min(tenant, status=[401,403]) > 20%  AND
            error_count_5min(tenant) > 50

Action:     emit CREDENTIAL_STUFFING_SUSPECTED event
            flag tenant for review in admin dashboard
```

This signal is generated by the auth middleware layer and consumed by the same abuse response pipeline. The rate limiter middleware does not need to implement this directly — it only needs to emit per-request status codes into the metrics pipeline.

---

## 8. Rollout Plan

Per the product decision, we go directly to enforcement rather than a shadow/logging phase. The following phased rollout minimises risk while achieving this goal.

### Phase 1 — Conservative Enforcement (Week 1–2)

- Deploy rate limiter middleware with enforcement enabled
- All tenants start with a conservative default limit (suggested: 50 req/s, burst 200) unless they have a custom config already set
- Monitor 429 rates per tenant closely in the first 48 hours
- Any tenant triggering unexpectedly high 429 rates gets their limit temporarily raised and flagged for manual review
- **Success criterion:** fewer than 0.1% of total requests receive unexpected 429s attributable to the new limiter

### Phase 2 — Limit Calibration (Week 3–4)

- Analyse per-tenant p99 request rates from Phase 1 traffic
- Adjust default tier limits based on observed traffic patterns
- Migrate tenants to tier-based defaults where custom limits are not needed
- Run load tests against staging to validate Redis performance at 10x peak load

### Phase 3 — Abuse Detection Activation (Week 5)

- Enable spike detection and credential stuffing signals
- Wire events to admin dashboard for manual review (automated suspension in a later phase)
- Tune detection thresholds based on false positive rate observed in Phase 1–2 data

---

## 9. Observability

### 9.1 Required Metrics

| Metric                                                         | Description                                              |
| -------------------------------------------------------------- | -------------------------------------------------------- |
| `ratelimit_requests_total{tenant, result=[allowed\|rejected]}` | Core counter — track 429 rate per tenant                 |
| `ratelimit_redis_latency_ms` (histogram)                       | Lua script execution time. Alert if p99 > 10ms.          |
| `ratelimit_redis_unavailable_total`                            | Fail-closed events. Alert if rate > 0 sustained.         |
| `ratelimit_config_cache_miss_total`                            | Cache misses. High rate indicates config store pressure. |
| `abuse_spike_total{tenant_id}`                                 | Spike detection events per tenant.                       |

### 9.2 Logging

Every rejected request (429 or 503) must produce a structured log entry with at minimum:

```json
{
  "event": "rate_limit_rejected",
  "tenant_id": "t_abc123",
  "result": "rejected",
  "tokens_remaining": 0,
  "limit": 100,
  "burst": 500,
  "request_id": "req_xyz",
  "timestamp": "2026-03-10T13:00:00Z"
}
```

---

## 10. Open Questions & Future Considerations

| Topic                      | Notes                                                                                                                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cost-weighted requests     | Currently all requests cost 1 token. Consider variable cost (e.g. expensive endpoints cost 10) in a future iteration.                                                              |
| Global system limit        | A global cap across all tenants is not specified but may be needed to protect total Redis/backend capacity. To be revisited at 50k+ tenants.                                       |
| Multi-region expansion     | If the product expands to multiple regions, per-tenant counters must be replicated or tenant traffic pinned to a home region. Eventual consistency tradeoffs must be re-evaluated. |
| Automated suspension       | Phase 3 only routes abuse signals to a dashboard. Automated tenant suspension is a separate feature requiring legal/policy review.                                                 |
| Self-serve limit increases | Tenants currently cannot view or adjust their own limits. A tenant-facing rate limit dashboard is a recommended follow-on feature.                                                 |

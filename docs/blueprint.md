# Platform Rate Limiter — Implementation Blueprint

**Based on:** `docs/prd.md` | v1.0 | March 2026

---

## Project Overview

A platform-level, per-tenant token bucket rate limiter for a SaaS API gateway serving 10,000+ tenants. Backed by Redis with atomic Lua scripting, fail-closed failure mode, in-process config caching, structured observability, and passive abuse detection.

**Tech stack assumed:** Node.js (TypeScript), Express middleware, Redis (ioredis with Sentinel support), PostgreSQL for config store, Prometheus for metrics, Playwright for integration tests.

> Swap the framework/language layer as needed — the Redis Lua script, data model, and failure semantics are language-agnostic.

---

## Architecture at a Glance

```
Inbound Request
     │
     ▼
[Rate Limiter Middleware]
     │
     ├─ 1. Extract tenant_id
     ├─ 2. Fetch config  ◄── [Config Cache (in-process, 60s TTL)]
     │                            │
     │                            └── [Config Store (PostgreSQL)]
     ├─ 3. Execute Lua  ◄── [Redis HA (Sentinel)]
     │
     ├─ 4a. ALLOWED  → set headers → forward
     ├─ 4b. REJECTED → 429 + headers + log
     └─ 4c. REDIS DOWN → 503 + log + metric
```

---

## Two-Phase TDD Approach

Each unit of work (except Unit 1 — scaffolding) follows a strict two-phase structure:

- **Phase A — Tests First:** Write all Jest unit tests and Playwright integration tests. Every test must be runnable immediately (they will fail, which is expected). No production source files are created yet — only type stubs/interfaces needed to make the test files compile.
- **Phase B — Implementation:** Write the production code that makes all Phase A tests pass. No new tests are written in this phase. The prompt explicitly references the test files from Phase A.

This ensures the test suite is the specification, not an afterthought.

---

## Units of Work

---

### Unit 1 — Project Scaffolding & Repository Setup

**Goal:** Establish the project structure, dependency manifest, TypeScript config, linting, and test runners so all subsequent units have a consistent foundation. This is the only unit with no Phase A/B split — scaffolding must come first.

**Scope:**
- Initialize Node.js project with TypeScript
- Install core runtime dependencies: `ioredis`, `express`, `pg`, `prom-client`, `winston`, `uuid`
- Install dev dependencies: `jest`, `ts-jest`, `supertest`, `@types/*`, `playwright`, `@playwright/test`
- Configure `tsconfig.json`, `eslint`, `prettier`, `.env.example`
- Create directory structure: `src/middleware/`, `src/config/`, `src/redis/`, `src/metrics/`, `src/abuse/`, `src/routes/`, `tests/unit/`, `tests/integration/`, `tests/e2e/`
- Add a minimal Express app entry point (`src/app.ts`, `src/server.ts`) with a health-check route `GET /health → 200`
- Configure Jest for unit/integration tests and Playwright for e2e tests as separate test suites
- Add npm scripts: `build`, `start`, `test`, `test:unit`, `test:integration`, `test:e2e`, `lint`

**Testable outcome:** `npm run build` succeeds. `npm test` runs and the health-check route test passes.

---

**Prompt 1**

```
You are scaffolding a Node.js + TypeScript project for a platform-level API rate limiter.

Task: Set up the project from scratch. This is the foundation all other units build on.

Requirements:
1. Initialize a Node.js project with TypeScript (tsconfig targeting ES2020, strict mode on, paths configured).

2. Install runtime dependencies: ioredis, express, pg, prom-client, winston, uuid.

3. Install dev dependencies: jest, ts-jest, supertest, @types/node, @types/express, @types/jest,
   @types/supertest, @types/uuid, eslint, prettier, @playwright/test.

4. Create the following directory structure:
   src/
     app.ts          ← Express app factory (no listen call)
     server.ts       ← Entry point that calls app.listen
     middleware/
     config/
     redis/
     metrics/
     abuse/
     routes/
   tests/
     unit/
     integration/
     e2e/
   playwright.config.ts

5. In src/app.ts, create an Express app with a single route: GET /health → { status: "ok" }.

6. Configure Jest in jest.config.ts:
   - Two projects: "unit" (tests/unit/**) and "integration" (tests/integration/**)
   - ts-jest transformer, testEnvironment: node

7. Configure Playwright in playwright.config.ts:
   - testDir: tests/e2e
   - Use the built-in chromium project
   - baseURL: http://localhost:3000

8. Add npm scripts:
   - build: tsc
   - start: node dist/server.js
   - test: jest
   - test:unit: jest --selectProjects unit
   - test:integration: jest --selectProjects integration
   - test:e2e: playwright test
   - lint: eslint src/

9. Add a .env.example file with placeholders:
   PORT=3000
   REDIS_URL=redis://localhost:6379
   REDIS_SENTINELS=
   REDIS_MASTER_NAME=
   DB_CONNECTION_STRING=postgresql://localhost:5432/ratelimiter
   LOG_LEVEL=info

10. Write a Jest test in tests/unit/health.test.ts using supertest:
    - GET /health returns 200 with body { status: "ok" }

Constraints:
- Do not implement any rate limiting logic.
- All TypeScript must compile with zero errors.
- npm test must pass.
```

---

### Unit 2 — Config Store: Database Schema & Data Access Layer

---

#### Unit 2A — Config Store Tests

**Goal:** Write all tests for the config store DAL before any implementation exists. Define the TypeScript interfaces as stubs so the test files compile.

**Scope:**
- `src/config/types.ts` — `TenantConfig` interface and `ConfigStoreError` class (stubs only, no implementation logic)
- `src/config/configStore.ts` — stub file exporting `getConfigFromDB` as a placeholder that throws `'not implemented'`
- `tests/unit/configStore.test.ts` — full Jest test suite covering all DAL behaviours
- `tests/e2e/configStore.e2e.ts` — Playwright API test hitting a running server's future admin config endpoint (written now, will pass after Unit 2B)

**Testable outcome:** Test files compile. All tests fail with "not implemented" or similar — that is the expected state at the end of Phase A.

---

**Prompt 2A**

```
You are writing tests FIRST for the config store layer of a platform-level rate limiter.
No implementation exists yet. Your job is to write the tests and the minimum type stubs
needed to make the test files compile. Tests are expected to FAIL at this stage.

Context: Tenant rate limit configurations will be stored in PostgreSQL. Every tenant will
have: tenant_id (string), requests_per_second (float), burst_size (float), enabled (boolean),
updated_at (Date). A getConfigFromDB(tenantId) function will return TenantConfig | null.

Task: Write tests and type stubs only.

Requirements:
1. Create src/config/types.ts (STUB — types only, no logic):
   - TenantConfig interface: { tenantId: string; requestsPerSecond: number; burstSize: number; enabled: boolean; updatedAt: Date }
   - ConfigStoreError class extending Error (constructor takes message: string)

2. Create src/config/configStore.ts (STUB — signatures only):
   - Export getConfigFromDB(tenantId: string): Promise<TenantConfig | null>
   - Body: throw new Error('not implemented')

3. Write tests/unit/configStore.test.ts (Jest):
   - Import getConfigFromDB and mock the pg Pool
   - Test: returns a TenantConfig with correct shape when a row exists
     (assert all fields: tenantId, requestsPerSecond, burstSize, enabled, updatedAt)
   - Test: returns null when no row is found for the given tenantId
   - Test: throws ConfigStoreError (not a generic Error) when pg.query throws
   - Test: uses a parameterised query (assert query called with $1 placeholder, not string concat)

4. Write tests/e2e/configStore.e2e.ts (Playwright):
   - Test: GET /admin/tenants/:tenantId/config returns 200 with TenantConfig JSON for a known tenant
   - Test: GET /admin/tenants/unknown-tenant/config returns 404
   (These tests will pass only after the admin route is implemented in a later unit.)

Constraints:
- Do NOT write any implementation logic — only stubs and tests.
- Tests must compile with zero TypeScript errors.
- Tests are expected to fail at runtime — that is correct.
```

---

#### Unit 2B — Config Store Implementation

**Goal:** Implement the database schema and DAL to make all Unit 2A tests pass.

**Scope:**
- SQL migration file creating `tenant_rate_limit_configs` table with seed data
- Full implementation of `getConfigFromDB` in `src/config/configStore.ts`
- All Unit 2A Jest tests must now pass

---

**Prompt 2B**

```
You are implementing the config store layer for a platform-level rate limiter.
Tests are already written in tests/unit/configStore.test.ts. Your job is to write
production code that makes every test in that file pass.

Context: See src/config/types.ts for the TenantConfig interface and ConfigStoreError.
The test file mocks pg and asserts specific behaviours — match them exactly.

Task: Implement the database schema and data access layer.

Requirements:
1. Create db/migrations/001_create_tenant_rate_limit_configs.sql:
   - Table: tenant_rate_limit_configs
   - Columns: tenant_id (TEXT PRIMARY KEY), requests_per_second (FLOAT NOT NULL),
     burst_size (FLOAT NOT NULL), enabled (BOOLEAN NOT NULL DEFAULT true),
     updated_at (TIMESTAMPTZ NOT NULL DEFAULT now())
   - Seed rows:
     * tenant_id='__default__': 10 req/s, 50 burst
     * tenant_id='tenant_free_example': 10 req/s, 50 burst
     * tenant_id='tenant_pro_example': 100 req/s, 500 burst
     * tenant_id='tenant_enterprise_example': 1000 req/s, 5000 burst

2. Replace the stub in src/config/configStore.ts with a full implementation:
   - Create a pg Pool singleton from process.env.DB_CONNECTION_STRING
   - getConfigFromDB(tenantId): queries tenant_rate_limit_configs WHERE tenant_id = $1
   - Maps snake_case DB columns to camelCase TenantConfig fields
   - Returns null if rows.length === 0
   - Wraps all pg errors in ConfigStoreError

Constraints:
- Use parameterised queries only (no string interpolation).
- Do not add any new tests — only make the existing tests/unit/configStore.test.ts pass.
- All TypeScript must compile with zero errors.
- Run npm run test:unit -- --testPathPattern=configStore to verify.
```

---

### Unit 3 — In-Process Config Cache

---

#### Unit 3A — Config Cache Tests

**Goal:** Write all tests for the `ConfigCache` class before implementation. Define the class stub.

**Scope:**
- `src/config/configCache.ts` — stub class with method signatures only
- `tests/unit/configCache.test.ts` — full Jest suite covering hit, miss, TTL, stale fallback, eviction
- `tests/e2e/configCache.e2e.ts` — Playwright test verifying that two rapid requests to the same tenant do not produce two DB queries (observable via a `/metrics` cache miss counter)

---

**Prompt 3A**

```
You are writing tests FIRST for the in-process config cache of a platform-level rate limiter.
No implementation exists yet. Tests are expected to FAIL.

Context: A ConfigCache class will wrap getConfigFromDB with a 60-second TTL in-process cache.
It will support: cache hit (skip DB), cache miss (call DB), TTL expiry (re-fetch), stale fallback
(DB down but old entry exists), evict(tenantId), evictAll(), and an onCacheMiss callback.

Task: Write tests and stubs only.

Requirements:
1. Create src/config/configCache.ts (STUB):
   - Export ConfigCache class with constructor signature:
     (deps: { getConfig: (id: string) => Promise<TenantConfig | null>; ttlSeconds?: number; onCacheMiss?: () => void })
   - Method stubs (all throw 'not implemented'):
     getTenantConfig(tenantId: string): Promise<TenantConfig>
     evict(tenantId: string): void
     evictAll(): void

2. Write tests/unit/configCache.test.ts (Jest):
   - Mock getConfigFromDB as a jest.fn()
   - Test: cache hit — getConfig NOT called on second request within TTL window
   - Test: cache miss — getConfig called when no entry exists
   - Test: TTL expiry — getConfig called again after TTL elapses (use jest.spyOn(Date, 'now'))
   - Test: stale fallback — getConfig throws, stale entry returned, no error thrown
   - Test: no stale fallback — getConfig throws, no cached entry → ConfigStoreError propagated
   - Test: evict(tenantId) removes entry; next call hits getConfig again
   - Test: evictAll() clears all entries; subsequent calls hit getConfig
   - Test: onCacheMiss callback invoked on miss, NOT invoked on hit

3. Write tests/e2e/configCache.e2e.ts (Playwright):
   - Start the server, send two rapid GET /api/test requests with the same X-Tenant-ID
   - Fetch GET /metrics and assert ratelimit_config_cache_miss_total === 1 (not 2)
   (This test will pass only after the full stack is wired in Unit 13.)

Constraints:
- Do NOT write any implementation logic.
- Tests must compile. Tests are expected to fail at runtime.
```

---

#### Unit 3B — Config Cache Implementation

**Goal:** Implement `ConfigCache` to make all Unit 3A tests pass.

---

**Prompt 3B**

```
You are implementing the in-process config cache for a platform-level rate limiter.
Tests are already written in tests/unit/configCache.test.ts. Make every test pass.

Context: src/config/configCache.ts has a stub. src/config/types.ts has TenantConfig and
ConfigStoreError. The test file mocks the getConfig dependency and controls Date.now.

Task: Replace the ConfigCache stub with a full implementation.

Requirements:
- Internal Map storing { config: TenantConfig; fetchedAt: number } keyed by tenantId
- getTenantConfig:
  * Age < ttlSeconds → return cached (cache hit)
  * No entry or expired → call getConfig, store result, return it (cache miss, invoke onCacheMiss)
  * getConfig throws AND stale entry exists → log warning, return stale entry
  * getConfig throws AND no entry → re-throw ConfigStoreError
- evict(tenantId): delete from Map
- evictAll(): clear Map
- TTL default: 60 seconds (configurable via constructor)

Constraints:
- Do not add new tests. Make tests/unit/configCache.test.ts pass.
- All TypeScript must compile with zero errors.
- Run npm run test:unit -- --testPathPattern=configCache to verify.
```

---

### Unit 4 — Redis Client & Connection Management

---

#### Unit 4A — Redis Client Tests

**Goal:** Write all tests for the Redis client and health check before any implementation.

**Scope:**
- `src/redis/redisClient.ts` — stub
- `src/redis/redisHealth.ts` — stub
- `tests/unit/redisClient.test.ts` — full Jest suite
- `tests/e2e/redisHealth.e2e.ts` — Playwright test asserting `GET /ready` returns 200 when Redis is up

---

**Prompt 4A**

```
You are writing tests FIRST for the Redis client layer of a platform-level rate limiter.
No implementation exists yet. Tests are expected to FAIL.

Context: The rate limiter will use ioredis. It must support standalone and Sentinel modes.
If Redis is unavailable, all requests are rejected (fail-closed). A checkRedisHealth function
will PING Redis and return 'ok' or 'unavailable'.

Task: Write tests and stubs only.

Requirements:
1. Create src/redis/redisClient.ts (STUB):
   - RedisConfig type: { mode: 'standalone' | 'sentinel'; url?: string; sentinels?: Array<{host: string; port: number}>; masterName?: string }
   - Export createRedisClient(config: RedisConfig): Redis — stub, throws 'not implemented'
   - Export createClientFromEnv(): Redis — stub, throws 'not implemented'

2. Create src/redis/redisHealth.ts (STUB):
   - Export checkRedisHealth(client: Redis): Promise<'ok' | 'unavailable'> — stub, throws 'not implemented'

3. Write tests/unit/redisClient.test.ts (Jest):
   - Mock ioredis (jest.mock('ioredis'))
   - Test: createRedisClient with mode 'standalone' passes url to ioredis constructor
   - Test: createRedisClient with mode 'sentinel' passes sentinels array and masterName
   - Test: retryStrategy returns exponential backoff (100ms * attempt, capped at 30000ms)
   - Test: checkRedisHealth returns 'ok' when client.ping() resolves with 'PONG'
   - Test: checkRedisHealth returns 'unavailable' when client.ping() rejects
   - Test: checkRedisHealth returns 'unavailable' when client.ping() takes longer than 2 seconds

4. Write tests/e2e/redisHealth.e2e.ts (Playwright):
   - Test: GET /ready returns 200 { status: 'ready', redis: 'ok' } when server is running normally
   - Test: GET /ready returns 503 when Redis is unreachable
     (For CI: mock Redis unavailability via an env var the server reads at startup)

Constraints:
- Do NOT write implementation logic.
- Tests must compile. Tests are expected to fail at runtime.
```

---

#### Unit 4B — Redis Client Implementation

**Goal:** Implement the Redis client and health check to make all Unit 4A tests pass.

---

**Prompt 4B**

```
You are implementing the Redis client layer for a platform-level rate limiter.
Tests are already written in tests/unit/redisClient.test.ts. Make every test pass.

Context: src/redis/redisClient.ts and src/redis/redisHealth.ts have stubs.
The test file mocks ioredis and controls promise resolution timing.

Task: Replace stubs with full implementations.

Requirements:
1. createRedisClient(config):
   - standalone: new Redis(config.url, { retryStrategy })
   - sentinel: new Redis({ sentinels, name: masterName, retryStrategy })
   - retryStrategy(times): Math.min(100 * times, 30000)
   - On 'error' event: log with winston

2. createClientFromEnv():
   - Reads REDIS_URL, REDIS_SENTINELS (JSON array string), REDIS_MASTER_NAME from process.env
   - Calls createRedisClient with the appropriate mode

3. checkRedisHealth(client):
   - Race client.ping() against a 2-second timeout Promise
   - Returns 'ok' on PONG, 'unavailable' on rejection or timeout

Constraints:
- Do not add new tests. Make tests/unit/redisClient.test.ts pass.
- All TypeScript must compile with zero errors.
```

---

### Unit 5 — Token Bucket Lua Script Executor

---

#### Unit 5A — Token Bucket Tests

**Goal:** Write all tests for the Lua script executor before implementation.

**Scope:**
- `src/redis/luaScript.ts` — stub (empty string constant)
- `src/redis/types.ts` — `TokenBucketResult` interface and `RedisUnavailableError` class
- `src/redis/tokenBucket.ts` — stub
- `tests/unit/tokenBucket.test.ts` — full Jest suite
- `tests/e2e/tokenBucket.e2e.ts` — Playwright test asserting rate limit headers appear on API responses

---

**Prompt 5A**

```
You are writing tests FIRST for the token bucket Lua script executor of a platform-level
rate limiter. No implementation exists yet. Tests are expected to FAIL.

Context: An atomic Redis Lua script will check and consume tokens in a single round-trip.
The TypeScript wrapper checkAndConsume() will call client.eval() and return a TokenBucketResult.
Key pattern: rl:{tenantId}. On Redis error: throw RedisUnavailableError.

Task: Write tests and stubs only.

Requirements:
1. Create src/redis/types.ts:
   - TokenBucketResult: { allowed: boolean; tokensRemaining: number; burstSize: number; resetAtMs: number }
   - RedisUnavailableError class extending Error

2. Create src/redis/luaScript.ts (STUB):
   - Export RATE_LIMIT_SCRIPT = '' (empty string — will be filled in Phase B)

3. Create src/redis/tokenBucket.ts (STUB):
   - Export checkAndConsume(client: Redis, tenantId: string, config: TenantConfig, nowMs: number, cost?: number): Promise<TokenBucketResult>
   - Body: throw new Error('not implemented')

4. Write tests/unit/tokenBucket.test.ts (Jest):
   - Mock client as { eval: jest.fn(), hgetall: jest.fn() }
   - Test: client.eval returns 1 → result.allowed === true
   - Test: client.eval returns 0 → result.allowed === false
   - Test: client.eval throws → RedisUnavailableError is thrown (not a generic Error)
   - Test: correct key rl:{tenantId} is passed as KEYS[1]
   - Test: cost defaults to 1 when not provided (assert ARGV[4] === '1')
   - Test: resetAtMs = Math.ceil(nowMs + (burstSize / requestsPerSecond) * 1000)
   - Test: tokensRemaining is a non-negative number

5. Write tests/e2e/tokenBucket.e2e.ts (Playwright):
   - Send GET /api/test with X-Tenant-ID header
   - Assert response contains headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
   - Assert X-RateLimit-Remaining decreases on successive requests
   (Will pass after full stack is wired.)

Constraints:
- Do NOT write implementation logic.
- Tests must compile. Tests are expected to fail at runtime.
```

---

#### Unit 5B — Token Bucket Implementation

**Goal:** Implement the Lua script constant and `checkAndConsume` wrapper to make all Unit 5A tests pass.

---

**Prompt 5B**

```
You are implementing the token bucket Lua script executor for a platform-level rate limiter.
Tests are already written in tests/unit/tokenBucket.test.ts. Make every test pass.

Context: src/redis/types.ts has TokenBucketResult and RedisUnavailableError.
src/redis/luaScript.ts has an empty stub. src/redis/tokenBucket.ts has a stub.

Task: Replace stubs with full implementations.

Requirements:
1. Replace RATE_LIMIT_SCRIPT in src/redis/luaScript.ts with this exact Lua script:

   local key        = KEYS[1]
   local rate       = tonumber(ARGV[1])
   local burst      = tonumber(ARGV[2])
   local now        = tonumber(ARGV[3])
   local cost       = tonumber(ARGV[4])
   local data       = redis.call('HMGET', key, 'tokens', 'last_refill')
   local tokens     = tonumber(data[1]) or burst
   local last       = tonumber(data[2]) or now
   local elapsed    = math.max(0, now - last)
   local refill     = (elapsed / 1000) * rate
   tokens           = math.min(burst, tokens + refill)
   if tokens >= cost then
     tokens = tokens - cost
     redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
     redis.call('PEXPIRE', key, math.ceil((burst / rate) * 3000))
     return 1
   else
     redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
     return 0
   end

2. Implement checkAndConsume in src/redis/tokenBucket.ts:
   - Key: `rl:${tenantId}`
   - Call client.eval(RATE_LIMIT_SCRIPT, 1, key, rate, burst, nowMs, cost ?? 1)
   - allowed: result === 1
   - tokensRemaining: fetch via client.hget(key, 'tokens') after eval, parse as float, floor to 0 if negative
   - resetAtMs: Math.ceil(nowMs + (config.burstSize / config.requestsPerSecond) * 1000)
   - Wrap any thrown error in RedisUnavailableError

Constraints:
- Do not modify the Lua script.
- Do not add new tests. Make tests/unit/tokenBucket.test.ts pass.
- All TypeScript must compile with zero errors.
```

---

### Unit 6 — Rate Limit Response Headers

---

#### Unit 6A — Headers Tests

**Goal:** Write all tests for the header-setting utility before implementation.

**Scope:**
- `src/middleware/headers.ts` — stub
- `tests/unit/headers.test.ts` — full Jest suite
- `tests/e2e/headers.e2e.ts` — Playwright test asserting exact header values on live responses

---

**Prompt 6A**

```
You are writing tests FIRST for the rate limit response headers utility of a platform-level
rate limiter. No implementation exists yet. Tests are expected to FAIL.

Context: Every API response (allowed and rejected) must include rate limit headers.
A setRateLimitHeaders(res, result, config) function will set:
  X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After (429 only).

Task: Write tests and stubs only.

Requirements:
1. Create src/middleware/headers.ts (STUB):
   - Export setRateLimitHeaders(res: Response, result: TokenBucketResult, config: TenantConfig): void
   - Body: throw new Error('not implemented')

2. Write tests/unit/headers.test.ts (Jest):
   - Create a mock res object: { set: jest.fn() }
   - Test (allowed): X-RateLimit-Limit === config.burstSize
   - Test (allowed): X-RateLimit-Remaining === Math.floor(result.tokensRemaining)
   - Test (allowed): X-RateLimit-Reset === Math.ceil(result.resetAtMs / 1000)
   - Test (allowed): Retry-After header is NOT set
   - Test (rejected): all three X-RateLimit-* headers set correctly
   - Test (rejected): Retry-After === Math.ceil(1 / config.requestsPerSecond)
   - Test: X-RateLimit-Remaining is clamped to 0 when tokensRemaining is negative
   - Test: X-RateLimit-Reset is an integer in seconds (not milliseconds)

3. Write tests/e2e/headers.e2e.ts (Playwright):
   - Send GET /api/test with X-Tenant-ID header
   - Assert X-RateLimit-Limit is present and is a positive integer
   - Assert X-RateLimit-Remaining is present and is a non-negative integer
   - Assert X-RateLimit-Reset is present and is a Unix timestamp in seconds (> current time)
   - Send requests until a 429 is received; assert Retry-After is present and is a positive integer

Constraints:
- Do NOT write implementation logic.
- Tests must compile. Tests are expected to fail at runtime.
```

---

#### Unit 6B — Headers Implementation

**Goal:** Implement `setRateLimitHeaders` to make all Unit 6A tests pass.

---

**Prompt 6B**

```
You are implementing the rate limit response headers utility for a platform-level rate limiter.
Tests are already written in tests/unit/headers.test.ts. Make every test pass.

Context: src/middleware/headers.ts has a stub. The test mocks an Express Response object.

Task: Replace the stub with a full implementation.

Requirements:
- setRateLimitHeaders(res, result, config):
  * res.set('X-RateLimit-Limit', String(config.burstSize))
  * res.set('X-RateLimit-Remaining', String(Math.max(0, Math.floor(result.tokensRemaining))))
  * res.set('X-RateLimit-Reset', String(Math.ceil(result.resetAtMs / 1000)))
  * If result.allowed === false: res.set('Retry-After', String(Math.ceil(1 / config.requestsPerSecond)))

Constraints:
- Pure function — no side effects other than res.set calls.
- Do not add new tests. Make tests/unit/headers.test.ts pass.
- All TypeScript must compile with zero errors.
```

---

### Unit 7 — Core Rate Limiter Middleware

---

#### Unit 7A — Middleware Tests

**Goal:** Write all tests for the core middleware before implementation. This is the most critical unit — tests must cover every decision branch.

**Scope:**
- `src/middleware/rateLimiter.ts` — stub
- `tests/integration/rateLimiter.test.ts` — full Jest integration suite using supertest
- `tests/e2e/rateLimiter.e2e.ts` — Playwright e2e suite covering the full request lifecycle

---

**Prompt 7A**

```
You are writing tests FIRST for the core rate limiter middleware of a platform-level rate limiter.
No implementation exists yet. Tests are expected to FAIL.

Context: The middleware will orchestrate: tenant extraction → config cache lookup → token bucket
check → header setting → allow/reject decision. It must handle:
  - 200 pass-through when allowed
  - 429 with headers when rejected
  - 503 when Redis is unavailable (fail-closed)
  - 503 when config is unavailable
  - Bypass when config.enabled === false
  - 400 when X-Tenant-ID header is missing

Task: Write tests and stubs only.

Requirements:
1. Create src/middleware/rateLimiter.ts (STUB):
   - Export createRateLimiterMiddleware(deps: {
       cache: ConfigCache;
       redisClient: Redis;
       getTenantId?: (req: Request) => string | null;
     }): RequestHandler
   - Body: throw new Error('not implemented')

2. Write tests/integration/rateLimiter.test.ts (Jest + supertest):
   - Build a test Express app mounting the middleware on GET /api
   - Mock ConfigCache and checkAndConsume as jest.fn()
   - Test: allowed result → 200, X-RateLimit-* headers present on response
   - Test: rejected result → 429, body { error: 'rate_limit_exceeded' }, headers present
   - Test: checkAndConsume throws RedisUnavailableError → 503, body { error: 'service_unavailable' }
   - Test: cache.getTenantConfig throws ConfigStoreError → 503, body { error: 'service_unavailable' }
   - Test: config.enabled === false → 200, next() called, no checkAndConsume call
   - Test: missing X-Tenant-ID header → 400, body { error: 'missing_tenant_id' }
   - Test: custom getTenantId extractor is used when provided

3. Write tests/e2e/rateLimiter.e2e.ts (Playwright):
   - Test: burst of N requests all succeed (N = burstSize from config)
   - Test: request N+1 receives 429 with correct headers
   - Test: after waiting 1 second, a new request is allowed (token refill)
   - Test: 429 response body is { error: 'rate_limit_exceeded' }
   - Test: 503 response body is { error: 'service_unavailable' } when FORCE_REDIS_DOWN=true env var set

Constraints:
- Do NOT write implementation logic.
- Tests must compile. Tests are expected to fail at runtime.
```

---

#### Unit 7B — Middleware Implementation

**Goal:** Implement `createRateLimiterMiddleware` to make all Unit 7A tests pass.

---

**Prompt 7B**

```
You are implementing the core rate limiter middleware for a platform-level rate limiter.
Tests are already written in tests/integration/rateLimiter.test.ts. Make every test pass.

Context:
- src/config/configCache.ts: ConfigCache with getTenantConfig
- src/redis/tokenBucket.ts: checkAndConsume returning TokenBucketResult
- src/middleware/headers.ts: setRateLimitHeaders
- src/redis/types.ts: RedisUnavailableError
- src/config/types.ts: ConfigStoreError

Task: Replace the stub in src/middleware/rateLimiter.ts with a full implementation.

Middleware logic (in order):
a. Extract tenantId via getTenantId(req) (default: req.headers['x-tenant-id'] as string)
   → If missing: return 400 { error: 'missing_tenant_id' }
b. Call cache.getTenantConfig(tenantId)
   → On ConfigStoreError: return 503 { error: 'service_unavailable' }
c. If config.enabled === false: call next() and return
d. Call checkAndConsume(redisClient, tenantId, config, Date.now())
   → On RedisUnavailableError: return 503 { error: 'service_unavailable' }
e. Call setRateLimitHeaders(res, result, config)
f. If result.allowed: call next()
g. If !result.allowed: return 429 { error: 'rate_limit_exceeded' }

Structured log on 429 (winston JSON):
{ event: 'rate_limit_rejected', tenant_id, result: 'rejected', tokens_remaining,
  limit: burstSize, burst: burstSize, request_id: req.headers['x-request-id'], timestamp }

Structured log on 503:
{ event: 'rate_limit_error', tenant_id, reason: 'redis_unavailable' | 'config_unavailable',
  request_id, timestamp }

Constraints:
- Do not catch errors from next().
- Do not add new tests. Make tests/integration/rateLimiter.test.ts pass.
- All TypeScript must compile with zero errors.
```

---

### Unit 8 — Prometheus Metrics

---

#### Unit 8A — Metrics Tests

**Goal:** Write all tests for the metrics module and its wiring before implementation.

**Scope:**
- `src/metrics/metrics.ts` — stub
- `tests/unit/metrics.test.ts` — full Jest suite
- `tests/e2e/metrics.e2e.ts` — Playwright test scraping the `/metrics` endpoint

---

**Prompt 8A**

```
You are writing tests FIRST for the Prometheus metrics module of a platform-level rate limiter.
No implementation exists yet. Tests are expected to FAIL.

Context: The system must expose five metrics (PRD §9.1):
  ratelimit_requests_total{tenant, result}
  ratelimit_redis_latency_ms (histogram)
  ratelimit_redis_unavailable_total
  ratelimit_config_cache_miss_total
  abuse_spike_total{tenant_id}
A GET /metrics endpoint must return Prometheus text format.

Task: Write tests and stubs only.

Requirements:
1. Create src/metrics/metrics.ts (STUB):
   - Export stub objects for each metric (with inc: jest.fn(), observe: jest.fn(), startTimer: jest.fn())
   - Export metricsRegistry stub
   - Export getMetricsContentType(): string → returns ''
   - Export collectMetrics(): Promise<string> → returns Promise.resolve('')

2. Write tests/unit/metrics.test.ts (Jest):
   - Use a fresh prom-client Registry per test (beforeEach)
   - Test: rateLimitRequestsTotal.inc called with { tenant, result: 'allowed' } on allowed request
   - Test: rateLimitRequestsTotal.inc called with { tenant, result: 'rejected' } on rejected request
   - Test: rateLimitRedisLatencyMs.startTimer() called before checkAndConsume; end() called after
   - Test: rateLimitRedisUnavailableTotal.inc called when RedisUnavailableError is thrown
   - Test: rateLimitConfigCacheMissTotal.inc called on cache miss (via onCacheMiss callback)
   - Test: abuseSpikeTotal.inc called with { tenant_id } when spike detected

3. Write tests/e2e/metrics.e2e.ts (Playwright):
   - Test: GET /metrics returns 200
   - Test: Content-Type header contains 'text/plain'
   - Test: response body contains 'ratelimit_requests_total'
   - Test: after making an allowed request, ratelimit_requests_total{result="allowed"} > 0
   - Test: after making a rejected request, ratelimit_requests_total{result="rejected"} > 0

Constraints:
- Do NOT write implementation logic.
- Tests must compile. Tests are expected to fail at runtime.
```

---

#### Unit 8B — Metrics Implementation

**Goal:** Implement the metrics module and wire it into the middleware and cache to make all Unit 8A tests pass.

---

**Prompt 8B**

```
You are implementing Prometheus metrics instrumentation for a platform-level rate limiter.
Tests are already written in tests/unit/metrics.test.ts. Make every test pass.

Context: src/metrics/metrics.ts has stubs. The middleware (src/middleware/rateLimiter.ts)
and config cache (src/config/configCache.ts) need metrics wired in.

Task: Replace stubs and wire metrics into existing components.

Requirements:
1. Replace src/metrics/metrics.ts stubs with real prom-client implementations:
   - Use a named Registry instance (not the global default) for testability
   - rateLimitRequestsTotal: Counter({ name, help, labelNames: ['tenant', 'result'] })
   - rateLimitRedisLatencyMs: Histogram({ name, help, buckets: [1, 5, 10, 25, 50, 100, 250] })
   - rateLimitRedisUnavailableTotal: Counter({ name, help })
   - rateLimitConfigCacheMissTotal: Counter({ name, help })
   - abuseSpikeTotal: Counter({ name, help, labelNames: ['tenant_id'] })
   - collectMetrics(): Promise<string> → metricsRegistry.metrics()
   - getMetricsContentType(): string → Registry.PROMETHEUS_CONTENT_TYPE

2. Update src/middleware/rateLimiter.ts:
   - Accept optional metrics in deps (default to real metrics module)
   - Increment rateLimitRequestsTotal after each decision
   - Wrap checkAndConsume with rateLimitRedisLatencyMs.startTimer()
   - Increment rateLimitRedisUnavailableTotal on RedisUnavailableError

3. Update src/config/configCache.ts:
   - Pass rateLimitConfigCacheMissTotal.inc.bind(rateLimitConfigCacheMissTotal) as onCacheMiss

4. Add GET /metrics to src/app.ts returning collectMetrics() with correct Content-Type

Constraints:
- Do not add new tests. Make tests/unit/metrics.test.ts pass.
- All TypeScript must compile with zero errors.
```

---

### Unit 9 — Structured Logging

---

#### Unit 9A — Logging Tests

**Goal:** Write all tests for the logger and request ID middleware before implementation.

**Scope:**
- `src/logger.ts` — stub
- `src/middleware/requestId.ts` — stub
- `tests/unit/logger.test.ts` — full Jest suite
- `tests/e2e/logging.e2e.ts` — Playwright test verifying `X-Request-ID` header on responses

---

**Prompt 9A**

```
You are writing tests FIRST for the structured logging layer of a platform-level rate limiter.
No implementation exists yet. Tests are expected to FAIL.

Context: A centralised winston logger will output structured JSON. A requestId middleware will
attach a UUID to every request (from X-Request-ID header or generated). Every 429 log entry
must match the PRD §9.2 schema exactly.

Task: Write tests and stubs only.

Requirements:
1. Create src/logger.ts (STUB):
   - RejectionLogEntry type: { event: 'rate_limit_rejected'; tenant_id: string; result: 'rejected';
     tokens_remaining: number; limit: number; burst: number; request_id: string; timestamp: string }
   - Export logger stub: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
   - Export logRejection(fields: RejectionLogEntry): void — stub, throws 'not implemented'

2. Create src/middleware/requestId.ts (STUB):
   - Extend Express Request type: declare namespace Express { interface Request { requestId: string } }
   - Export requestIdMiddleware: RequestHandler — stub, calls next() without setting requestId

3. Write tests/unit/logger.test.ts (Jest):
   - Spy on the winston logger's write stream or mock winston
   - Test: logRejection outputs a JSON object containing all PRD §9.2 fields:
     event, tenant_id, result, tokens_remaining, limit, burst, request_id, timestamp
   - Test: logRejection output is valid JSON (JSON.parse does not throw)
   - Test: requestIdMiddleware sets req.requestId to the value of X-Request-ID header when present
   - Test: requestIdMiddleware generates a UUID v4 when X-Request-ID header is absent
   - Test: requestIdMiddleware sets X-Request-ID on the response with the same value
   - Test: the generated request ID matches UUID v4 format regex

4. Write tests/e2e/logging.e2e.ts (Playwright):
   - Test: response includes X-Request-ID header
   - Test: if X-Request-ID is sent in the request, the same value is echoed in the response header
   - Test: if X-Request-ID is not sent, the response still includes a non-empty X-Request-ID header

Constraints:
- Do NOT write implementation logic.
- Tests must compile. Tests are expected to fail at runtime.
```

---

#### Unit 9B — Logging Implementation

**Goal:** Implement the logger and request ID middleware to make all Unit 9A tests pass.

---

**Prompt 9B**

```
You are implementing structured logging for a platform-level rate limiter.
Tests are already written in tests/unit/logger.test.ts. Make every test pass.

Context: src/logger.ts and src/middleware/requestId.ts have stubs.

Task: Replace stubs with full implementations.

Requirements:
1. src/logger.ts:
   - Create winston logger: format.combine(format.timestamp(), format.json()), Console transport
   - level: process.env.LOG_LEVEL || 'info'
   - logRejection(fields: RejectionLogEntry): calls logger.warn(fields)

2. src/middleware/requestId.ts:
   - Read req.headers['x-request-id'] as string; if absent, generate uuidv4()
   - Set req.requestId = id
   - Set res.setHeader('X-Request-ID', id)
   - Call next()

3. Update src/middleware/rateLimiter.ts:
   - Replace inline log calls with logRejection() for 429 events
   - Use req.requestId in all log entries

4. Register requestIdMiddleware in src/app.ts before all other middleware.

Constraints:
- Do not add new tests. Make tests/unit/logger.test.ts pass.
- All TypeScript must compile with zero errors.
```

---

### Unit 10 — Abuse Detection: Spike Detector

---

#### Unit 10A — Spike Detector Tests

**Goal:** Write all tests for the `SpikeDetector` before implementation.

**Scope:**
- `src/abuse/spikeDetector.ts` — stub
- `tests/unit/spikeDetector.test.ts` — full Jest suite
- `tests/e2e/spikeDetector.e2e.ts` — Playwright test verifying spike events are emitted under load

---

**Prompt 10A**

```
You are writing tests FIRST for the spike detection module of a platform-level rate limiter.
No implementation exists yet. Tests are expected to FAIL.

Context: A SpikeDetector class will maintain a per-tenant 1-minute sliding window of request
outcomes. When rejection_rate > 50% AND total > 2x baseline, it emits a SPIKE_DETECTED event
via an onSpike callback. It does NOT block requests.

Task: Write tests and stubs only.

Requirements:
1. Update src/config/types.ts:
   - Add optional baselineRps?: number to TenantConfig

2. Create src/abuse/spikeDetector.ts (STUB):
   - SpikeEvent type: { tenantId: string; rejectionRate: number; baseline: number; timestamp: string }
   - Export SpikeDetector class with constructor:
     (options: { onSpike: (event: SpikeEvent) => void; metrics?: { abuseSpikeTotal: { inc: (labels: object) => void } } })
   - Method stubs: record(tenantId: string, allowed: boolean): void — throws 'not implemented'

3. Write tests/unit/spikeDetector.test.ts (Jest):
   - Use jest.spyOn(Date, 'now') to control time
   - Test: onSpike called when rejection_rate > 0.5 AND total > 2 * baseline
   - Test: onSpike NOT called when rejection_rate > 0.5 but total <= 2 * baseline
   - Test: onSpike NOT called when total > 2 * baseline but rejection_rate <= 0.5
   - Test: events older than 60 seconds are pruned before evaluation
   - Test: abuseSpikeTotal.inc called with { tenant_id: tenantId } when spike fires
   - Test: onSpike called multiple times for repeated spikes (not deduplicated)
   - Test: record() for different tenants does not cross-contaminate windows

4. Write tests/e2e/spikeDetector.e2e.ts (Playwright):
   - Send 200 rapid requests all of which get 429 (configure a very low burst limit for test tenant)
   - Poll GET /metrics and assert abuse_spike_total{tenant_id="..."} > 0
   (Will pass after full stack wiring in Unit 13.)

Constraints:
- Do NOT write implementation logic.
- Tests must compile. Tests are expected to fail at runtime.
```

---

#### Unit 10B — Spike Detector Implementation

**Goal:** Implement `SpikeDetector` to make all Unit 10A tests pass.

---

**Prompt 10B**

```
You are implementing the spike detection module for a platform-level rate limiter.
Tests are already written in tests/unit/spikeDetector.test.ts. Make every test pass.

Context: src/abuse/spikeDetector.ts has a stub.

Task: Replace the stub with a full implementation.

Requirements:
- Internal Map<tenantId, Array<{ timestamp: number; allowed: boolean }>>
- record(tenantId, allowed):
  1. Append { timestamp: Date.now(), allowed } to tenant's array
  2. Prune entries where Date.now() - timestamp > 60000
  3. Evaluate: rejections = entries.filter(e => !e.allowed).length
               total = entries.length
               rejection_rate = rejections / total
  4. If rejection_rate > 0.5 AND total > 2 * baseline: call onSpike, increment metric

- Update src/middleware/rateLimiter.ts:
  * Accept optional spikeDetector in deps
  * After each rate limit decision: spikeDetector?.record(tenantId, result.allowed)

Constraints:
- SpikeDetector must be synchronous — no async operations.
- Do not add new tests. Make tests/unit/spikeDetector.test.ts pass.
- All TypeScript must compile with zero errors.
```

---

### Unit 11 — Abuse Detection: Credential Stuffing Signal

---

#### Unit 11A — Credential Stuffing Tests

**Goal:** Write all tests for the `CredentialStuffingDetector` before implementation.

**Scope:**
- `src/abuse/credentialStuffingDetector.ts` — stub
- `src/abuse/index.ts` — stub
- `tests/unit/credentialStuffingDetector.test.ts` — full Jest suite
- `tests/e2e/credentialStuffing.e2e.ts` — Playwright test

---

**Prompt 11A**

```
You are writing tests FIRST for the credential stuffing detection module of a platform-level
rate limiter. No implementation exists yet. Tests are expected to FAIL.

Context: A CredentialStuffingDetector class will maintain a per-tenant 5-minute sliding window
of response status codes. When error_rate > 20% AND authErrors > 50, it emits a
CREDENTIAL_STUFFING_SUSPECTED event via an onSuspected callback. It is called from the auth
middleware layer, NOT the rate limiter.

Task: Write tests and stubs only.

Requirements:
1. Create src/abuse/credentialStuffingDetector.ts (STUB):
   - CredentialStuffingEvent type: { tenantId: string; errorRate: number; errorCount: number; timestamp: string }
   - Export CredentialStuffingDetector class with constructor:
     (options: { onSuspected: (event: CredentialStuffingEvent) => void })
   - Method stubs: record(tenantId: string, statusCode: number): void — throws 'not implemented'

2. Create src/abuse/index.ts (STUB):
   - Re-export SpikeDetector and CredentialStuffingDetector
   - Export createAbuseDetectors(): { spikeDetector: SpikeDetector; credentialStuffingDetector: CredentialStuffingDetector }
   - Body: throw new Error('not implemented')

3. Write tests/unit/credentialStuffingDetector.test.ts (Jest):
   - Use jest.spyOn(Date, 'now') to control time
   - Test: onSuspected called when error_rate > 0.20 AND authErrors > 50
   - Test: onSuspected NOT called when error_rate > 0.20 but authErrors <= 50
   - Test: onSuspected NOT called when authErrors > 50 but error_rate <= 0.20
   - Test: events older than 300 seconds are pruned before evaluation
   - Test: only status codes 401 and 403 count as auth errors (not 400, 404, 500)
   - Test: multiple triggers each independently call onSuspected
   - Test: different tenants have isolated windows

4. Write tests/e2e/credentialStuffing.e2e.ts (Playwright):
   - Note: this detector is wired to auth middleware, not the rate limiter.
     Write a test that calls a hypothetical POST /auth/verify endpoint 60 times with bad credentials.
     Assert the onSuspected callback fires (observable via a test-only event log endpoint).
   (This test is aspirational — mark it as test.skip until the auth middleware integration exists.)

Constraints:
- Do NOT write implementation logic.
- Tests must compile. Tests are expected to fail at runtime.
```

---

#### Unit 11B — Credential Stuffing Implementation

**Goal:** Implement `CredentialStuffingDetector` and `createAbuseDetectors` to make all Unit 11A tests pass.

---

**Prompt 11B**

```
You are implementing the credential stuffing detection module for a platform-level rate limiter.
Tests are already written in tests/unit/credentialStuffingDetector.test.ts. Make every test pass.

Context: src/abuse/credentialStuffingDetector.ts and src/abuse/index.ts have stubs.

Task: Replace stubs with full implementations.

Requirements:
1. CredentialStuffingDetector:
   - Internal Map<tenantId, Array<{ timestamp: number; statusCode: number }>>
   - record(tenantId, statusCode):
     1. Append { timestamp: Date.now(), statusCode }
     2. Prune entries where Date.now() - timestamp > 300000 (5 minutes)
     3. authErrors = entries.filter(e => e.statusCode === 401 || e.statusCode === 403).length
        total = entries.length
        error_rate = authErrors / total
     4. If error_rate > 0.20 AND authErrors > 50: call onSuspected

2. src/abuse/index.ts:
   - createAbuseDetectors(): creates both detectors with EventEmitter-based callbacks
   - Add a comment at the top explaining how auth middleware should wire the credentialStuffingDetector:
     "Call credentialStuffingDetector.record(tenantId, res.statusCode) in auth middleware
      after the response status is determined."

Constraints:
- Do not add new tests. Make tests/unit/credentialStuffingDetector.test.ts pass.
- All TypeScript must compile with zero errors.
```

---

### Unit 12 — Health Check & Readiness Endpoints

---

#### Unit 12A — Health Endpoint Tests

**Goal:** Write all tests for the health and readiness endpoints before implementation.

**Scope:**
- `src/routes/health.ts` — stub
- `tests/integration/health.test.ts` — full Jest integration suite
- `tests/e2e/health.e2e.ts` — Playwright test

---

**Prompt 12A**

```
You are writing tests FIRST for the health and readiness endpoints of a platform-level
rate limiter. No implementation exists yet. Tests are expected to FAIL.

Context: GET /health is a liveness probe (always 200). GET /ready is a readiness probe that
checks Redis via PING — returns 200 when Redis is up, 503 when Redis is down.

Task: Write tests and stubs only.

Requirements:
1. Create src/routes/health.ts (STUB):
   - Export createHealthRouter(redisClient: Redis): Router — stub, returns empty Router

2. Write tests/integration/health.test.ts (Jest + supertest):
   - Mount createHealthRouter on a test Express app
   - Mock checkRedisHealth as jest.fn()
   - Test: GET /health returns 200 with body containing { status: 'ok' }
   - Test: GET /health returns a timestamp field (ISO string)
   - Test: GET /ready returns 200 with { status: 'ready', redis: 'ok' } when checkRedisHealth resolves 'ok'
   - Test: GET /ready returns 503 with { status: 'not_ready', redis: 'unavailable' } when checkRedisHealth resolves 'unavailable'
   - Test: GET /health is not affected by rate limiter middleware (no X-RateLimit-* headers)

3. Write tests/e2e/health.e2e.ts (Playwright):
   - Test: GET /health returns 200
   - Test: GET /ready returns 200 when server is running normally
   - Test: response body of /health contains { status: 'ok' }
   - Test: response body of /ready contains { status: 'ready' }

Constraints:
- Do NOT write implementation logic.
- Tests must compile. Tests are expected to fail at runtime.
```

---

#### Unit 12B — Health Endpoint Implementation

**Goal:** Implement the health router to make all Unit 12A tests pass.

---

**Prompt 12B**

```
You are implementing the health and readiness endpoints for a platform-level rate limiter.
Tests are already written in tests/integration/health.test.ts. Make every test pass.

Context: src/routes/health.ts has a stub. checkRedisHealth is in src/redis/redisHealth.ts.

Task: Replace the stub with a full implementation.

Requirements:
1. createHealthRouter(redisClient):
   - GET /health: res.json({ status: 'ok', timestamp: new Date().toISOString() })
   - GET /ready: call checkRedisHealth(redisClient)
     * 'ok': res.status(200).json({ status: 'ready', redis: 'ok' })
     * 'unavailable': res.status(503).json({ status: 'not_ready', redis: 'unavailable' })

2. Update src/app.ts:
   - Mount the health router BEFORE the rate limiter middleware

Constraints:
- Health endpoints must never be rate-limited.
- Do not add new tests. Make tests/integration/health.test.ts pass.
- All TypeScript must compile with zero errors.
```

---

### Unit 13 — Final Wiring, E2E Suite & Load Test

---

#### Unit 13A — E2E & Load Test Scaffolding

**Goal:** Write the full end-to-end Playwright test suite and load test script before final wiring. These tests describe the fully assembled system behaviour.

**Scope:**
- `tests/e2e/fullStack.e2e.ts` — comprehensive Playwright suite covering the complete request lifecycle
- `scripts/loadtest.ts` — autocannon load test script (not part of `npm test`)
- `README.md` — complete project documentation

---

**Prompt 13A**

```
You are writing the end-to-end test suite and load test script for a platform-level rate limiter.
The full server implementation is not yet complete. Tests are expected to FAIL until Unit 13B.

Context: All individual modules are implemented. This unit tests the fully assembled system:
middleware order, token bucket behaviour over time, fail-closed semantics, metrics accuracy.

Task: Write e2e tests, load test script, and README only.

Requirements:
1. Write tests/e2e/fullStack.e2e.ts (Playwright):
   - Test: first burstSize requests to GET /api/test all return 200
   - Test: request burstSize+1 returns 429 with body { error: 'rate_limit_exceeded' }
   - Test: X-RateLimit-Remaining decreases from burstSize-1 to 0 across the burst
   - Test: after 1 second, at least 1 new request is allowed (token refill at requestsPerSecond rate)
   - Test: GET /health returns 200 even when rate limit is exhausted
   - Test: GET /ready returns 200 even when rate limit is exhausted
   - Test: GET /metrics returns 200 and contains ratelimit_requests_total
   - Test: X-Request-ID is present on every response
   - Test: 429 response includes Retry-After header
   - Test: 200 response does NOT include Retry-After header

2. Create scripts/loadtest.ts:
   - Uses autocannon
   - Target: http://localhost:3000/api/test
   - Headers: { 'X-Tenant-ID': 'tenant_load_test' }
   - Duration: 30 seconds, connections: 50
   - On completion: print p50 latency, p99 latency, total requests, total 429 responses
   - Add npm script: "loadtest": "ts-node scripts/loadtest.ts"

3. Write README.md:
   - Project overview (3 sentences max)
   - Prerequisites: Node.js 20+, Redis 7+, PostgreSQL 15+
   - Environment variables table (all variables from .env.example with descriptions)
   - npm scripts reference table
   - Section: Running tests (unit, integration, e2e, load test)
   - Section: TDD approach — explain Phase A / Phase B structure

Constraints:
- E2E tests must be runnable (they will fail until 13B completes the wiring).
- Load test is manual only — not included in npm test.
```

---

#### Unit 13B — Final Application Wiring

**Goal:** Wire all components together in `src/app.ts` and `src/server.ts` so that all Phase A tests across every unit now pass, including the full-stack Playwright suite.

---

**Prompt 13B**

```
You are completing the final wiring of a platform-level rate limiter.
All tests are already written. Your job is to wire all components so every test passes.

Context: All modules are implemented:
- src/middleware/rateLimiter.ts, requestId.ts, headers.ts
- src/config/configCache.ts, configStore.ts, types.ts
- src/redis/redisClient.ts, tokenBucket.ts, redisHealth.ts
- src/metrics/metrics.ts
- src/abuse/spikeDetector.ts, credentialStuffingDetector.ts, index.ts
- src/routes/health.ts
- src/logger.ts

Task: Wire everything together in src/app.ts and src/server.ts.

Requirements:
1. Update src/app.ts to accept all dependencies as parameters (for testability):
   createApp(deps: { redisClient: Redis; configCache: ConfigCache; spikeDetector?: SpikeDetector }): Express
   Middleware registration order:
   a. requestIdMiddleware
   b. createHealthRouter(deps.redisClient)  ← before rate limiter
   c. createRateLimiterMiddleware({ cache, redisClient, spikeDetector })
   d. GET /api/test → 200 { message: 'ok' }
   e. GET /metrics → collectMetrics()

2. Update src/server.ts:
   - createClientFromEnv() → redisClient
   - new ConfigCache({ getConfig: getConfigFromDB, onCacheMiss: rateLimitConfigCacheMissTotal.inc })
   - createAbuseDetectors() → { spikeDetector }
   - createApp({ redisClient, configCache, spikeDetector })
   - app.listen(process.env.PORT || 3000)
   - Log: { event: 'server_started', port, redisMode, timestamp }

3. Verify all test suites pass:
   - npm run test:unit
   - npm run test:integration
   - npm run test:e2e (requires server running: npm start)

Constraints:
- Do not add new tests.
- Do not modify any existing test files.
- All TypeScript must compile with zero errors.
- npm test must be fully green.
```

---

## Dependency Graph

```
Unit 1 (Scaffold)
  ├── Unit 2A/2B (Config Store)
  │     └── Unit 3A/3B (Config Cache)
  │           └── Unit 7A/7B (Middleware) ◄─── Unit 5A/5B (Token Bucket)
  │                 │                                └── Unit 4A/4B (Redis Client)
  │                 │                           Unit 6A/6B (Headers)
  │                 ├── Unit 8A/8B (Metrics)
  │                 ├── Unit 9A/9B (Logging)
  │                 ├── Unit 10A/10B (Spike Detector)
  │                 └── Unit 11A/11B (Credential Stuffing)
  ├── Unit 12A/12B (Health Endpoints) ◄── Unit 4A/4B (Redis Client)
  └── Unit 13A/13B (E2E + Load Test) ◄── all units
```

---

## Summary Table

| Unit | Phase | Module | Key Output | Depends On |
|------|-------|--------|-----------|------------|
| 1 | — | Scaffold | Project structure, Jest + Playwright config | — |
| 2A | Tests | Config Store | Type stubs, unit tests, e2e tests | 1 |
| 2B | Impl | Config Store | DB schema, `getConfigFromDB` | 2A |
| 3A | Tests | Config Cache | Stub, unit tests, e2e tests | 2A |
| 3B | Impl | Config Cache | `ConfigCache` class, TTL, fallback | 3A |
| 4A | Tests | Redis Client | Stubs, unit tests, e2e tests | 1 |
| 4B | Impl | Redis Client | `createRedisClient`, `checkRedisHealth` | 4A |
| 5A | Tests | Token Bucket | Stubs, unit tests, e2e tests | 4A |
| 5B | Impl | Token Bucket | Lua script, `checkAndConsume` | 5A |
| 6A | Tests | Headers | Stub, unit tests, e2e tests | 5A |
| 6B | Impl | Headers | `setRateLimitHeaders` | 6A |
| 7A | Tests | Middleware | Stub, integration tests, e2e tests | 3A, 5A, 6A |
| 7B | Impl | Middleware | `createRateLimiterMiddleware` | 7A |
| 8A | Tests | Metrics | Stubs, unit tests, e2e tests | 7A |
| 8B | Impl | Metrics | Prometheus counters/histograms, `/metrics` | 8A |
| 9A | Tests | Logging | Stubs, unit tests, e2e tests | 7A |
| 9B | Impl | Logging | Winston logger, `logRejection`, requestId | 9A |
| 10A | Tests | Spike Detector | Stub, unit tests, e2e tests | 7A |
| 10B | Impl | Spike Detector | `SpikeDetector`, spike events | 10A |
| 11A | Tests | Credential Stuffing | Stubs, unit tests, e2e tests | 1 |
| 11B | Impl | Credential Stuffing | `CredentialStuffingDetector` | 11A |
| 12A | Tests | Health Endpoints | Stub, integration tests, e2e tests | 4A |
| 12B | Impl | Health Endpoints | `/health`, `/ready` | 12A |
| 13A | Tests | E2E + Load Test | Full Playwright suite, load test script, README | all A phases |
| 13B | Impl | Final Wiring | Complete `src/app.ts`, `src/server.ts` | 13A |

# High-Level Rate Limiter

A platform-level, per-tenant HTTP rate limiter built with Express, Redis (token-bucket via Lua), and PostgreSQL for tenant configuration. It enforces configurable burst and sustained request limits, exposes Prometheus metrics, and is designed for fail-closed operation when dependencies are unavailable.

## Prerequisites

| Dependency | Minimum version |
|---|---|
| Node.js | 20+ |
| Redis | 7+ |
| PostgreSQL | 15+ |

## Environment Variables

Copy `.env.example` to `.env` and fill in the values before starting the server.

| Variable | Description |
|---|---|
| `PORT` | TCP port the HTTP server listens on (default: `3000`) |
| `REDIS_URL` | Redis connection URL used by the token-bucket client (e.g. `redis://localhost:6379`) |
| `REDIS_SENTINELS` | Comma-separated `host:port` list for Redis Sentinel mode; leave blank for standalone |
| `REDIS_MASTER_NAME` | Sentinel master name; required when `REDIS_SENTINELS` is set |
| `DB_CONNECTION_STRING` | PostgreSQL connection string for tenant config lookups (e.g. `postgresql://localhost:5432/ratelimiter`) |
| `LOG_LEVEL` | Winston log level — `error`, `warn`, `info`, `debug` (default: `info`) |

## npm Scripts

| Script | Command | Description |
|---|---|---|
| `build` | `tsc` | Compile TypeScript to `dist/` |
| `start` | `node dist/server.js` | Start the compiled server |
| `test` | `jest` | Run all unit and integration tests |
| `test:unit` | `jest --selectProjects unit` | Run unit tests only |
| `test:integration` | `jest --selectProjects integration` | Run integration tests only |
| `test:e2e` | `playwright test` | Run all Playwright E2E tests (requires live server) |
| `lint` | `eslint src/` | Lint the source directory |
| `loadtest` | `ts-node scripts/loadtest.ts` | Run the 30-second autocannon load test (manual only) |

## Running Tests

### Unit tests

No external services required — all dependencies are mocked.

```bash
npm run test:unit
```

### Integration tests

No external services required — Redis and the database are mocked via Jest.

```bash
npm run test:integration
```

### E2E tests

Requires a running server, Redis, and a PostgreSQL database seeded with tenant configs. Start the server first, then run Playwright:

```bash
# Terminal 1 — start the server
npm run build && npm start

# Terminal 2 — run E2E tests
npm run test:e2e
```

The Playwright base URL defaults to `http://localhost:3000` (see `playwright.config.ts`). Each E2E test file documents which tenant ID and `burstSize` must be seeded in the database.

### Load test

The load test is **manual only** and is not included in `npm test`. It targets `http://localhost:3000/api/test` with 50 concurrent connections for 30 seconds and prints p50/p99 latency, total requests, and total 429 responses on completion.

```bash
npm run loadtest
```

## TDD Approach — Phase A / Phase B

The project follows a two-phase TDD structure.

**Phase A — unit and integration tests (red → green per module)**

Each module (`configCache`, `tokenBucket`, `rateLimiter` middleware, `headers`, `metrics`, etc.) is developed in isolation. Unit tests mock all I/O; integration tests use supertest against an in-process Express app with mocked Redis and database clients. Tests in `tests/unit/` and `tests/integration/` are expected to pass before any E2E work begins.

**Phase B — full-stack E2E tests (red until final wiring)**

Playwright tests in `tests/e2e/` exercise the fully assembled system against a live server. They are written up front and remain failing (red) until the final wiring unit (13B) mounts all middleware in the correct order, connects real Redis and PostgreSQL, and seeds the tenant database. This gives a clear, executable definition of "done" for the complete system — no test is modified to make it pass; the implementation is completed until all tests go green.

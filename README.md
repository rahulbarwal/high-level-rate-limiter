# High-Level Rate Limiter

A platform-level, per-tenant HTTP rate limiter built with Express, Redis (token-bucket via Lua), and PostgreSQL for tenant configuration. It enforces configurable burst and sustained request limits, a global 50k RPS cap with priority-based load shedding, exposes Prometheus metrics, and is designed for fail-closed operation when dependencies are unavailable.

### Global Load Shedding

When aggregate traffic across all tenants exceeds 50,000 requests per second, the system sheds traffic in priority order — lowest-priority tiers are rejected first:

| Tier | Label | Behaviour when global limit is hit |
|---|---|---|
| 1 | Enterprise | Never shed — bypasses global check entirely |
| 2 | Paying | Shed last |
| 3 | Free | Shed second |
| 4 | Internal / Testing | Shed first |

Shed requests receive `HTTP 429` with body `{ "error": "load_shed" }`. The global bucket is stored in Redis under key `rl:__global__`, making the limit effective across all horizontally-scaled service instances.

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose

---

## Quick Start

```bash
npm run docker:up
```

This builds and starts the app, Redis, and PostgreSQL in containers. The app runs migrations on startup. Verify it is healthy:

```bash
curl http://localhost:3000/health
# {"status":"ok","timestamp":"..."}
```

Test the rate limiter:

```bash
curl -H "X-Tenant-ID: tenant_free_example" http://localhost:3000/api/test
```

To stop and remove containers:

```bash
npm run docker:down
```

---

## Docker Compose

### Services

| Service | Description | Port |
|---|---|---|
| app | Rate limiter API | 3000 |
| redis | Redis 7 (token bucket state) | — |
| postgres | PostgreSQL 15 (tenant config) | — |
| loadtest | Load test runner (profile: loadtest) | — |
| test | Unit/integration tests (profile: test) | — |

### Network and volumes

| Resource | Name | Purpose |
|---|---|---|
| Network | `ratelimiter-network` | Isolated bridge network for app ↔ Redis ↔ PostgreSQL |
| Volume | `ratelimiter-redis-data` | Redis persistence (`/data`) |
| Volume | `ratelimiter-postgres-data` | PostgreSQL persistence (`/var/lib/postgresql/data`) |

### Commands

| Command | Description |
|---|---|
| `npm run docker:up` | Build and start app, Redis, and PostgreSQL |
| `npm run docker:up:build` | Rebuild images and start |
| `npm run docker:down` | Stop and remove containers |
| `npm run docker:down:volumes` | Stop, remove containers, and delete volumes |
| `npm run docker:logs` | Stream app container logs |
| `npm run docker:loadtest` | Run all load test scenarios (starts app if needed) |
| `npm run docker:loadtest:baseline` | Run baseline scenario only |
| `npm run docker:loadtest:global` | Run global limit scenario only |
| `npm run docker:loadtest:allow-reject` | Run allow-reject scenario only |
| `npm run docker:test` | Run unit and integration tests in container |

### Environment

The app container receives:

- `REDIS_URL=redis://redis:6379`
- `DB_CONNECTION_STRING=postgresql://postgres:postgres@postgres:5432/ratelimiter`
- `PORT=3000` (mapped to host via `${PORT:-3000}:3000`)

Override `LOG_LEVEL` by setting it in your shell or a `.env` file before `docker compose up`.

---

## Load Test

The load test runs inside a Docker container and targets the app on the same network. Ensure the app is running first (`npm run docker:up`), then:

```bash
# Run all scenarios (baseline, global, allow-reject)
npm run docker:loadtest

# Run specific scenario
npm run docker:loadtest:allow-reject
```

### Scenarios

- **Baseline** — four sequential runs per tier, unlimited RPS → 100% 429
- **Global limit** — all tiers fire concurrently above 50k RPS → validates load shedding
- **Allow-reject** — controlled rates: Phase A under limit (mostly 2xx), Phase B over limit (mix of 2xx + 429)

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| All responses are `429` | Baseline/global exceed limits | Use `docker:loadtest:allow-reject` |
| All responses are `503` | Redis or PostgreSQL down | Ensure `npm run docker:up` succeeded; check `docker compose logs app` |
| `{"error":"load_shed"}` | Global bucket exhausted | Wait a few seconds for refill, or run `docker compose restart app` |

---

## Running Tests

```bash
npm run docker:test
```

Runs Jest unit and integration tests in a container. All I/O is mocked; no external services required.

---

## TDD Approach — Phase A / Phase B

**Phase A** — unit and integration tests (red → green per module). Each module is developed in isolation with mocked I/O.

**Phase B** — full-stack E2E tests. Playwright tests exercise the assembled system against a live server (requires additional setup if running E2E in Docker).

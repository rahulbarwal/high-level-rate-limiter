/**
 * Load test script — three scenarios:
 *
 * 1. BASELINE   — one autocannon run per tier tenant in sequence (unlimited RPS).
 *                 All requests exceed limit → 100% 429.
 *
 * 2. GLOBAL     — all four tier tenants fire concurrently, targeting aggregate
 *                 traffic well above 50k RPS. Validates priority-based load
 *                 shedding.
 *
 * 3. ALLOW-REJECT — sends traffic at controlled rates. Phase A: under limit
 *                   (expect mostly 2xx). Phase B: over limit (expect mix of
 *                   2xx + 429). Validates that the rate limiter allows up to
 *                   the limit, then rejects excess.
 *
 * Usage:
 *   npx ts-node scripts/loadtest.ts              # runs all scenarios
 *   npx ts-node scripts/loadtest.ts baseline     # baseline only
 *   npx ts-node scripts/loadtest.ts global       # global limit only
 *   npx ts-node scripts/loadtest.ts allow-reject # allow-reject only (recommended)
 */

import autocannon, { type Result } from 'autocannon';

const TARGET_URL = process.env.TARGET_URL ?? 'http://localhost:3000/api/test';

// ---------------------------------------------------------------------------
// Tenant definitions (must be seeded in the DB before running)
// ---------------------------------------------------------------------------

interface TenantDef {
  label: string;
  tenantId: string;
  tier: number;
  connections: number;
  durationSeconds: number;
  /** Per-tenant RPS limit from DB (used by allow-reject scenario) */
  requestsPerSecond?: number;
}

const BASELINE_TENANTS: TenantDef[] = [
  { label: 'Enterprise (Tier 1)', tenantId: 'tenant_load_test_enterprise', tier: 1, connections: 10, durationSeconds: 20 },
  { label: 'Paying    (Tier 2)', tenantId: 'tenant_load_test_paying',     tier: 2, connections: 10, durationSeconds: 20 },
  { label: 'Free      (Tier 3)', tenantId: 'tenant_load_test_free',       tier: 3, connections: 10, durationSeconds: 20 },
  { label: 'Internal  (Tier 4)', tenantId: 'tenant_load_test_internal',   tier: 4, connections: 10, durationSeconds: 20 },
];

// For the global test each tenant fires with enough connections to collectively
// push aggregate RPS well past the 50k global limit.
const GLOBAL_TENANTS: TenantDef[] = [
  { label: 'Enterprise (Tier 1)', tenantId: 'tenant_load_test_enterprise', tier: 1, connections: 100, durationSeconds: 30 },
  { label: 'Paying    (Tier 2)', tenantId: 'tenant_load_test_paying',     tier: 2, connections: 100, durationSeconds: 30 },
  { label: 'Free      (Tier 3)', tenantId: 'tenant_load_test_free',       tier: 3, connections: 100, durationSeconds: 30 },
  { label: 'Internal  (Tier 4)', tenantId: 'tenant_load_test_internal',   tier: 4, connections: 100, durationSeconds: 30 },
];

// RPS limits must match db/migrations/001_create_tenant_rate_limit_configs.sql
const ALLOW_REJECT_TENANTS: TenantDef[] = [
  { label: 'Enterprise (Tier 1)', tenantId: 'tenant_load_test_enterprise', tier: 1, connections: 10, durationSeconds: 15, requestsPerSecond: 5000 },
  { label: 'Paying    (Tier 2)', tenantId: 'tenant_load_test_paying',     tier: 2, connections: 10, durationSeconds: 15, requestsPerSecond: 500 },
  { label: 'Free      (Tier 3)', tenantId: 'tenant_load_test_free',       tier: 3, connections: 10, durationSeconds: 15, requestsPerSecond: 50 },
  { label: 'Internal  (Tier 4)', tenantId: 'tenant_load_test_internal',   tier: 4, connections: 10, durationSeconds: 15, requestsPerSecond: 100 },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runAutocannon(tenant: TenantDef, overallRate?: number): Promise<Result> {
  return new Promise((resolve, reject) => {
    const opts: autocannon.Options = {
      url: TARGET_URL,
      duration: tenant.durationSeconds,
      connections: tenant.connections,
      headers: { 'X-Tenant-ID': tenant.tenantId },
    };
    if (overallRate != null && overallRate >= 1) {
      opts.overallRate = overallRate;
    }
    const instance = autocannon(opts, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
    autocannon.track(instance, { renderProgressBar: true });
  });
}

function printResult(tenant: TenantDef, result: Result): void {
  const total2xx = result['2xx'] ?? 0;
  const total4xx = result['4xx'] ?? 0;
  const total5xx = result['5xx'] ?? 0;
  const totalReqs = result.requests.total;

  // statusCodeStats gives the exact breakdown (e.g. 429 vs 400 vs 503)
  const statusStats = (result as unknown as { statusCodeStats?: Record<string, { count: number }> }).statusCodeStats ?? {};
  const count429 = statusStats['429']?.count ?? 0;
  const count503 = statusStats['503']?.count ?? 0;

  const shedPct = totalReqs > 0 ? ((count429 / totalReqs) * 100).toFixed(1) : '0.0';
  const errorPct = totalReqs > 0 ? ((count503 / totalReqs) * 100).toFixed(1) : '0.0';

  console.log(`  Tenant:       ${tenant.label} (${tenant.tenantId})`);
  console.log(`  Connections:  ${tenant.connections}`);
  console.log(`  Duration:     ${tenant.durationSeconds}s`);
  console.log(`  p50 latency:  ${result.latency.p50} ms`);
  console.log(`  p99 latency:  ${result.latency.p99} ms`);
  console.log(`  Total reqs:   ${totalReqs}`);
  console.log(`  2xx (allowed):  ${total2xx}`);
  console.log(`  4xx total:      ${total4xx}`);
  console.log(`  5xx total:      ${total5xx}`);
  console.log(`  429 rate-limited/shed: ${count429}  (${shedPct}%)`);
  if (count503 > 0) {
    console.log(`  503 service errors:    ${count503}  (${errorPct}%) ← config/Redis unavailable`);
  }
  if (Object.keys(statusStats).length > 0) {
    const breakdown = Object.entries(statusStats)
      .map(([code, { count }]) => `${code}:${count}`)
      .join('  ');
    console.log(`  Status breakdown: ${breakdown}`);
  }
}

// ---------------------------------------------------------------------------
// Scenario 1: Baseline — sequential, one tenant at a time
// ---------------------------------------------------------------------------

async function runBaseline(): Promise<void> {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  SCENARIO 1: BASELINE — per-tenant limits in isolation   ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log('Each tenant runs independently. Aggregate traffic is well below');
  console.log('the 50k global RPS limit. 429s here indicate per-tenant limits.\n');

  for (const tenant of BASELINE_TENANTS) {
    console.log(`─── Running: ${tenant.label} ───`);
    const result = await runAutocannon(tenant);
    printResult(tenant, result);
    console.log('');
  }

  console.log('Baseline complete.\n');
}

// ---------------------------------------------------------------------------
// Scenario 2: Global limit — all tiers fire concurrently
// ---------------------------------------------------------------------------

async function runGlobalLimit(): Promise<void> {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  SCENARIO 2: GLOBAL LIMIT — aggregate load shedding      ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log('All four tier tenants fire simultaneously. Aggregate target exceeds');
  console.log('50k global RPS. Expected shedding order: Tier 4 first → Tier 3 →');
  console.log('Tier 2. Tier 1 (enterprise) should have the lowest 429 rate.\n');

  console.log('Starting all tenants concurrently...\n');

  const results = await Promise.all(
    GLOBAL_TENANTS.map((tenant) => runAutocannon(tenant)),
  );

  console.log('\n=== Global Limit Results ===\n');

  const summary: Array<{ label: string; tier: number; shedRate: number; total429: number; totalReqs: number }> = [];

  GLOBAL_TENANTS.forEach((tenant, i) => {
    const result = results[i];
    printResult(tenant, result);
    console.log('');

    const statusStats = (result as unknown as { statusCodeStats?: Record<string, { count: number }> }).statusCodeStats ?? {};
    const count429 = statusStats['429']?.count ?? 0;
    const totalReqs = result.requests.total;
    summary.push({
      label: tenant.label,
      tier: tenant.tier,
      shedRate: totalReqs > 0 ? (count429 / totalReqs) * 100 : 0,
      total429: count429,
      totalReqs,
    });
  });

  // Sort by tier ascending to show expected shedding order
  const sorted = [...summary].sort((a, b) => b.tier - a.tier);

  console.log('=== Shedding Priority Summary (highest shed rate first) ===\n');
  console.log('  Tier | Label                  | Shed Rate | 429s / Total');
  console.log('  -----|------------------------|-----------|-------------');
  sorted.forEach(({ label, tier, shedRate, total429, totalReqs }) => {
    const pct = shedRate.toFixed(1).padStart(6);
    console.log(`     ${tier} | ${label.padEnd(22)} | ${pct}%   | ${total429} / ${totalReqs}`);
  });

  console.log('\nExpected: Tier 4 shed rate > Tier 3 > Tier 2 > Tier 1 (≈0%)');

  const tier1 = summary.find((s) => s.tier === 1);
  const tier4 = summary.find((s) => s.tier === 4);
  if (tier1 && tier4) {
    if (tier4.shedRate > tier1.shedRate) {
      console.log('\n✓ PASS: Tier 4 (internal) shed rate is higher than Tier 1 (enterprise)');
    } else {
      console.log('\n✗ WARN: Tier 4 shed rate is NOT higher than Tier 1 — check global limit config');
    }
  }

  console.log('\nGlobal limit scenario complete.\n');
}

// ---------------------------------------------------------------------------
// Scenario 3: Allow-reject — controlled rate to show allow-then-reject behavior
// ---------------------------------------------------------------------------

async function runAllowReject(): Promise<void> {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  SCENARIO 3: ALLOW-REJECT — rate limiter in action       ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log('Phase A: Send at ~50% of limit  → expect mostly 2xx (allowed)\n');
  console.log('Phase B: Send at ~110% of limit → expect mix of 2xx + 429 (allowed + rejected)\n');
  console.log('Limits must match db/migrations/001_create_tenant_rate_limit_configs.sql.\n');
  console.log('Waiting 3s for token buckets to refill from any prior tests...\n');
  await new Promise((r) => setTimeout(r, 3000));

  for (const tenant of ALLOW_REJECT_TENANTS) {
    const limit = tenant.requestsPerSecond ?? 100;
    const rateUnder = Math.max(1, Math.floor(limit * 0.5));
    const rateOver = Math.max(1, Math.floor(limit * 1.1));

    console.log(`─── ${tenant.label} (limit ${limit} RPS) ───\n`);

    console.log(`  Phase A: ${rateUnder} RPS (under limit) — `);
    const resultA = await runAutocannon(tenant, rateUnder);
    const statusA = (resultA as unknown as { statusCodeStats?: Record<string, { count: number }> }).statusCodeStats ?? {};
    const count2xxA = resultA['2xx'] ?? 0;
    const count429A = statusA['429']?.count ?? 0;
    const totalA = resultA.requests.total;
    const pct2xxA = totalA > 0 ? ((count2xxA / totalA) * 100).toFixed(1) : '0';
    const pct429A = totalA > 0 ? ((count429A / totalA) * 100).toFixed(1) : '0';
    console.log(`${count2xxA} 2xx (${pct2xxA}%), ${count429A} 429 (${pct429A}%)`);
    const okA = count429A === 0 || (count2xxA / totalA) > 0.9;
    console.log(okA ? '  ✓ Mostly allowed as expected\n' : '  (Some 429s — ensure DB is migrated and limits match; try restarting the server to refresh config cache)\n');

    console.log('  Waiting 2s for bucket refill before Phase B...\n');
    await new Promise((r) => setTimeout(r, 2000));

    console.log(`  Phase B: ${rateOver} RPS (over limit) — `);
    const resultB = await runAutocannon(tenant, rateOver);
    const statusB = (resultB as unknown as { statusCodeStats?: Record<string, { count: number }> }).statusCodeStats ?? {};
    const count2xxB = resultB['2xx'] ?? 0;
    const count429B = statusB['429']?.count ?? 0;
    const totalB = resultB.requests.total;
    const pct2xxB = totalB > 0 ? ((count2xxB / totalB) * 100).toFixed(1) : '0';
    const pct429B = totalB > 0 ? ((count429B / totalB) * 100).toFixed(1) : '0';
    console.log(`${count2xxB} 2xx (${pct2xxB}%), ${count429B} 429 (${pct429B}%)`);
    const okB = count2xxB > 0 && count429B > 0;
    console.log(okB ? '  ✓ Both allowed and rejected — rate limiter working\n' : '  (Expected mix of 2xx and 429)\n');

    printResult(tenant, resultB);
    console.log('');
  }

  console.log('Allow-reject scenario complete.\n');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const scenario = process.argv[2]?.toLowerCase();

  if (!scenario || scenario === 'baseline') {
    await runBaseline();
  }

  if (!scenario || scenario === 'global') {
    await runGlobalLimit();
  }

  if (!scenario || scenario === 'allow-reject') {
    await runAllowReject();
  }

  if (scenario && !['baseline', 'global', 'allow-reject'].includes(scenario)) {
    console.error(`Unknown scenario: "${scenario}". Use "baseline", "global", or "allow-reject".`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Load test error:', err);
  process.exit(1);
});

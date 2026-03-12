import { Counter, Histogram, Registry } from 'prom-client';

export const metricsRegistry = new Registry();

export const rateLimitRequestsTotal = new Counter({
  name: 'ratelimit_requests_total',
  help: 'Total number of rate-limit decisions, labelled by tenant and result',
  labelNames: ['tenant', 'result'] as const,
  registers: [metricsRegistry],
});

export const rateLimitRedisLatencyMs = new Histogram({
  name: 'ratelimit_redis_latency_ms',
  help: 'Latency of Redis token-bucket eval calls in milliseconds',
  buckets: [1, 5, 10, 25, 50, 100, 250],
  registers: [metricsRegistry],
});

export const rateLimitRedisUnavailableTotal = new Counter({
  name: 'ratelimit_redis_unavailable_total',
  help: 'Total number of requests that failed due to Redis being unavailable',
  registers: [metricsRegistry],
});

export const rateLimitConfigCacheMissTotal = new Counter({
  name: 'ratelimit_config_cache_miss_total',
  help: 'Total number of config cache misses',
  registers: [metricsRegistry],
});

export const abuseSpikeTotal = new Counter({
  name: 'abuse_spike_total',
  help: 'Total number of detected abuse spikes, labelled by tenant',
  labelNames: ['tenant_id'] as const,
  registers: [metricsRegistry],
});

export const globalLimitShedTotal = new Counter({
  name: 'global_limit_shed_total',
  help: 'Total number of requests shed by the global rate limit, labelled by tier',
  labelNames: ['tier'] as const,
  registers: [metricsRegistry],
});

export function getMetricsContentType(): string {
  return Registry.PROMETHEUS_CONTENT_TYPE;
}

export async function collectMetrics(): Promise<string> {
  return metricsRegistry.metrics();
}

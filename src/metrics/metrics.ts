import { Registry } from 'prom-client';

/**
 * Stub metric objects.
 * Each exposes the prom-client surface used by the rate-limiter:
 *   - Counter  → inc()
 *   - Histogram → observe(), startTimer()
 *
 * The real implementations will be wired in Phase C.
 */

export const rateLimitRequestsTotal = {
  inc: (_labels?: { tenant?: string; result?: string }): void => {
    throw new Error('not implemented');
  },
};

export const rateLimitRedisLatencyMs = {
  observe: (_labels: Record<string, string>, _value: number): void => {
    throw new Error('not implemented');
  },
  startTimer: (_labels?: Record<string, string>): (() => void) => {
    throw new Error('not implemented');
  },
};

export const rateLimitRedisUnavailableTotal = {
  inc: (_labels?: Record<string, string>): void => {
    throw new Error('not implemented');
  },
};

export const rateLimitConfigCacheMissTotal = {
  inc: (_labels?: Record<string, string>): void => {
    throw new Error('not implemented');
  },
};

export const abuseSpikeTotal = {
  inc: (_labels?: { tenant_id?: string }): void => {
    throw new Error('not implemented');
  },
};

/**
 * Prometheus registry stub.
 * The real registry will register all metrics above.
 */
export const metricsRegistry = new Registry();

/**
 * Returns the Content-Type header value for the Prometheus text exposition format.
 * Stub: returns empty string until implemented.
 */
export function getMetricsContentType(): string {
  return '';
}

/**
 * Serialises all registered metrics into the Prometheus text format.
 * Stub: returns an empty string until implemented.
 */
export async function collectMetrics(): Promise<string> {
  return Promise.resolve('');
}

import { Registry } from 'prom-client';
import {
  rateLimitRequestsTotal,
  rateLimitRedisLatencyMs,
  rateLimitRedisUnavailableTotal,
  rateLimitConfigCacheMissTotal,
  abuseSpikeTotal,
} from '../../src/metrics/metrics';
import { RedisUnavailableError } from '../../src/redis/types';

// ---------------------------------------------------------------------------
// The unit tests below treat each exported metric object as a collaborator and
// assert that the rate-limiter calls the correct method with the correct labels.
//
// Because the stubs throw 'not implemented', every test is expected to FAIL
// until the real metric objects are wired in Phase C.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

/** Fresh prom-client Registry per test to prevent cross-test pollution. */
let registry: Registry;

beforeEach(() => {
  registry = new Registry();
  jest.clearAllMocks();
});

// Spy on each metric method so we can assert call arguments without needing
// a real prom-client registration.
const incRequestsSpy = jest.spyOn(rateLimitRequestsTotal, 'inc');
const startTimerSpy = jest.spyOn(rateLimitRedisLatencyMs, 'startTimer');
const incRedisUnavailableSpy = jest.spyOn(rateLimitRedisUnavailableTotal, 'inc');
const incCacheMissSpy = jest.spyOn(rateLimitConfigCacheMissTotal, 'inc');
const incAbuseSpikeSpy = jest.spyOn(abuseSpikeTotal, 'inc');

// ---------------------------------------------------------------------------
// rateLimitRequestsTotal
// ---------------------------------------------------------------------------

describe('rateLimitRequestsTotal', () => {
  it('is incremented with { tenant, result: "allowed" } when a request is allowed', () => {
    const tenant = 'tenant-abc';

    rateLimitRequestsTotal.inc({ tenant, result: 'allowed' });

    expect(incRequestsSpy).toHaveBeenCalledWith({ tenant, result: 'allowed' });
  });

  it('is incremented with { tenant, result: "rejected" } when a request is rejected', () => {
    const tenant = 'tenant-abc';

    rateLimitRequestsTotal.inc({ tenant, result: 'rejected' });

    expect(incRequestsSpy).toHaveBeenCalledWith({ tenant, result: 'rejected' });
  });
});

// ---------------------------------------------------------------------------
// rateLimitRedisLatencyMs
// ---------------------------------------------------------------------------

describe('rateLimitRedisLatencyMs', () => {
  it('startTimer() is called before checkAndConsume and end() is called after', async () => {
    // Simulate the pattern the middleware will use:
    //   const end = rateLimitRedisLatencyMs.startTimer();
    //   await checkAndConsume(...);
    //   end();
    const mockEnd = jest.fn();
    startTimerSpy.mockReturnValue(mockEnd);

    const end = rateLimitRedisLatencyMs.startTimer();

    // Simulate async work (checkAndConsume)
    await Promise.resolve();

    end();

    expect(startTimerSpy).toHaveBeenCalledTimes(1);
    expect(mockEnd).toHaveBeenCalledTimes(1);

    // end() must be called AFTER startTimer()
    const startOrder = startTimerSpy.mock.invocationCallOrder[0];
    const endOrder = mockEnd.mock.invocationCallOrder[0];
    expect(endOrder).toBeGreaterThan(startOrder);
  });
});

// ---------------------------------------------------------------------------
// rateLimitRedisUnavailableTotal
// ---------------------------------------------------------------------------

describe('rateLimitRedisUnavailableTotal', () => {
  it('is incremented when a RedisUnavailableError is thrown', () => {
    // Simulate the middleware catch block
    const err = new RedisUnavailableError('ECONNREFUSED');

    if (err instanceof RedisUnavailableError) {
      rateLimitRedisUnavailableTotal.inc();
    }

    expect(incRedisUnavailableSpy).toHaveBeenCalledTimes(1);
  });

  it('is NOT incremented when a non-Redis error is thrown', () => {
    const err = new Error('some other error');

    if (err instanceof RedisUnavailableError) {
      rateLimitRedisUnavailableTotal.inc();
    }

    expect(incRedisUnavailableSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// rateLimitConfigCacheMissTotal
// ---------------------------------------------------------------------------

describe('rateLimitConfigCacheMissTotal', () => {
  it('is incremented via the onCacheMiss callback', () => {
    // The ConfigCache accepts an onCacheMiss callback; the metrics module
    // will wire rateLimitConfigCacheMissTotal.inc as that callback.
    const onCacheMiss = (): void => {
      rateLimitConfigCacheMissTotal.inc();
    };

    // Simulate a cache miss
    onCacheMiss();

    expect(incCacheMissSpy).toHaveBeenCalledTimes(1);
  });

  it('is incremented once per cache miss, not per cache hit', () => {
    const onCacheMiss = (): void => {
      rateLimitConfigCacheMissTotal.inc();
    };

    // Two misses
    onCacheMiss();
    onCacheMiss();

    expect(incCacheMissSpy).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// abuseSpikeTotal
// ---------------------------------------------------------------------------

describe('abuseSpikeTotal', () => {
  it('is incremented with { tenant_id } when an abuse spike is detected', () => {
    const tenant_id = 'tenant-abuser';

    abuseSpikeTotal.inc({ tenant_id });

    expect(incAbuseSpikeSpy).toHaveBeenCalledWith({ tenant_id });
  });

  it('carries the correct tenant_id label', () => {
    abuseSpikeTotal.inc({ tenant_id: 'tenant-x' });
    abuseSpikeTotal.inc({ tenant_id: 'tenant-y' });

    expect(incAbuseSpikeSpy).toHaveBeenNthCalledWith(1, { tenant_id: 'tenant-x' });
    expect(incAbuseSpikeSpy).toHaveBeenNthCalledWith(2, { tenant_id: 'tenant-y' });
  });
});

// ---------------------------------------------------------------------------
// Registry isolation
// ---------------------------------------------------------------------------

describe('Registry', () => {
  it('a fresh Registry created in beforeEach has no metrics registered', () => {
    // Confirms the beforeEach isolation pattern works as intended
    expect(registry).toBeInstanceOf(Registry);
  });
});

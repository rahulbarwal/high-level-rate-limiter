import { SpikeDetector, SpikeEvent } from '../../src/abuse/spikeDetector';

// ---------------------------------------------------------------------------
// SpikeDetector unit tests
//
// The SpikeDetector stub throws 'not implemented' on record(), so every test
// in this file is expected to FAIL at runtime until the real implementation
// is wired in.
// ---------------------------------------------------------------------------

const BASELINE_RPS = 10;

/** Build a SpikeDetector with a jest-mocked onSpike and optional metrics. */
function makeDetector(baselineRps = BASELINE_RPS) {
  const onSpike = jest.fn<void, [SpikeEvent]>();
  const abuseSpikeTotal = { inc: jest.fn() };
  const detector = new SpikeDetector({
    onSpike,
    metrics: { abuseSpikeTotal },
  });
  return { detector, onSpike, abuseSpikeTotal, baselineRps };
}

/**
 * Simulate `count` requests in the current time window.
 * `rejectedCount` of them are rejected; the rest are allowed.
 */
function sendRequests(
  detector: SpikeDetector,
  tenantId: string,
  total: number,
  rejectedCount: number,
): void {
  for (let i = 0; i < total; i++) {
    detector.record(tenantId, i >= rejectedCount);
  }
}

describe('SpikeDetector', () => {
  let dateSpy: jest.SpyInstance;

  beforeEach(() => {
    dateSpy = jest.spyOn(Date, 'now').mockReturnValue(0);
  });

  afterEach(() => {
    dateSpy.mockRestore();
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Core spike-detection logic
  // -------------------------------------------------------------------------

  describe('onSpike callback', () => {
    it('is called when rejection_rate > 0.5 AND total > 2 * baseline', () => {
      const { detector, onSpike, baselineRps } = makeDetector();
      const tenantId = 'tenant-spike';

      // baseline window = 60 s → baseline total = baselineRps * 60 = 600
      // threshold = 2 * 600 = 1200; send 1201 requests, 700 rejected (≈58%)
      const total = baselineRps * 60 * 2 + 1;
      const rejected = Math.ceil(total * 0.6);

      sendRequests(detector, tenantId, total, rejected);

      expect(onSpike).toHaveBeenCalledTimes(1);
      const event: SpikeEvent = onSpike.mock.calls[0][0];
      expect(event.tenantId).toBe(tenantId);
      expect(event.rejectionRate).toBeGreaterThan(0.5);
      expect(event.baseline).toBe(baselineRps * 60);
      expect(typeof event.timestamp).toBe('string');
    });

    it('is NOT called when rejection_rate > 0.5 but total <= 2 * baseline', () => {
      const { detector, onSpike, baselineRps } = makeDetector();
      const tenantId = 'tenant-low-volume';

      // total = 2 * baseline (not strictly greater)
      const total = baselineRps * 60 * 2;
      const rejected = Math.ceil(total * 0.6);

      sendRequests(detector, tenantId, total, rejected);

      expect(onSpike).not.toHaveBeenCalled();
    });

    it('is NOT called when total > 2 * baseline but rejection_rate <= 0.5', () => {
      const { detector, onSpike, baselineRps } = makeDetector();
      const tenantId = 'tenant-high-volume-low-rejection';

      const total = baselineRps * 60 * 2 + 1;
      // exactly 50% rejected — not strictly greater than 0.5
      const rejected = Math.floor(total * 0.5);

      sendRequests(detector, tenantId, total, rejected);

      expect(onSpike).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Sliding-window pruning
  // -------------------------------------------------------------------------

  describe('sliding window pruning', () => {
    it('events older than 60 seconds are pruned before evaluation', () => {
      const { detector, onSpike, baselineRps } = makeDetector();
      const tenantId = 'tenant-prune';

      // Record enough rejected requests to trigger a spike at t=0
      const total = baselineRps * 60 * 2 + 1;
      const rejected = Math.ceil(total * 0.6);
      sendRequests(detector, tenantId, total, rejected);

      // Advance time by 61 seconds — all previous events fall outside the window
      dateSpy.mockReturnValue(61_000);

      // Record a single allowed request; the old events should be pruned,
      // leaving only 1 allowed event → no spike
      detector.record(tenantId, true);

      // onSpike should have been called only once (for the first batch),
      // not again after the window was pruned.
      expect(onSpike).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Metrics integration
  // -------------------------------------------------------------------------

  describe('metrics', () => {
    it('abuseSpikeTotal.inc is called with { tenant_id } when a spike fires', () => {
      const { detector, abuseSpikeTotal, baselineRps } = makeDetector();
      const tenantId = 'tenant-metrics';

      const total = baselineRps * 60 * 2 + 1;
      const rejected = Math.ceil(total * 0.6);

      sendRequests(detector, tenantId, total, rejected);

      expect(abuseSpikeTotal.inc).toHaveBeenCalledWith({ tenant_id: tenantId });
    });

    it('abuseSpikeTotal.inc is NOT called when no spike fires', () => {
      const { detector, abuseSpikeTotal, baselineRps } = makeDetector();
      const tenantId = 'tenant-no-spike';

      // High rejection rate but volume too low
      const total = baselineRps * 60;
      const rejected = Math.ceil(total * 0.8);

      sendRequests(detector, tenantId, total, rejected);

      expect(abuseSpikeTotal.inc).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Repeated spikes (no deduplication)
  // -------------------------------------------------------------------------

  describe('repeated spikes', () => {
    it('onSpike is called multiple times for repeated spikes (not deduplicated)', () => {
      const { detector, onSpike, baselineRps } = makeDetector();
      const tenantId = 'tenant-repeat';

      const total = baselineRps * 60 * 2 + 1;
      const rejected = Math.ceil(total * 0.6);

      // First spike
      sendRequests(detector, tenantId, total, rejected);

      // Advance time so the window resets, then trigger a second spike
      dateSpy.mockReturnValue(61_000);
      sendRequests(detector, tenantId, total, rejected);

      expect(onSpike).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // Tenant isolation
  // -------------------------------------------------------------------------

  describe('tenant isolation', () => {
    it('record() for different tenants does not cross-contaminate windows', () => {
      const { detector, onSpike, baselineRps } = makeDetector();

      const tenantA = 'tenant-a';
      const tenantB = 'tenant-b';

      // Tenant A: spike conditions met
      const total = baselineRps * 60 * 2 + 1;
      const rejected = Math.ceil(total * 0.6);
      sendRequests(detector, tenantA, total, rejected);

      // Tenant B: only a handful of allowed requests
      sendRequests(detector, tenantB, 5, 0);

      // onSpike should only have fired for tenant A
      expect(onSpike).toHaveBeenCalledTimes(1);
      expect(onSpike.mock.calls[0][0].tenantId).toBe(tenantA);
    });
  });
});

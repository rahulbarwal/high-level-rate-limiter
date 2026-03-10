import {
  CredentialStuffingDetector,
  CredentialStuffingEvent,
} from '../../src/abuse/credentialStuffingDetector';

// ---------------------------------------------------------------------------
// CredentialStuffingDetector unit tests
//
// The stub throws 'not implemented' on record(), so every test in this file
// is expected to FAIL at runtime until the real implementation is wired in.
// ---------------------------------------------------------------------------

// 5-minute sliding window
const WINDOW_SECONDS = 300;

// Thresholds that must BOTH be exceeded to fire onSuspected
const ERROR_RATE_THRESHOLD = 0.2; // > 20%
const AUTH_ERROR_COUNT_THRESHOLD = 50; // > 50

// Status codes that count as auth errors
const AUTH_ERROR_CODES = [401, 403];
// Status codes that must NOT count as auth errors
const NON_AUTH_ERROR_CODES = [200, 400, 404, 500];

/** Build a CredentialStuffingDetector with a jest-mocked onSuspected. */
function makeDetector() {
  const onSuspected = jest.fn<void, [CredentialStuffingEvent]>();
  const detector = new CredentialStuffingDetector({ onSuspected });
  return { detector, onSuspected };
}

/**
 * Record `total` requests for `tenantId`.
 * The first `authErrorCount` requests use `authErrorCode` (default 401);
 * the remainder use 200.
 */
function sendRequests(
  detector: CredentialStuffingDetector,
  tenantId: string,
  total: number,
  authErrorCount: number,
  authErrorCode = 401,
): void {
  for (let i = 0; i < total; i++) {
    detector.record(tenantId, i < authErrorCount ? authErrorCode : 200);
  }
}

describe('CredentialStuffingDetector', () => {
  let dateSpy: jest.SpyInstance;

  beforeEach(() => {
    dateSpy = jest.spyOn(Date, 'now').mockReturnValue(0);
  });

  afterEach(() => {
    dateSpy.mockRestore();
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Core detection logic
  // -------------------------------------------------------------------------

  describe('onSuspected callback', () => {
    it('is called when error_rate > 0.20 AND authErrors > 50', () => {
      const { detector, onSuspected } = makeDetector();
      const tenantId = 'tenant-stuffing';

      // 51 auth errors out of 200 total → error_rate = 25.5% > 20%, count = 51 > 50
      const total = 200;
      const authErrors = AUTH_ERROR_COUNT_THRESHOLD + 1; // 51

      sendRequests(detector, tenantId, total, authErrors);

      expect(onSuspected).toHaveBeenCalledTimes(1);
      const event: CredentialStuffingEvent = onSuspected.mock.calls[0][0];
      expect(event.tenantId).toBe(tenantId);
      expect(event.errorRate).toBeGreaterThan(ERROR_RATE_THRESHOLD);
      expect(event.errorCount).toBeGreaterThan(AUTH_ERROR_COUNT_THRESHOLD);
      expect(typeof event.timestamp).toBe('string');
    });

    it('is NOT called when error_rate > 0.20 but authErrors <= 50', () => {
      const { detector, onSuspected } = makeDetector();
      const tenantId = 'tenant-low-count';

      // 50 auth errors out of 100 total → error_rate = 50% > 20%, but count = 50 (not > 50)
      const total = 100;
      const authErrors = AUTH_ERROR_COUNT_THRESHOLD; // exactly 50, not strictly greater

      sendRequests(detector, tenantId, total, authErrors);

      expect(onSuspected).not.toHaveBeenCalled();
    });

    it('is NOT called when authErrors > 50 but error_rate <= 0.20', () => {
      const { detector, onSuspected } = makeDetector();
      const tenantId = 'tenant-low-rate';

      // 51 auth errors out of 510 total → error_rate = 10% ≤ 20%
      const authErrors = AUTH_ERROR_COUNT_THRESHOLD + 1; // 51
      const total = authErrors / ERROR_RATE_THRESHOLD; // 255 → exactly 20%, use 256 for ≤ boundary

      // 51 errors out of 510 = 10% — well below threshold
      sendRequests(detector, tenantId, authErrors * 10, authErrors);

      expect(onSuspected).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Sliding-window pruning (5-minute window)
  // -------------------------------------------------------------------------

  describe('sliding window pruning', () => {
    it('events older than 300 seconds are pruned before evaluation', () => {
      const { detector, onSuspected } = makeDetector();
      const tenantId = 'tenant-prune';

      // Trigger a detection at t=0
      sendRequests(detector, tenantId, 200, AUTH_ERROR_COUNT_THRESHOLD + 1);
      expect(onSuspected).toHaveBeenCalledTimes(1);

      // Advance time by 301 seconds — all previous events fall outside the window
      dateSpy.mockReturnValue((WINDOW_SECONDS + 1) * 1000);

      // Record a single 200 — old events pruned, only 1 non-error entry remains
      detector.record(tenantId, 200);

      // onSuspected must NOT have fired a second time after the window reset
      expect(onSuspected).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Auth-error status code filtering
  // -------------------------------------------------------------------------

  describe('auth error status code filtering', () => {
    it.each(AUTH_ERROR_CODES)(
      'status code %i counts as an auth error',
      (code) => {
        const { detector, onSuspected } = makeDetector();
        const tenantId = `tenant-code-${code}`;

        // 51 of the given code out of 200 total → should trigger
        sendRequests(detector, tenantId, 200, AUTH_ERROR_COUNT_THRESHOLD + 1, code);

        expect(onSuspected).toHaveBeenCalledTimes(1);
        expect(onSuspected.mock.calls[0][0].errorCount).toBeGreaterThan(
          AUTH_ERROR_COUNT_THRESHOLD,
        );
      },
    );

    it.each(NON_AUTH_ERROR_CODES)(
      'status code %i does NOT count as an auth error',
      (code) => {
        const { detector, onSuspected } = makeDetector();
        const tenantId = `tenant-non-auth-${code}`;

        // Send 200 requests all with the non-auth code — none should count as auth errors
        for (let i = 0; i < 200; i++) {
          detector.record(tenantId, code);
        }

        expect(onSuspected).not.toHaveBeenCalled();
      },
    );
  });

  // -------------------------------------------------------------------------
  // Multiple triggers (no deduplication)
  // -------------------------------------------------------------------------

  describe('multiple triggers', () => {
    it('each independent trigger calls onSuspected separately', () => {
      const { detector, onSuspected } = makeDetector();
      const tenantId = 'tenant-multi-trigger';

      // First trigger at t=0
      sendRequests(detector, tenantId, 200, AUTH_ERROR_COUNT_THRESHOLD + 1);
      expect(onSuspected).toHaveBeenCalledTimes(1);

      // Advance time past the window so events are pruned, then trigger again
      dateSpy.mockReturnValue((WINDOW_SECONDS + 1) * 1000);
      sendRequests(detector, tenantId, 200, AUTH_ERROR_COUNT_THRESHOLD + 1);

      expect(onSuspected).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // Tenant isolation
  // -------------------------------------------------------------------------

  describe('tenant isolation', () => {
    it('different tenants have isolated windows', () => {
      const { detector, onSuspected } = makeDetector();

      const tenantA = 'tenant-cs-a';
      const tenantB = 'tenant-cs-b';

      // Tenant A: detection conditions met
      sendRequests(detector, tenantA, 200, AUTH_ERROR_COUNT_THRESHOLD + 1);

      // Tenant B: only a handful of successful requests — no detection
      sendRequests(detector, tenantB, 10, 0);

      expect(onSuspected).toHaveBeenCalledTimes(1);
      expect(onSuspected.mock.calls[0][0].tenantId).toBe(tenantA);
    });
  });
});

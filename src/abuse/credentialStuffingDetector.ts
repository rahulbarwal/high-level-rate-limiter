export type CredentialStuffingEvent = {
  tenantId: string;
  errorRate: number;
  errorCount: number;
  timestamp: string;
};

export interface CredentialStuffingDetectorOptions {
  onSuspected: (event: CredentialStuffingEvent) => void;
}

interface StatusEntry {
  timestamp: number;
  statusCode: number;
}

const WINDOW_MS = 300_000; // 5 minutes
const AUTH_ERROR_CODES = new Set([401, 403]);
const ERROR_RATE_THRESHOLD = 0.2;
const AUTH_ERROR_COUNT_THRESHOLD = 50;

export class CredentialStuffingDetector {
  private readonly onSuspected: (event: CredentialStuffingEvent) => void;
  private readonly windows = new Map<string, StatusEntry[]>();
  // Tracks whether onSuspected has already fired for the current window state.
  // Cleared when conditions drop below threshold, allowing re-fire on the next crossing.
  private readonly suspected = new Set<string>();

  constructor(options: CredentialStuffingDetectorOptions) {
    this.onSuspected = options.onSuspected;
  }

  record(tenantId: string, statusCode: number): void {
    const now = Date.now();

    let entries = this.windows.get(tenantId);
    if (!entries) {
      entries = [];
      this.windows.set(tenantId, entries);
    }

    entries.push({ timestamp: now, statusCode });

    // Prune entries outside the 5-minute sliding window
    const cutoff = now - WINDOW_MS;
    let pruneUntil = 0;
    while (pruneUntil < entries.length && entries[pruneUntil].timestamp <= cutoff) {
      pruneUntil++;
    }
    if (pruneUntil > 0) {
      entries.splice(0, pruneUntil);
    }

    const total = entries.length;
    const authErrors = entries.filter((e) => AUTH_ERROR_CODES.has(e.statusCode)).length;
    const errorRate = authErrors / total;

    const conditionsMet = errorRate > ERROR_RATE_THRESHOLD && authErrors > AUTH_ERROR_COUNT_THRESHOLD;

    if (conditionsMet) {
      if (!this.suspected.has(tenantId)) {
        this.suspected.add(tenantId);
        this.onSuspected({
          tenantId,
          errorRate,
          errorCount: authErrors,
          timestamp: new Date(now).toISOString(),
        });
      }
    } else {
      // Reset so the next crossing fires again
      this.suspected.delete(tenantId);
    }
  }
}

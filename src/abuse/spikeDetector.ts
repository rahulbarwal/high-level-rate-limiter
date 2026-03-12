import type { AbuseDetector } from './types';

export type SpikeEvent = {
  tenantId: string;
  rejectionRate: number;
  baseline: number;
  timestamp: string;
};

export interface SpikeDetectorOptions {
  onSpike: (event: SpikeEvent) => void;
  baselineRps?: number;
  metrics?: {
    abuseSpikeTotal: {
      inc: (labels: object) => void;
    };
  };
}

interface RequestEntry {
  timestamp: number;
  allowed: boolean;
}

const WINDOW_MS = 60_000;
const DEFAULT_BASELINE_RPS = 10;

export class SpikeDetector implements AbuseDetector {
  private readonly onSpike: (event: SpikeEvent) => void;
  private readonly baseline: number;
  private readonly metrics?: SpikeDetectorOptions['metrics'];
  private readonly windows = new Map<string, RequestEntry[]>();

  constructor(options: SpikeDetectorOptions) {
    this.onSpike = options.onSpike;
    this.baseline = (options.baselineRps ?? DEFAULT_BASELINE_RPS) * (WINDOW_MS / 1000);
    this.metrics = options.metrics;
  }

  record(tenantId: string, statusCode: number, _context?: unknown): void {
    const allowed = statusCode < 400;
    const now = Date.now();

    let entries = this.windows.get(tenantId);
    if (!entries) {
      entries = [];
      this.windows.set(tenantId, entries);
    }

    entries.push({ timestamp: now, allowed });

    // Prune entries outside the sliding window
    const cutoff = now - WINDOW_MS;
    let pruneUntil = 0;
    while (pruneUntil < entries.length && entries[pruneUntil].timestamp <= cutoff) {
      pruneUntil++;
    }
    if (pruneUntil > 0) {
      entries.splice(0, pruneUntil);
    }

    const total = entries.length;
    const rejections = entries.filter((e) => !e.allowed).length;
    const rejectionRate = rejections / total;

    if (rejectionRate > 0.5 && total > 2 * this.baseline) {
      const event: SpikeEvent = {
        tenantId,
        rejectionRate,
        baseline: this.baseline,
        timestamp: new Date(now).toISOString(),
      };
      this.onSpike(event);
      this.metrics?.abuseSpikeTotal.inc({ tenant_id: tenantId });
    }
  }
}

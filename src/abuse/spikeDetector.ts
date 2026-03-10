export type SpikeEvent = {
  tenantId: string;
  rejectionRate: number;
  baseline: number;
  timestamp: string;
};

export interface SpikeDetectorOptions {
  onSpike: (event: SpikeEvent) => void;
  metrics?: {
    abuseSpikeTotal: {
      inc: (labels: object) => void;
    };
  };
}

export class SpikeDetector {
  constructor(_options: SpikeDetectorOptions) {
    // stub
  }

  record(_tenantId: string, _allowed: boolean): void {
    throw new Error('not implemented');
  }
}

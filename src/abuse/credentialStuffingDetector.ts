export type CredentialStuffingEvent = {
  tenantId: string;
  errorRate: number;
  errorCount: number;
  timestamp: string;
};

export interface CredentialStuffingDetectorOptions {
  onSuspected: (event: CredentialStuffingEvent) => void;
}

export class CredentialStuffingDetector {
  constructor(_options: CredentialStuffingDetectorOptions) {
    // stub
  }

  record(_tenantId: string, _statusCode: number): void {
    throw new Error('not implemented');
  }
}

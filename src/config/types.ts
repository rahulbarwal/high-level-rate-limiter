export interface TenantConfig {
  tenantId: string;
  requestsPerSecond: number;
  burstSize: number;
  enabled: boolean;
  updatedAt: Date;
}

export class ConfigStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigStoreError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

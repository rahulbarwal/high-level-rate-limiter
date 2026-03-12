import { TierLevel } from '../globalLimiter/types';

export { TierLevel };

export interface TenantConfig {
  tenantId: string;
  requestsPerSecond: number;
  burstSize: number;
  enabled: boolean;
  updatedAt: Date;
  baselineRps?: number;
  tier: TierLevel;
}

export class ConfigStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigStoreError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

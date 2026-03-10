import { TenantConfig } from './types';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function getConfigFromDB(tenantId: string): Promise<TenantConfig | null> {
  throw new Error('not implemented');
}

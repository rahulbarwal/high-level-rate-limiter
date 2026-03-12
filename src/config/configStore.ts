import { Pool } from 'pg';
import { TenantConfig, ConfigStoreError, TierLevel } from './types';

let _pool: Pool | null = null;

function getPool(): Pool {
  if (_pool === null) {
    _pool = new Pool({ connectionString: process.env.DB_CONNECTION_STRING });
  }
  return _pool;
}

const SQL = `
  SELECT tenant_id, requests_per_second, burst_size, enabled, updated_at, tier
  FROM   tenant_rate_limit_configs
  WHERE  tenant_id = $1
`;

export async function getConfigFromDB(tenantId: string): Promise<TenantConfig | null> {
  try {
    const result = await getPool().query(SQL, [tenantId]);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0] as {
      tenant_id: string;
      requests_per_second: number;
      burst_size: number;
      enabled: boolean;
      updated_at: Date;
      tier: number;
    };

    return {
      tenantId: row.tenant_id,
      requestsPerSecond: row.requests_per_second,
      burstSize: row.burst_size,
      enabled: row.enabled,
      updatedAt: row.updated_at,
      tier: (Number(row.tier) as TierLevel) || TierLevel.FREE,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConfigStoreError(message);
  }
}

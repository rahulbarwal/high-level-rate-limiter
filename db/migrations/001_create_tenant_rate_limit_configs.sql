CREATE TABLE IF NOT EXISTS tenant_rate_limit_configs (
  tenant_id           TEXT        PRIMARY KEY,
  requests_per_second FLOAT       NOT NULL,
  burst_size          FLOAT       NOT NULL,
  enabled             BOOLEAN     NOT NULL DEFAULT true,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Tier levels: 1=enterprise, 2=paying, 3=free, 4=internal
  tier                SMALLINT    NOT NULL DEFAULT 3
);

INSERT INTO tenant_rate_limit_configs (tenant_id, requests_per_second, burst_size, tier)
VALUES
  ('__default__',                   10,      50,    3),  -- free
  ('tenant_free_example',           10,      50,    3),  -- free
  ('tenant_pro_example',           100,     500,    2),  -- paying
  ('tenant_enterprise_example',   1000,    5000,    1),  -- enterprise
  ('tenant_internal_example',       50,     200,    4),  -- internal/testing
  -- Load test tenants (one per tier)
  ('tenant_load_test_enterprise', 5000,   25000,    1),  -- enterprise load test
  ('tenant_load_test_paying',      500,    2500,    2),  -- paying load test
  ('tenant_load_test_free',         50,     250,    3),  -- free load test
  ('tenant_load_test_internal',    100,     500,    4)   -- internal load test
ON CONFLICT (tenant_id) DO UPDATE
  SET requests_per_second = EXCLUDED.requests_per_second,
      burst_size           = EXCLUDED.burst_size,
      tier                 = EXCLUDED.tier,
      updated_at           = now();

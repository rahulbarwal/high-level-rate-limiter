CREATE TABLE IF NOT EXISTS tenant_rate_limit_configs (
  tenant_id          TEXT        PRIMARY KEY,
  requests_per_second FLOAT      NOT NULL,
  burst_size         FLOAT       NOT NULL,
  enabled            BOOLEAN     NOT NULL DEFAULT true,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO tenant_rate_limit_configs (tenant_id, requests_per_second, burst_size)
VALUES
  ('__default__',               10,    50),
  ('tenant_free_example',       10,    50),
  ('tenant_pro_example',       100,   500),
  ('tenant_enterprise_example', 1000, 5000)
ON CONFLICT (tenant_id) DO NOTHING;

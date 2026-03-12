#!/usr/bin/env sh
# =============================================================================
# Docker entrypoint — wait for PostgreSQL, run migration, then exec CMD
# =============================================================================

set -e

DB_CONNECTION_STRING="${DB_CONNECTION_STRING:-postgresql://postgres:postgres@postgres:5432/ratelimiter}"
MIGRATION_FILE="/app/db/migrations/001_create_tenant_rate_limit_configs.sql"

echo "Waiting for PostgreSQL to be ready..."
until psql "$DB_CONNECTION_STRING" -c "SELECT 1" >/dev/null 2>&1; do
  sleep 1
done
echo "PostgreSQL is ready."

echo "Running database migration..."
psql "$DB_CONNECTION_STRING" -f "$MIGRATION_FILE" || true
echo "Migration complete."

exec "$@"

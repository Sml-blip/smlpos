#!/bin/bash
# Runs ONCE, only when the Postgres data directory is empty.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  -- App role: owns the schema, runs migrations, used by the upload API
  CREATE ROLE pos_api LOGIN PASSWORD '${API_DB_PASSWORD}';
  GRANT ALL PRIVILEGES ON DATABASE pos TO pos_api;
  ALTER SCHEMA public OWNER TO pos_api;

  -- PowerSync replication role: read-only + replication
  CREATE ROLE powersync_role WITH REPLICATION LOGIN PASSWORD '${PS_PASSWORD}';
  GRANT USAGE ON SCHEMA public TO powersync_role;

  -- Publication PowerSync listens to (covers tables created later too)
  CREATE PUBLICATION powersync;
  ALTER PUBLICATION powersync OWNER TO pos_api;

  -- Separate database for PowerSync's own bucket storage
  CREATE ROLE powersync_storage_user LOGIN PASSWORD '${PS_STORAGE_PASSWORD}';
  CREATE DATABASE powersync_storage OWNER powersync_storage_user;
EOSQL


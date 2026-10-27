#!/bin/bash
set -eu
# This file is mounted only into the isolated staging Postgres container.
test "$POSTGRES_DB" = smlpos_staging
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE ROLE pos_api LOGIN PASSWORD '${API_DB_PASSWORD}';
  -- Schema grants reference this role even when PowerSync is not running.
  CREATE ROLE powersync_role NOLOGIN;
  GRANT USAGE ON SCHEMA public TO powersync_role;
  GRANT ALL PRIVILEGES ON DATABASE smlpos_staging TO pos_api;
  ALTER SCHEMA public OWNER TO pos_api;
EOSQL

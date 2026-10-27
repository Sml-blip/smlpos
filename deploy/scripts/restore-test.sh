#!/usr/bin/env bash
# Proves a dump is restorable: loads it into a throwaway Postgres and lists tables.
# usage: ./restore-test.sh /var/backups/pos/pos-XXXX.dump
set -euo pipefail
FILE=${1:?path to .dump file}
docker rm -f pgtest >/dev/null 2>&1 || true
docker run -d --name pgtest -e POSTGRES_PASSWORD=test postgres:16 >/dev/null
sleep 8
docker exec pgtest createdb -U postgres pos
docker exec -i pgtest pg_restore -U postgres -d pos --no-owner --no-privileges < "$FILE"
docker exec pgtest psql -U postgres -d pos -c '\dt'
docker rm -f pgtest >/dev/null
echo "restore test ok"


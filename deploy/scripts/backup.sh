#!/usr/bin/env bash
# Nightly: dump Postgres, keep 7 days locally, ship to Cloudflare R2 (30 days there).
# Prereq: rclone configured with a remote named "r2" (see README).
set -euo pipefail
cd /opt/pos
DIR=/var/backups/pos
mkdir -p "$DIR"
STAMP=$(date -u +%Y-%m-%dT%H%M%SZ)
FILE="$DIR/pos-$STAMP.dump"

docker compose exec -T postgres pg_dump -U postgres -Fc pos > "$FILE"
[ -s "$FILE" ] || { echo "empty dump"; exit 1; }

rclone copy "$FILE" r2:pos-backups/daily/
find "$DIR" -name '*.dump' -mtime +7 -delete
rclone delete r2:pos-backups/daily --min-age 30d
echo "backup ok: $FILE"


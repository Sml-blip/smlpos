# SMLPOS sync staging deployment

Verified on 2026-10-24 at `/opt/pos/staging` on `smlpos-sync-01` (`2.28.64.69`). This is a staging foundation, not a production migration.

## Running services

PostgreSQL 16, PowerSync 1.27.2, the Node 24 upload API and Caddy run in Docker Compose. PostgreSQL is private to the Docker network; the API diagnostic port binds only to server loopback. Caddy serves:

- `https://api.pos.sml.boutique/health`: HTTP 200, database check succeeds, both business writes and seeding disabled.
- `https://api.pos.sml.boutique/.well-known/jwks.json`: HTTP 200, public signing key only.
- `https://sync.pos.sml.boutique`: TLS works. The root returns HTTP 404; it is not a client streaming test.

DNS is authoritative at Vercel, with A records `api.pos` and `sync.pos` under `sml.boutique`, pointing to the VPS. The domain registrar is OVH. No nameserver change is needed.

PowerSync logs confirm all 42 publication tables were snapshotted and the replication stream activated. The desktop does not yet connect a PowerSync database. No main-PC business data has been uploaded. No real login accounts have been provisioned.

## Reproduce the backend validation

From the staging directory on the server:

```sh
docker compose config --quiet
docker compose up -d --build postgres api powersync
docker compose --profile test run --build --rm tests
docker compose --profile public up -d caddy
```

The test runner creates a uniquely named synthetic PostgreSQL schema, runs migrations twice, exercises the API, then removes only that schema. It does not populate the public business tables. The verified result is 29 passing tests, zero failures and zero skipped tests.

`infra/hetzner/stage_backend.py` transfers source without `.env`, private keys, node_modules or database files. It preserves existing volumes and secrets. The first run creates server-side random database passwords and an RSA signing key. Never print `docker compose config` without `--quiet`, copy private keys into the repository, or remove the database volume to rerun initialization.

`schema.sql`, the upload registry and PowerSync rules are generated from the audited source inventory with `python deploy/generate-schema.py`. Review generated migrations before applying to any populated production database. The present migrations create the initial staging schema; they are not a general production schema-upgrade system.

## Activation requirements

Keep `LIVE_WRITES_ENABLED=false` and `SEED_STAGING_ENABLED=false`. Changing it alone cannot make this POS sync correctly. Required work remains:

1. Finish legacy semantic reconciliation: JSON/polymorphic links, organization/cash opening policy, timestamp policy and large-database streaming. The dry-run converter already produces stable ID mappings, exact millimes and stock/account opening movements.
2. Add desktop upload orchestration, exactly-once activation and rollback. Authenticated resumable staging jobs and server validation are implemented and tested, but disabled for real uploads. Staged rows never enter the publication and cannot be activated through the current API.
3. Integrate the desktop PowerSync database and rewrite business writes for immutable documents and movement ledgers; account for every existing read/write path.
4. Exercise two real client databases for disconnect/reconnect, replay, conflict, revocation and failed uploads.
5. Configure offsite backups and prove a restore before importing authoritative business data.
6. Package a versioned main-PC update only after these checks pass. Its first-run wizard must perform backup/preflight on that PC; a main-PC database copy on the development PC is not required.

The current desktop preparation action makes a full local app-data copy and a SQLite online backup, verifies integrity and row counts, records millime totals, and writes a SHA-256 manifest plus a local `seed-plan.json`. It reports conversion counts, opening movements and blocking/review issues. It does not upload, activate a seed or enable syncing.

## Operational limits

No paid Hetzner backup or R2 destination is configured. The scripts in `scripts/` are operational helpers, not evidence of an installed backup schedule. Never run a restore against the live database. Review disk use, replication-slot WAL retention and container memory before production activation.

API accounts must be created through `api/src/admin.ts` using protected stdin; it hashes passwords and enforces the three-user limit. Do not put passwords in command history, URLs or chat. Desktop tokens are stored with Electron safeStorage and never sent to the renderer.


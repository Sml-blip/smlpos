# SMLPOS shared-host staging plan

**Status: blocked before server access.** The user must supply the independently
verified ED25519 SHA256 host-key fingerprint and say “go”. No staging deployment
or production backup/restore verification has been performed for this plan.
No purchase is authorized. See [the staging plan](../infra/hetzner/shared-host-staging-plan.md).

The historical stack at `/opt/pos/staging` serves the production API. It is not
the staging target and must not be modified. The new isolated stack uses
`/opt/smlpos-staging`, project `smlpos-staging`, volume
`smlpos-staging_pgdata`, network `smlpos-staging_internal`, and the standalone
`docker-compose.staging.yml`. Never combine it with `docker-compose.yml`.
API and PowerSync ports are bound only to `127.0.0.1:23001` and `:23002` and
require SSH tunnels. Every container has CPU and memory limits. There is no
staging Caddy or published Postgres port. No production Caddy, DNS, firewall,
containers or volumes may be changed.

`infra/hetzner/stage_backend.py` requires `--shared-host-staging`, explicit
`SMLPOS_STAGING_HOST=2.28.64.69`, and a known-hosts ED25519 key matching the
independently supplied `SMLPOS_STAGING_HOST_FINGERPRINT`. Without those the
dry run refuses the target. `--show-plan` only prints the commands and remote
Python payload; it does not select or contact a target. Executing also requires
`--execute --step-b-clean` after the user’s go and reviewed Step B. The
production project, `/opt/pos`, external/production volumes, and unexpected
resource names are refused. The new `.env` and passwords are generated on the
server, and the staging API enables `LIVE_WRITES_ENABLED`,
`SEED_STAGING_ENABLED`, `SYNC2_ENABLED`, and `STAGING_ONLY` for the synthetic
staging tests only. Production flags remain false.

After user go: pin the verified host key, perform and paste the read-only
resource and production baseline checks, stop at the agreed RAM/disk thresholds,
then verify a production database dump in a separate scratch PostgreSQL
container. Only after clean Step B may staging be deployed and tested. Stop on
unexpected results. Follow the linked plan for teardown and before/after proof.
The existing two-PC fixture uses its own local API; its output alone does not
prove physical two-PC streaming through the deployed staging API.

The only server-side Compose file selection is:

```sh
docker compose --project-name smlpos-staging --project-directory /opt/smlpos-staging --env-file /opt/smlpos-staging/.env -f /opt/smlpos-staging/docker-compose.staging.yml
```

`schema.sql`, the upload registry and PowerSync rules are generated from the audited source inventory with `python deploy/generate-schema.py`. Review generated migrations before applying to any populated production database. The present migrations create the initial staging schema; they are not a general production schema-upgrade system.

Before a synthetic seed is attempted, audit the sync boundary without changing
rows:

```sql
SELECT id, status, snapshot_seq
FROM sync2_seeds
ORDER BY created_at;
```

An existing active row with `snapshot_seq IS NULL` must not be reactivated. Use
a new isolated staging database or prepare a reviewed boundary backfill on
staging; never infer a boundary from an unrelated production sequence.

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


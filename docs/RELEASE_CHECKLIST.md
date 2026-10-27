# SMLPOS Sync — Staging and Release Readiness

**Assessment date:** 2026-10-26  
**Branch:** `codex/multidevice-sync-platform`  
**Overall status:** **BLOCKED — do not release or use against a production PC.**

This checklist records only commands run in this checkout. It does not treat a
local synthetic test as proof of a Hetzner staging deployment or physical-PC
validation.

## Safety boundary

- No request was sent to `api.pos.sml.boutique` or any production database.
- No Hetzner deployment, migration, seed, release, or merge was run for this plan. Local commits were pushed to the feature branch.
- Public DNS resolution returned `api.pos.sml.boutique -> 2.28.64.69` and
  `sync.pos.sml.boutique -> 2.28.64.69`. The repository's deployment helper
  targets `2.28.64.69`; this is therefore not a separately named staging
  public endpoint. Staging access must remain through its loopback-only port.
- The API tests with a database URL were not run against staging.
- The scratch PostgreSQL used in the preceding local proof was removed.
- At the historical local assessment the host-key pin was absent. Step B later
  verified the independently supplied fingerprint and saved a pin in the ignored
  `infra/hetzner/.generated/known_hosts` file. Strict checking remains required.

## Code and staging configuration prepared

- The standalone `deploy/docker-compose.staging.yml` uses project
  `smlpos-staging`, volume `smlpos-staging_pgdata`, and loopback API port
  `23001`. Only PostgreSQL and API services run, each with CPU and memory limits. Staging
  flags for seed, sync2, live writes, and staging-only mode are enabled only
  in its own generated environment.
- Added an API `SYNC2_ENABLED` toggle and made `/health` report the sync2,
  staging seed, live-write, and staging-only states. In staging-only mode, API
  requests whose Host is not loopback receive 404. This keeps a staging API
  from being exposed through the production hostname.
- Updated `infra/hetzner/stage_backend.py` to use only the standalone staging file for
  compose config, deployment, and database tests. The helper has **not** been
  run against Hetzner.
- Added root npm scripts `test` and `test:ipc`; npm itself is not installed or
  available in this environment, so their underlying Node commands were run
  directly.

## Automated verification

| Check | Status | Command and observed output |
|---|---|---|
| Desktop synthetic suite | **PASS** | `node scripts/seed-test/run.mjs` — `tests 43`, `pass 43`, `fail 0`, `skipped 0`. |
| IPC handler integrity | **PASS** | `node scripts/check-ipc-handlers.mjs` — `Base handlers: 203`, `Working handlers: 203`, `Missing base handlers: 0`. |
| TypeScript | **PASS** | `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.web.json`; `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json`; `node deploy/api/node_modules/typescript/bin/tsc --noEmit -p deploy/api/tsconfig.json` — all exit 0, no diagnostics. |
| Electron desktop build | **PASS** | `node node_modules/electron-vite/bin/electron-vite.js build` — main, preload, and renderer built. One existing non-blocking warning remains for dynamic and static imports of `src/main/seed/client.ts`. |
| API unit/config tests | **PASS** | API run below — staging flag/Host tests and database-independent tests pass. |
| API database integrations | **BLOCKED** | Same API run reports `pass 12`, `fail 0`, `skipped 3`. The skipped tests are auth/Postgres, seed staging/Postgres, and sync2/Postgres because no `TEST_DATABASE_URL` for isolated staging was available. These are not counted as passing. |
| Compose YAML syntax | **PASS (YAML only)** | `js-yaml` parsed `deploy/docker-compose.yml` and `deploy/docker-compose.staging.yml`. Docker Compose runtime validation was not possible because Docker Compose is unavailable here. |
| Staging API deployment/migration | **BLOCKED — NOT RUN** | The host-key pin was verified during Step B; the shared host is also the production API IP. The new isolated helper has not deployed staging. |
| `snapshot_seq` staging audit | **NOT RUN** | No staging database connection. Read-only audit query is below. |
| Physical/manual PC validation | **NOT RUN** | No two staging Windows test PCs were available. |
| `npm test` / `npm run test:ipc` invocations | **NOT RUN** | npm is unavailable in the environment. Their underlying commands passed directly as listed above. |

### API test output

Command:

```text
node --test deploy/api/test/config.test.ts deploy/api/test/domain.test.ts deploy/api/test/seedConversion.test.ts deploy/api/test/integration.test.ts deploy/api/test/seed.test.ts deploy/api/test/sync2.test.ts
```

Observed summary:

```text
ℹ tests 15
ℹ pass 12
ℹ fail 0
ℹ skipped 3
```

The three skips require `TEST_DATABASE_URL`; they do not verify the updated
schema or push/pull routes against staging PostgreSQL.

### Staging seed-boundary audit

After the verified staging database is reachable, run this read-only query
before testing activation:

```sql
SELECT id, status, snapshot_seq
FROM sync2_seeds
ORDER BY created_at;
```

Do not reactivate any active record with `snapshot_seq IS NULL`. The API
intentionally returns `SEED_BOUNDARY_REQUIRED` for that record. Use a fresh
isolated staging database or obtain a separately reviewed staging-only
boundary reconciliation. Do not infer a boundary from a production sequence.

## Staging deployment and test-PC procedure

These steps remain **pending** until the independently verified host-key
fingerprint and user “go” are received and the read-only and backup/restore
checks in [the shared-host plan](../infra/hetzner/shared-host-staging-plan.md)
pass. No server purchase is authorized. The shared production host must not be
considered an isolated machine; isolation is by a separate project, directory,
volume and loopback ports. Stop for unexpected results and the specified
RAM/disk thresholds.

1. Verify and pin the ED25519 host key; use the existing `deploy` identity only
   if access works. Inspect and record production container IDs, start times,
   volumes, flags, resource usage and ports. Prove a production `pg_dump`
   restores into a separate scratch cluster before deployment.
2. Deploy with the explicit `--shared-host-staging` and `--step-b-clean` gates
   after the reviewed checks. Confirm `/health` reports `stage=staging`,
   `seedStagingEnabled=true`, `sync2Enabled=true`, `stagingOnly=true`, and
   `liveWritesEnabled=true` in staging only. Confirm login URLs are loopback.
3. Run tests using only project `smlpos-staging` and standalone
   `/opt/smlpos-staging/docker-compose.staging.yml`. Require zero failures;
   audit `snapshot_seq` in the staging database and report skipped tests.
4. On the staging source PC only, take and verify a local backup. Install the
   same staging build on both test PCs. Do not connect either PC to the
   production API or use business data.
5. Main/staging source PC: open **Synchronisation multi-postes**, register the
   synthetic staging account, create a verified backup, run the dry run,
   inspect the complete report and blockers, then explicitly approve and start
   the seed. Confirm server/local row counts and millime totals match and seed
   status is **done**.
6. PC 2: use a clean Windows profile/database, choose **Rejoindre une
   entreprise**, enter the staging tunnel URL and synthetic credentials, and
   observe the download progress. Confirm row counts and millime totals match;
   verify operator/PIN/login remain unavailable until the completed
   verification unlocks the POS.
7. During the initial download, drop the test network and close the app. Restore
   network, reopen, and resume. Repeat a live-sync disconnect with one
   synthetic offline sale; reconnect and confirm sale, lines, stock movement,
   and balances each land once on both PCs.
8. Record screenshots, build version, test-PC OS versions, network steps, and
   observed error messages here before marking physical validation **PASS**.

## Shared-host isolation and cleanup

The existing `smlpos-sync-01` hosts production. Use only
`/opt/smlpos-staging`, project `smlpos-staging`, and its dedicated volume and
network. Do not attach the `smlpos-staging-ssh` firewall or change DNS, Caddy,
ports 80/443, production containers, or production volume names. The new
`smlpos-staging` key uploaded to Hetzner is not installed on this existing
server. Do not alter SSH configuration to add it.

After successful tests, tear down only the staging project and its volumes.
Compare raw before/after production container IDs, start times, restart counts,
volume lists and attachments, and flags. Uptime should advance naturally.
Keep the verified production dump and test evidence. These steps have not run.

## Administrator runbook after staging validation

### Main PC (seed source)

1. Verify the main-PC database backup locally before installing anything; keep
   the backup path and integrity report with the test record.
2. Install only the approved staging build on the staging source PC. Confirm
   its API address is the staging SSH tunnel and the staging health flags are
   correct.
3. Open the Sync Panel, register the synthetic staging account, and run the
   backup/preflight dry run.
4. Review every table count, millime total, conversion, opening stock/balance,
   and blocking/review item. Resolve all blockers; do not approve an incomplete
   report.
5. Record the report, enter the explicit seed approval phrase, run the seed,
   and wait for server verification and activation to report success.

### PC 2 (replica)

1. Use a dedicated test PC or clean Windows profile with no business database.
2. Install exactly the same staging build; configure the SSH tunnel and
   synthetic account.
3. Join the staging company, monitor download progress, and wait for count and
   millime reconciliation before attempting cashier login.
4. Perform the restart/network-loss and offline-sale scenarios above. Save the
   Sync Panel report and screenshots.

## Release decision

**Not ready for internal two-PC staging sign-off yet.** Local desktop and API
unit checks pass, but the staging migration/API integration and manual PC
checks have not run. Do not publish, merge, deploy to production, or install on
production shop PCs until those blockers are completed and this checklist is
updated with actual staging command outputs.

## Phase 2 access recheck — 2026-10-26

Observed during the next staging-validation attempt:

```text
StageKnownHosts : False
UserKnownHosts  : False
DeployKey       : True
StagingOverride : True
DockerCompose   : False
Npm             : False
TestPcMarker    : False

api.pos.sml.boutique  2.28.64.69
sync.pos.sml.boutique 2.28.64.69
```

At that historical check no SSH connection was attempted because the strict known-hosts pin was absent
and the target IP was also the production API address. No container command,
database migration, or physical test-PC action was run. The desktop suite was
re-run in this phase and again reported `tests 43`, `pass 43`, `fail 0`,
`skipped 0`; IPC reported `Base handlers: 203`, `Working handlers: 203`,
`Missing base handlers: 0`. Those local results do not clear the staging or
physical validation blockers.

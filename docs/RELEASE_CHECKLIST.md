# SMLPOS Sync — Staging and Release Readiness

**Assessment date:** 2026-10-26  
**Branch:** `codex/multidevice-sync-platform`  
**Overall status:** **BLOCKED — do not release or use against a production PC.**

This checklist records only commands run in this checkout. It does not treat a
local synthetic test as proof of a Hetzner staging deployment or physical-PC
validation.

## Safety boundary

- No request was sent to `api.pos.sml.boutique` or any production database.
- No Hetzner deployment, migration, seed, release, merge, or Git push was run.
- Public DNS resolution returned `api.pos.sml.boutique -> 2.28.64.69` and
  `sync.pos.sml.boutique -> 2.28.64.69`. The repository's deployment helper
  targets `2.28.64.69`; this is therefore not a separately named staging
  public endpoint. Staging access must remain through its loopback-only port.
- The API tests with a database URL were not run against staging.
- The scratch PostgreSQL used in the preceding local proof was removed.
- The staging host key is not present in this checkout (`infra/hetzner/.generated/known_hosts`
  and the Windows user's `known_hosts` were both absent). The documented
  deployment helper uses strict host-key checking; that safety check was not
  disabled.

## Code and staging configuration prepared

- Added `deploy/docker-compose.staging.yml`. It pins Compose to
  `pos-sync-staging`, uses the dedicated volume `pos-sync-staging_pgdata`, sets
  `SEED_STAGING_ENABLED=true` and `SYNC2_ENABLED=true`, keeps
  `LIVE_WRITES_ENABLED=false`, enables `STAGING_ONLY=true`, and binds the API
  only to `127.0.0.1:13001`.
- Added an API `SYNC2_ENABLED` toggle and made `/health` report the sync2,
  staging seed, live-write, and staging-only states. In staging-only mode, API
  requests whose Host is not loopback receive 404. This keeps a staging API
  from being exposed through the production hostname.
- Updated `infra/hetzner/stage_backend.py` to use the staging override for
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
| Compose YAML syntax | **PASS (YAML only)** | `js-yaml` parsed `deploy/docker-compose.yml` and `deploy/docker-compose.staging.yml`. Docker Compose's merge/runtime validation was not possible because Docker Compose is unavailable here. |
| Staging API deployment/migration | **BLOCKED — NOT RUN** | No verified host-key pin; DNS shows the documented host IP is also the production API IP. `stage_backend.py` was not invoked. |
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

These steps remain **pending** until a separately billed staging server has
been provisioned and its host key verified. The existing Hetzner server
`smlpos-sync-01` is `2.28.64.69`, the same IP previously returned for the
production API names, so it must not be treated as isolated staging. The new
staging Compose override binds the API and PowerSync to server loopback ports
`13001` and `13002`; a test PC must tunnel both ports and use
`http://127.0.0.1:13001` as its API address.

1. Create a separate staging VM. Confirm its SSH host key against the Hetzner
   console and pin it in the ignored `infra/hetzner/.generated/known_hosts`
   file. Set `SMLPOS_STAGING_HOST` to that IP/hostname. The deployment helper
   rejects the production IP and production API hostnames and requires strict
   host-key checking. Confirm the target path is `/opt/pos/staging`, Compose
   project is `pos-sync-staging`, and the Postgres volume is
   `pos-sync-staging_pgdata`.
2. Deploy with the updated staging helper. Confirm `/health` reports
   `stage=staging`, `seedStagingEnabled=true`, `sync2Enabled=true`,
   `stagingOnly=true`, and `liveWritesEnabled=false`. Confirm requests with the
   production Host are rejected. Confirm staging login returns only loopback
   JWT/PowerSync URLs and both ports are reachable only through SSH tunnels.
3. Run `docker compose -f docker-compose.yml -f docker-compose.staging.yml
   --profile test run --build --rm tests` from `/opt/pos/staging`. Require zero
   skipped tests and zero failures. Audit `snapshot_seq` using the query above.
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

## Staging isolation follow-up — 2026-10-26

- Hetzner Console shows one existing server, `smlpos-sync-01`, at
  `2.28.64.69`. The staging deployment helper previously hardcoded that IP.
- The existing `smlpos-public` firewall allows inbound TCP 22, 80, 443, UDP
  443, and ICMP from any IPv4/IPv6 source. It must not be reused for staging;
  a separate SSH-only firewall is required.
- The helper now requires an explicit `SMLPOS_STAGING_HOST`, rejects the
  production API hostnames/IP, and requires a non-empty pinned known-hosts file
  while keeping `StrictHostKeyChecking=yes`. It uses a dedicated key at
  `~/.ssh/smlpos-staging` (or `SMLPOS_STAGING_SSH_KEY`), not the production key.
- A new local Ed25519 key pair named `smlpos-staging` was generated. Its
  SHA-256 fingerprint differs from `smlpos-hetzner-deploy`; the public key has
  been added to the Hetzner project with fingerprint
  `a1:25:d3:02:f2:17:f5:23:0a:9d:d3:59:24:13:ee:b7`; the private key remains
  on this development PC at `~/.ssh/smlpos-staging`.
- The `smlpos-staging-ssh` firewall form is prepared with only a TCP/22 rule;
  its default ICMP rule was removed. It has not been saved because the current
  public IPv4 source must be set before creation.
- The staging override now uses loopback-only API (`13001`) and PowerSync
  (`13002`) endpoints. Staging login no longer advertises production API or
  PowerSync URLs.
- No new server was created and no deployment or migration was run. The
  Hetzner create page showed CPX22 (2 vCPU, 4 GB RAM, 80 GB SSD) at
  `$23.59/month` including IPv4, excluding VAT. A human must complete the
  purchase step; this recurring charge has not been authorized with a cap. The
  draft used the name `smlpos-staging-01` and Nuremberg; no SSH key or firewall
  has been attached and the purchase button has not been used.
- Overall status remains **BLOCKED** pending a separately identified staging
  host, current-IP-restricted firewall, host-key pin, API deployment, database
  test output, and physical two-PC validation. Production rollout remains
  blocked until those staging gates pass.

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

No SSH connection was attempted because the strict known-hosts pin is absent
and the target IP is also the production API address. No container command,
database migration, or physical test-PC action was run. The desktop suite was
re-run in this phase and again reported `tests 43`, `pass 43`, `fail 0`,
`skipped 0`; IPC reported `Base handlers: 203`, `Working handlers: 203`,
`Missing base handlers: 0`. Those local results do not clear the staging or
physical validation blockers.

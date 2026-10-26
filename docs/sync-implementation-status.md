# Main-PC seed update: implementation state

Updated 2026-10-24. The authoritative database lives on the client's main PC. This workstation is development only. Do not require the user to move the live database to this workstation.

## Implemented and verified

- Complete source audit: 43 SQLite tables, columns, foreign keys, workflows and sync coverage in `../data-audit/`.
- Hetzner host and HTTPS staging stack, including 42-table PostgreSQL publication and active PowerSync server replication.
- API authentication, rotating refresh tokens, device registration/revocation, three-device limit, upload transaction idempotency and rollback, table/column/type validation and immutable-record protections. Production writes remain disabled.
- Desktop status dialog: connectivity, registered devices, rejection messages, explicit distinction between server reachability and completed synchronization, and local source-PC preflight.
- Source-PC preflight: closed-shift check; asynchronous full app-data copy to the external archive; SQLite online backup; read-only integrity/foreign-key/count checks; integer millime totals; serial/debt warnings; SHA-256 report. Concurrent local or other-connection writes invalidate preparation. It never alters or uploads source records. It now writes a local conversion plan next to the verified copy, including stable UUID mappings, bounded batches, exact per-value millime conversion, and stock/customer/supplier/personnel/loyalty opening movements. The seven preflight money totals must match the converted totals. Bare timestamps fail closed until their UTC/local-time policy is explicitly resolved.

- Resumable seed staging API: authenticated admin-only jobs; a single source device/job; durable per-batch receipts; manifest and contract hashes; replay and conflict checks; complete count/money-column coverage; known-reference and uniqueness validation; restart/resume; and cancellation that retains audit evidence. These tables are excluded from the PowerSync publication. There is no activation route. `SEED_STAGING_ENABLED=false` and `LIVE_WRITES_ENABLED=false` remain deployed.

## Verification evidence

- Electron/Vite production bundle: passed.
- API strict TypeScript: passed.
- Real PostgreSQL/API test run on the VPS: 29 passed, 0 failed, 0 skipped. Includes the original API suite, seed interruption/restart/replay, whole-batch rollback, count/money/reference/serial validation, empty-target enforcement, exact conversion and the synthetic legacy-conversion-to-server-verification flow. No published business rows are created by the seed flow.
- Source preflight synthetic SQLite test: passed. Checks 43-table inventory, integer totals, duplicate-serial/debt warnings, unchanged counts and read-only behavior.
- Browser preview: dialog opened, preview backup action refused database access, latest screenshot at `../infra/hetzner/seed-plan-panel-preview.png`. Browser preview uses synthetic data and deliberately shows server unavailable; it does not test real Electron IPC.
- Existing full-project TypeScript failures remain: main project 27 diagnostics, renderer 86. A successful bundler build does not replace fixing these diagnostics.

## Still required before a main-PC installer

Local seed conversion and resumable server staging are implemented as a dry-run foundation. Desktop upload orchestration, seed activation/rollback, the PowerSync desktop adapter and migration of legacy business writes remain unimplemented. The current app still uses the legacy local database and queue. There is no data streaming between two desktop clients, no automatic seed activation, no completed production stock/account ledger integration, no offsite backup/restore proof and no production login account. Do not describe the current build as the final sync update.

The final first-PC flow must be: backup locally, preflight, show counts/totals and issues, convert using durable legacy-ID mappings, stage all data under an authenticated resumable seed job, reconcile converted totals/relationships/opening balances, activate once, verify client convergence, then allow secondary devices. A failed or repeated attempt must preserve the source database and avoid duplicate records. Authoritative data stays untouched until the migration's checks pass.

Known limits: the current in-process converter stops above 250,000 source rows; a streaming implementation is needed for larger databases. Historical JSON and polymorphic legacy references require adapter review; unmapped required links block staging. Opening movements use the captured current balance only, without replaying old history. Cash opening policy, organization balance reconciliation and historical reference remapping are not certified. Staged verification checks structure and declared totals, not end-to-end business correctness.

No installer, release upload or auto-update publication was produced by this phase.


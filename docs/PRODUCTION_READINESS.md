# Production Readiness Report

Status: preparation only. No production migration, seed, activation, routing change, or volume change is authorized by this document.

## Executive conclusion

The local two-desktop proof is passing, but production is **not ready** for the new sync code. The live API image and the branch differ, production lacks required additive columns, and the database is not empty: it has an active PowerSync logical replication slot and non-empty PowerSync metadata. A zero-downtime production migration is not approved yet. First complete the isolated staging rehearsal and a full-fidelity backup/restore rehearsal. Plan a maintenance window unless those rehearsals prove that the exact image, migration locks, replication behavior, and rollback are safe.

## What is solid

- The branch is `codex/multidevice-sync-platform` and the local two-desktop proof covers first-touch join/login gating, allowlisted deltas, and stock movements.
- The production API health endpoint is reachable through HTTPS and reports flags disabled.
- A retained production dump was copied locally over the pinned SSH connection and hashed as SHA-256 `b26b9c4d9c9854c14e4c023e5c32f4a0f98292e8b58ec9227a691b27ea7d90bd` (236,834 bytes). This is evidence of a backup, not proof of a complete cluster restore.
- The branch has explicit feature flags; production must remain `LIVE_WRITES_ENABLED=false`, `SEED_STAGING_ENABLED=false`, and `SYNC2_ENABLED=false` until an approved window.

## Current production observations

- `pos-sync-staging-api-1` serves the non-`/v1` API through Caddy; `pos-v1-api` serves `/v1/*`. The hostname is therefore split by route, not served by one container.
- The API image serving the non-`/v1` route was `pos-sync-staging-api:latest`, image ID `sha256:2b687570b69cda93b27fc1248b2c84a07e4ee2e8c804b913e09001c84d5abbf7`, created 2026-10-25T15:19:46Z.
- The `/v1/*` API was `pos-v1-v1`, image ID `sha256:be07acbf2679067b6bb539a120fab0a9b09ed87d9f401ce846b1a2472a5dafae`, created 2026-10-25T20:18:26Z.
- The database has zero rows in `sync2_seeds`, `sync2_seed_rows`, `sync2_records`, `sync2_changes`, `sync2_operations`, `devices`, and `app_users`, but it is not literally empty: `public.sync_schema_versions` has one row and `powersync_storage` has metadata tables/rows.
- A PowerSync publication and active logical slot `powersync_1_bb6c` exist. The slot is cluster state and is not represented completely by a `pg_dump` of database `pos`.

## Exact schema differences

The current branch expects these columns, while production inspection found zero matching columns:

| Table | Column | Branch purpose | Production impact |
|---|---|---|---|
| `public.sync2_seeds` | `snapshot_seq bigint` | Snapshot boundary/sequence for deterministic seed activation | Seed creation/activation cannot enforce the branch's snapshot boundary contract. |
| `public.sync2_changes` | `operation text NOT NULL DEFAULT 'UPSERT'` | Distinguishes upsert/delete change semantics | Delta replay and delete handling cannot use the branch contract. |
| `public.sync2_changes` | `delta_field text` | Identifies a counter/stock delta field | Stock movement deltas cannot be represented. |
| `public.sync2_changes` | `delta_value bigint` | Stores the millime/integer delta | Stock and counter reconstruction cannot be performed. |

The branch also changes `sync2.sql`, `app.ts`, `server.ts`, `sync2.ts`, and `sync2Contract.ts`; the full captured comparison is `infra/hetzner/.generated/production-api-vs-branch.diff`. The current branch startup migrator executes both `schema.sql` and `sync2.sql`, and `schema.sql` contains publication/grant operations. It must not be pointed at production unchanged and called “additive only.”

## Migration and replication risk

Adding the four columns can be transactional and additive, but it still takes locks. The current startup migration also performs broader schema/publication/grant work, so it is not a safe zero-downtime operation by inspection. PowerSync may be reading the same database while the API is restarted; changing tables or publication membership without a tested slot/replay procedure can cause lag, errors, or a slot that retains unexpected WAL. A database dump does not preserve an active replication slot, and restoring only `pos` does not restore `powersync_storage`, cluster roles, or slot state.

## Readiness gates

Do not proceed until all are true:

1. A candidate image has been built from this branch with a narrowly scoped additive migration path; the broad startup migrator is disabled or proven harmless.
2. The candidate passes a full-fidelity isolated restore (roles/ACLs, both databases, publication, and PowerSync bootstrap) and rollback rehearsal.
3. Staging runs on separate database, volume, network, and loopback ports; the two-desktop proof passes through an SSH tunnel.
4. Operations, rollback, and a maintenance window are approved by a human.


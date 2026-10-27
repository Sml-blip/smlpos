# Sync2 seed runbook

**Planning only. Every mutating command is DO NOT RUN YET.** Use staging first and synthetic data unless a production window is explicitly approved.

## Real seed flow

1. Verify image, database URL, flags, and device identity.
2. Create exactly one `uploading` seed in `sync2_seeds`.
3. Upload deterministic batches to `sync2_seed_rows` and verify payload hashes.
4. Finalize and verify the manifest, then activate using its `snapshot_seq` boundary.
5. Join a fresh device and verify row counts and millime totals.

The unique index `sync2_one_seed` enforces the one-seed limit. Never create a concurrent second seed.

## Failed-seed reset rehearsal

In isolated staging only, record counts and the seed ID, stop seed clients, and transactionally remove only that failed seed's rows from `sync2_seed_rows`, `sync2_batches`, and `sync2_seeds` after verifying it is not `active`. Re-run the seed and verify no orphan rows, duplicate seed, or changed production/PowerSync state. Test the exact SQL against staging before any approved window; never truncate `sync2_*` in production.

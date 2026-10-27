# Production migration plan (planning only)

**DO NOT RUN YET.** No production command is authorized by this document.

## Preconditions

- Staging proof passes using the same immutable image digest proposed for production.
- Full-fidelity restore rehearsal succeeds, including roles/ACLs, `pos`, `powersync_storage`, publication, and PowerSync recovery.
- Human-approved maintenance window, rollback owner, and monitoring owner.
- Current production API, v1 API, Caddy, database, slot, volumes, flags, and container IDs captured.

## Backup and window

```bash
# DO NOT RUN YET
pg_dump -Fc --no-owner --no-acl -h 127.0.0.1 -U <backup_user> -d pos -f /home/deploy/pos-pre-sync-<timestamp>.dump
sha256sum /home/deploy/pos-pre-sync-<timestamp>.dump
```

Copy the dump to the operator PC over the pinned SSH key and verify the same SHA-256 locally. This dump does not include the logical slot or all cluster/PowerSync state; retain a separate cluster/PowerSync recovery procedure.

Estimated downtime: **not yet established**. Assume a maintenance window until a full rehearsal proves otherwise; API restart and schema locks may be brief, but PowerSync catch-up and rollback are not.

## Migration order

1. Quiesce application writers and record slot/WAL metrics.
2. Take and checksum the backup.
3. Stop the API only if required by the tested procedure; do not alter Caddy or the slot.
4. Run only the four additive `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements under a transaction.
5. Promote the exact staging-tested image digest, with flags still false.
6. Restart only the API container; verify health, schema, flags, slot activity, WAL lag, and error rate.

## Slot/WAL handling

Do not drop, recreate, advance, or modify the PowerSync slot as part of this migration. Monitor `pg_replication_slots`, retained WAL, replay/flush positions, and PowerSync logs. Abort before WAL exhaustion or unexplained slot lag. Any slot recovery action requires a separate reviewed runbook and approval.

## Rollback

Rollback to the retained old image tag and restart only the API. Additive columns remain; do not drop them in an emergency rollback. Restore the database only after a tested full-fidelity procedure proves safe with PowerSync quiesced; a plain `pg_restore --clean` into the live system is forbidden.

## Abort conditions

Unexpected schema/publication/grant SQL, slot errors or WAL growth, production container restart, health/latency regression, any non-zero data count change outside the approved test, or inability to prove the exact image digest.


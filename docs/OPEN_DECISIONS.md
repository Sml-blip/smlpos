# Open decisions requiring human approval

- Approve the maintenance window and acceptable downtime.
- Approve the exact tested image digest for promotion.
- Approve the full-fidelity PowerSync/slot recovery procedure.
- Choose synthetic-only staging data or an approved restored copy.
- Approve two physical Windows test machines and the 3-active-device limit.
- Approve temporary port-forward-only SSH access for those machines.
- Approve rollback owner, abort thresholds, and WAL-growth threshold.
- Decide whether to retire PowerSync after sync2 is proven. Pros: fewer replication/WAL/slot failure modes and simpler operations. Cons: migration effort, client cutover risk, and loss of the existing realtime path. Retirement requires a separate reviewed runbook for dual-read/dual-write transition, backfill, client rollout, slot retirement, and rollback.

## Safest physical staging access proposal

Prefer a temporary SSH account/key restricted server-side to `permitopen="127.0.0.1:23001"`, no shell, no agent forwarding, and no PTY. Use it only for `ssh -N -L 23001:127.0.0.1:23001`; remove the key/account immediately after testing. **DO NOT RUN YET:** no SSH configuration or key changes without explicit approval. A plain-HTTP exception limited to loopback on a special test build is a fallback, not the preferred option.


# Step 3 — ordered, idempotent live upload

`OutboxDrainer.once()` selects up to 200 pending operations in sequence order, converts money with the seed classification, excludes counters from UPSERTs, validates ACK coverage, and persists sent/rejected results atomically. Failures retain the batch and persist circuit-breaker backoff. It never deletes audit rows. `SeedService.drainLiveChanges()` exposes this behind the verified seed gate; no polling/UI integration is enabled yet.

22 synthetic tests pass. Four drainer cases cover gate enforcement, A→B→A, counter units, five lost-ACK/database-restart points, persisted backoff, rejection isolation across pages, and malformed ACK recovery. The earlier paused-seed scenario now sends its 20 sales, three returns, adjustment and deletion through the HTTP client to the in-process mock rather than direct projection. These are simulated crash points, not operating-system process-kill tests.

The normal DB connection restores recursive triggers so existing REPLACE imports still capture implicit deletes after restart. No existing IPC handlers or document numbering changed. The only protocol addition is documented `/v1/sync/push`; required production-backend work is listed in `SEED_CONTRACT.md`. Tests make no external network calls and do not access a real POS database.

Next: Step 4 pull/bootstrap and atomic application. This is not a release-ready update.

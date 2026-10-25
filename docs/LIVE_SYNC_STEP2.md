# Step 2 — snapshot ordering and seed gate

`backupAndCheck` first verifies a protection copy, installs capture, and then takes the seed snapshot. It records the outbox sequence boundary from inside that consistent copy, not from a later live query. This prevents changes already included in opening balances from being applied twice as DELTAs.

The gate is closed during preparation, upload, pause and failed verification. Only an affirmative finalize response with no differences and no local rejects commits the verified digest, finalization time and enabled gate together. The covered outbox prefix is marked acknowledged by the verified snapshot and retained for audit. Post-snapshot rows remain pending in sequence order. A restart after the gate commits recovers the completed state without making a network call.

Tests: 18 pass with synthetic SQLite files and the in-process mock. The added scenario pauses after two tables, makes 20 sales, three returns, a stock adjustment and a draft deletion, resumes, and verifies retained operations. A direct mock projection checks final counts, millime totals and stock, including duplicate delivery and a pre-snapshot delta. This is not an HTTP drainer test; that is Step 3. Snapshot verification now permits live counts to decrease after a legitimate source deletion.

No new endpoint, handler change, live-server call, real database access or release publication. The outbox reader is gated, but the network drainer and pull remain to be implemented.

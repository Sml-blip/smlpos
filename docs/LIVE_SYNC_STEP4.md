# Step 4 — bootstrap and ordered pull

`PullClient` pins bootstrap pages to one server snapshot, persists table cursors, and resumes after failures. Normal pull applies each page and its server cursor in one SQLite transaction, with capture muted. Each change has a SAVEPOINT; invalid/UNIQUE/FK rows enter `pull_rejects` while other changes continue. Money returns to local dinars, counter deltas apply once, and device clocks are ignored. A dormant 15-second polling loop is available; UI/backend switching is Step 5.

29 synthetic tests pass, including no echo, cursor-failure rollback and database restart, one bad row among 500, FK isolation, a deleted row, an interrupted 600-row bootstrap, a write arriving during bootstrap, and two offline PCs converging to opening minus five. These simulate failures and reopen SQLite; they are not operating-system kill tests.

Important contract clarification: own DELTAs are skipped because they already changed the local counter. Identical own UPSERTs are skipped. However, if an earlier remote event overwrote an unsent edit, the later winning own UPSERT must be reapplied; blindly skipping it prevents convergence. Own DELETEs remain idempotent. A regression test proves this ordering case without echoing changes.

Bootstrap refuses existing business data or local writes during joining. A rejected bootstrap row stays visible and keeps uploads disabled; subsequent pull may continue. Automatic bundled-catalog import is suppressed once seed/join preparation is recorded, preventing a restart from creating unwanted products. No silent reset or merge is performed.

Production prerequisites remain in `SEED_CONTRACT.md`: real frozen bootstrap snapshots and a durable change log. No external network, real POS database, release publication or numbering changes occurred.

# Step 1 — transactional capture

`installOutbox(db)` adds local `outbox` and `sync_state` tables and generates triggers from the same table selection and setting filters as seed export. It does not run on installation or call a server. Step 2 must call it after a verified migration backup and before the seed snapshot.

- Every source write and captured operation commit or roll back together.
- Counters are omitted from UPSERT payloads and recorded as separate DELTA operations, including initial values and existing INSERT OR REPLACE imports. Live operation identity is the future `(device_id, seq)`, never a content hash.
- `apply_mute=1` suppresses capture; the drainer remains disabled.
- Existing IPC handlers, IDs, document numbering and business columns are unchanged.
- Internal sync tables and private settings are excluded from seed and live capture.

Validation: 16 synthetic tests pass with the matching Electron/SQLite runtime. These include all synced tables, the actual `ventes:create` callback and its money helpers extracted directly from unchanged source, stock/serial/loyalty capture, replacement, clamping, rollback, mute, private settings and the existing seed suite. The source callback runs with synthetic SQLite and no-op legacy notification helpers; this does not test the Electron IPC transport.

Run `npm run test:seed`. If the installed native SQLite binary targets Electron, set `SMLPOS_SEED_TEST_RUNTIME` to that matching Electron executable. The runner isolates AppData and uses no network. Full-project typechecking still reports existing errors in `main/index.ts`; Step 1 introduces no errors under `main/seed`.

Next: Step 2 snapshot ordering and seed gate, then the drainer and pull. Server behavior for REPLACE's DELETE/UPSERT sequence must be exercised in Step 3. No release was published.

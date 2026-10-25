# SMLPOS seed / device-sync contract — v1

This is what the desktop client (`src/main/seed/`) speaks. The backend must implement it as written, or the
contract version must be bumped on both sides. The client refuses to upload if `contract_version` differs.

All bodies are JSON. All endpoints except `register` and `refresh` need `Authorization: Bearer <access_token>`.
Errors: `{ "code": "<machine_code>", "message": "<human text>" }` with a proper HTTP status.
The client retries only network errors, `429` and `5xx` (4 attempts, exponential backoff). `4xx` is final.

## Money (the rule that matters most)

The app stores money as REAL dinars with 3 decimals. **On the wire, every money column is an integer number of
millimes** (`12.345 TND` → `12345`). The client declares the columns per batch in `money_columns`; the server
must reject (`400 money_not_integer`) any non-integer value in those columns. Rates/percentages
(`tva_taux`, `remise_pct`, `marge_pct`, `coef_av`, `tva_achat_pct`, `tva_taux_principal`) stay plain decimals.
The client's money column list is `src/main/seed/tables.ts → MONEY_COLUMNS`.

## Device lifecycle

### `POST /v1/devices/register` (no auth)
```json
{ "enrollment_token": "…", "install_id": "uuid", "name": "PC Caisse 1",
  "platform": "win32", "app_version": "1.9.1039", "schema_version": "1.10.10" }
```
→ `200 { "device_id": "…", "number_code": "PC1", "session": { "access_token", "refresh_token", "expires_at" } }`
`403 bad_token` for an invalid/used token.
`number_code` is assigned once by the server and is used only for newly created document numbers. Existing numbers
are preserved. Enrollment and refresh endpoints are the only unauthenticated device endpoints.

### `POST /v1/auth/refresh` (no auth)
`{ "refresh_token": "…" }` → a new `session`. **Refresh tokens rotate**: the old one is invalid after use.
`401/403` means the device was revoked; the client forgets the session and asks to register again.

### `GET /v1/status`
```json
{ "server_time": "ISO", "contract_version": 1,
  "schema_version": "1.10.10", "min_client_version": "1.9.1039", "server_seq": 0,
  "devices": [ { "device_id", "number_code", "name", "platform", "role", "app_version", "last_seen_at": "ISO|null", "online": true } ],
  "seed": { "state": "empty|seeding|seeded", "install_id": "uuid|null" } }
```
Any authenticated call should update the calling device's `last_seen_at`. The panel polls this every ~4 s.

## Seed (first PC uploads its existing data)

### `GET /v1/seed/preflight`
```json
{ "contract_version": 1, "state": "empty|seeding|seeded", "install_id": "uuid|null",
  "tables": { "produits": { "columns": ["id","reference", "…"], "pk": "id" }, "…": {} },
  "max_batch_rows": 500, "max_batch_bytes": 900000 }
```
`tables` is the server's audited contract. The client compares **every local column of every seeded table**
against it **before** any upload: an unknown table or column is a blocker. Tell the client about every column you
accept; do not make it guess.

### `POST /v1/seed/begin`
`{ "install_id", "report_digest", "expected": { "<table>": { "rows": n, "money_sums_millimes": { "<col>": n }, "digest": "…" } } }`
→ `{ "seed_id": "…" }`. Must be idempotent on `report_digest` (header `Idempotency-Key: begin:<digest>`).
The server must refuse (`409`) if `state != empty` and `install_id` differs from the stored one — one backend never
mixes two installations' data. Retries by the same `install_id` and `report_digest` resume the same unfinished seed.
After successful finalization the seed is immutable: another seed pass is refused, and later changes must use the
live outbox. This prevents an old snapshot from overwriting edits already applied through live sync.

### `POST /v1/seed/batches`   (header `Idempotency-Key: <batch_id>`)
```json
{ "seed_id", "batch_id", "table": "produits", "money_columns": ["prix_vente","…"],
  "rows": [ { "op_id": "sha256-hex", "row": { "id": "…", "prix_vente": 13345, "…": null } } ] }
```
Rows arrive in dependency order (parents before children, see `TABLE_PRIORITY`); the client does not wait for FK
validation per batch — **seed mode must defer FK checks until `finalize`**. Real data contains orphans
(e.g. sale lines whose product was deleted); do not reject those for orphan-ness alone.

→ `200 { "accepted": n, "duplicates": n, "rejected": [ { "op_id", "pk", "code", "message" } ] }`

* `op_id = sha256(install_id | table | pk | row_hash)`. **The server dedupes by `op_id`** and counts a repeat as
  `duplicates`, never as an error. The client re-sends an unacknowledged batch after any crash or timeout.
* A row edited locally between passes has a new `row_hash`, hence a new `op_id`; the server applies it as an update
  of the same `pk` (seed-origin rows only).
* `rejected` rows are stored client-side, shown in the panel, and retried on the next run. A whole-batch failure is a
  non-2xx. Three consecutive batches with every row rejected stop the run.

### `POST /v1/seed/finalize`
`{ "seed_id", "expected": { …same shape as begin… } }` → `{ "ok": bool, "diffs": [ { "table", "field", "expected", "actual" } ] }`
The server recomputes, per table, **row count** and **sum of each money column in millimes** and returns every
mismatch. Only `ok: true` with zero locally rejected rows ends in the `done` state; otherwise the panel shows
`needs_review` with the diffs. After `ok: true` the server flips `seed.state` to `seeded`.

## What the client never sends

* Tables: `sync_queue`, `saved_paniers` (local-only technical state).
* `app_settings` keys that are local to a machine (`r2_*`, `backup_folder_path`, `supabase_keepalive_*`,
  `schema_version`, …) and **any key matching** `secret|token|password|pin|api_key|access_key|private`.
* BLOB values (they block the seed rather than being uploaded).

## Row identity

Primary key is `id` for every table except `app_settings` (`key`). Existing ids are TEXT and are **not all UUIDs**
(`op-hamdi`, `cat-01`, `svc-enda`, plus UUIDs): accept any non-empty string up to 128 chars. Do not rewrite ids.

## Preflight checks before a business seed

1. The production schema contract is checked against every table and column on the seed PC before upload. A mismatch
   blocks the seed. The server contract is generated from the current synthetic schema; the main PC's real database
   has not been inspected or uploaded.
2. `documents` keeps its void and credit-note state (`revoque_*`, `avoir_id`, `document_origine_id`, `annule_motif`)
   and line items keep `numero_serie`; the v1 schema explicitly accepts these fields.
3. New REAL columns must be classified in `tables.ts` as money or rate, then the audited server schema must be
   regenerated. The dry run blocks unknown columns rather than guessing.

## Live push — Step 3

`POST /v1/sync/push`, authenticated, header `Idempotency-Key: <device_id>:<firstSeq>-<lastSeq>`:

```json
{"device_id":"dev-1","ops":[{"seq":1201,"table":"ventes","pk":"sale-id","op":"UPSERT","row":{"id":"sale-id","total_ttc":12345},"at":"ISO"},{"seq":1202,"table":"produits","pk":"product-id","op":"DELTA","field":"stock_actuel","value":-1,"at":"ISO"}]}
```

Response: `{"results":[{"seq":1201,"status":"applied"},{"seq":1202,"status":"duplicate"}],"server_seq":9731}`. Rejections use `status: "rejected"` with `code` and `message`. Return exactly one result for every submitted sequence. DELETE includes `seq`, `table`, `pk`, `op: "DELETE"` and `at`, without a row.

- One transaction per request. Process operations in increasing local sequence; allocate server sequences only on applied changes. Device timestamps are audit data, never ordering keys.
- Durable identity is `(authenticated device_id, seq)`. Repeats of applied operations return duplicate; a changed payload under the same identity is a conflict. A repeated rejected operation remains rejected, never a duplicate ACK. Reject body/token device mismatches.
- UPSERT preserves existing counters and must not include any counter field from `COUNTER_COLUMNS`. DELTA carries integer stock units or integer millimes and appends to the server ledger. Unknown tables/fields are per-op rejections, without blocking valid later operations.
- Refuse live writes before seed finalization. Registration must preserve an installation's device identity; the client refuses to relabel captured operations after an identity change.
- Client marks sent only after a complete, validated reply, in one local transaction. Rejects stay unsent with `rejected:` errors and are excluded from automatic retry pages. Network/HTTP failures retain operations and use persisted backoff. No outbox pruning is implemented; audit rows remain on disk.

The production v1 API implements this contract with durable `(device_id, seq)` receipts and an append-only server
change log. It validates audited columns, integer millimes, device-number prefixes and finalized financial values;
per-operation conflicts are reported without dropping later operations. SQLite REPLACE is handled as ordered delete
and upsert events, with counter values preserved. Automated contract coverage runs against an isolated synthetic
PostgreSQL schema.

## Bootstrap and pull — Step 4

- `GET /v1/sync/bootstrap?table=<name>&after=<pk>&limit=500[&as_of_seq=<anchor>]` returns `{rows, as_of_seq, has_more}`. The first response pins an immutable snapshot. Every later page/table must use the same anchor and return the same frozen state. Sort primary keys by binary UTF-8 order, exclusive of `after`. Refuse unfinished seeds. Expired anchors return `409 bootstrap_expired`; never silently substitute current data.
- `GET /v1/sync/pull?since=<server_seq>&limit=500` returns `{changes:[{server_seq,origin_device,table,pk,op,row?,field?,value?}],next_seq,has_more}`. Changes are strictly increasing, greater than `since`; `next_seq` equals the last change, or remains `since` for an empty page. Live UPSERTs exclude counters. DELTA values use integer stock units or millimes; bootstrap rows include full opening counters.
- The server must commit data, `(device_id,seq)` deduplication and its change log atomically. Allocate ordered server sequences consistently with commit visibility. Duplicates/rejections create no change events. Enforce device authentication and business isolation. Keep snapshot anchors valid across the complete join; use a new sequence epoch for reseeding rather than reusing an anchor for different state.
- Client applies changes/cursor atomically with capture muted, quarantines failed rows, and keeps later rows moving. Own DELTAs and redundant own UPSERTs are skipped; a different own UPSERT or own DELETE is applied in server order to restore convergence after an intervening remote write. The `as_of_seq` request parameter and this own-origin clarification are explicit additions to the earlier outline, not hidden assumptions.

The production API implements durable, per-device frozen bootstrap snapshots (7-day expiry), binary primary-key
pagination and an ordered PostgreSQL change log. Clients poll every 15 seconds; the optional SSE nudge endpoint is
not implemented yet. Bootstrap accepts only an explicitly prepared empty replica and never wipes existing business
history. Finalized invoices, sales and payments are immutable; correct them with an existing credit-note or reversal
workflow so the audit remains append-only.

Daily cash rows use `caisse:YYYY-MM-DD` for new entries. When a device syncs that date while the server already has
a legacy row, the server aliases the new key to the historical row, keeps its opening balance and applies only the
counter deltas. Historical IDs and document numbers are never rewritten.

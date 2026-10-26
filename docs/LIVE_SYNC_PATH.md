# SMLPOS — The missing path: capture → upload → pull

Scope: what happens **after** the first seed. Sales keep happening on the main PC during the seed, they must reach the server exactly once, and PC 2 must receive them. The seed branch (`feat/seed-main-pc`) has the first half (snapshot upload). It has **nothing** for the three steps below.

## 1. What the code does today (read from the repo)

| Step | Today | Verdict |
|---|---|---|
| Capture live changes | `enqueueSync(...)` called by hand inside IPC handlers → `sync_queue` (built for Supabase). ~88 call sites vs ~165 write statements in `main/index.ts`. Inside `ventes:create` I found `enqueueSync` only for `ventes`, `lignes_vente`, `clients`. I did **not** see one for `produits.stock_actuel`, `serial_numbers` (marked VENDU) or `mouvements_fidelite`. Verify, don't trust me. | Unreliable. Anything a handler forgets is never synced. |
| Capture errors | `enqueueSync` ends in `catch { /* never crash a write */ }` | A failed enqueue silently loses the change. |
| Capture collapse | `enqueueSync` deletes older pending rows for the same record, keeps only the last | OK for state, **wrong for counters** (two stock decrements become one). |
| Seed delta | `acked_rows(table,pk,row_hash)`; a second seed pass re-sends rows whose hash changed; `op_id = sha256(install_id\|table\|pk\|row_hash)` | Good for a snapshot. **Not usable for live ops** (see §3.1). Deleted rows are not seen at all. |
| Upload live | No `/sync/push` in `docs/SEED_CONTRACT.md`, no client code | Missing |
| Pull | Only the old Supabase pull (`syncPull.applyRemoteRows`). No VPS pull, no cursor | Missing |
| Pull apply | `INSERT … ON CONFLICT(id)` in one transaction per table | Any other UNIQUE hit (see §6) throws and **rolls back the whole page**. |

## 2. Design in one picture

```
 any write to smlpos.db ──(SQLite trigger, same transaction)──► outbox(seq, table, pk, op, row/delta)
                                                                   │  drainer (after seed finalize only)
                                                                   ▼
                                         POST /v1/sync/push  (device_id + seq = idempotency)
                                                                   ▼
                                                     server: applies, assigns server_seq
                                                                   ▼
 PC2 ◄── GET /v1/sync/pull?since=server_seq ◄── changes log (ordered, paged)
   apply page + cursor in ONE transaction, triggers muted, skip own origin
```

## 3. Capture: SQLite triggers, not handler calls

### 3.1 Why triggers
A trigger runs inside the same transaction as the write, so a sale and its outbox rows commit or roll back together, and no handler can forget. It also covers the 165 write sites without touching them.

### 3.2 Order of operations (this is what makes "no gap" true)
1. Create `outbox` + triggers. Outbox **records** but the drainer stays **off**.
2. Only then take the snapshot (`VACUUM INTO`). Anything sold after step 1 is in the outbox, even if the snapshot also contains it.
3. Seed uploads the snapshot.
4. `seed/finalize` OK → drainer turns on → drains the outbox oldest first.
Overlap between snapshot and outbox is harmless because every op carries the **full row state** and the server applies ops in `seq` order, so the final state is the latest.

### 3.3 Schema (additive)
```
outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT, table_name, pk, op CHECK(op IN ('UPSERT','DELETE','DELTA')),
       row_json TEXT, delta_field TEXT, delta_value REAL, at TEXT, sent_at TEXT, attempts INT DEFAULT 0, last_error TEXT)
sync_state(k PRIMARY KEY, v)      -- device_id, install_id, pull_cursor, seed_finalized_at, apply_mute (0/1)
```
- Trigger per synced table: `AFTER INSERT/UPDATE/DELETE … WHEN (SELECT v FROM sync_state WHERE k='apply_mute')='0'`.
- INSERT/UPDATE → `UPSERT` with `json_object(...)` of the NEW row. DELETE → `DELETE` with pk only (tombstone). No hard delete is ever lost.
- Use the same table list and column filter as the seed (`tables.ts`), so the seed and live path can't drift. Add a **test that fails if a table in `tables.ts` has no trigger.**

### 3.4 Counters become deltas (this is the stock/credit fix, without touching handlers)
A trigger on `produits` `AFTER UPDATE OF stock_actuel WHEN NEW.stock_actuel <> OLD.stock_actuel` writes `op='DELTA', delta_field='stock_actuel', delta_value=NEW-OLD`. Same for `clients.solde_credit`, `clients.solde_fidelite`, `fournisseurs.solde_du`, `caisse_interne.total_entrees/total_sorties`.
- The `UPSERT` row for `produits` **must not carry `stock_actuel`** (and the other counters) once live sync is on, otherwise a price edit on PC1 overwrites PC2's stock with PC1's old number.
- Server stores deltas in an append-only ledger; `stock_actuel = opening_balance + SUM(deltas)`. The seed row's `stock_actuel` becomes the opening balance for that product.
- `MAX(0, …)` clamps in the handlers are fine: the trigger records the delta that actually happened.

## 4. Upload: idempotent push

### 4.1 Do not reuse the seed's op_id for live ops
The seed's `op_id` includes `row_hash`. With edits **A → B → A** the third op has the same hash as the first, the server says "duplicate" and ignores it → server stays at B while the device is at A. Live ops use **`(device_id, seq)`** as identity. Never content hashes.

### 4.2 Contract (add to `docs/SEED_CONTRACT.md`)
```
POST /v1/sync/push        header Idempotency-Key: <device_id>:<firstSeq>-<lastSeq>
{ "device_id", "ops":[ {"seq":1201,"table":"ventes","pk":"…","op":"UPSERT","row":{…},"at":"…"},
                       {"seq":1202,"table":"produits","pk":"…","op":"DELTA","field":"stock_actuel","value":-1} ] }
→ 200 { "results":[ {"seq":1201,"status":"applied"|"duplicate"|"rejected","code":"…","message":"…"} ], "server_seq": 9731 }
```
Server rules: one DB transaction per request; store `(device_id, seq)` unique; a repeat returns `duplicate` with the original result; ops applied in `seq` order; money in integer millimes (same conversion as the seed); reject (not crash) on unknown table/field; refuse live pushes from any device until the seed device has finalized (except the seed device itself).

### 4.3 Client drainer rules
- Select `sent_at IS NULL ORDER BY seq LIMIT 200`. Mark `sent_at` **only** for `applied` or `duplicate` results, **after** the response arrived.
- `rejected` ops go to the rejected list (visible in the panel). They **do not block** later ops. Transient errors (network/5xx/429): retry with backoff, circuit breaker, keep order.
- Crash anywhere = resend the same batch; the server dedupes. This must be proven by test, not argued.
- Never delete outbox rows for 30 days after sent (audit + rebuild).

## 5. Pull: PC 2 receives the changes

### 5.1 Contract
```
GET /v1/sync/bootstrap?table=…&after=<pk>&limit=500   → full current state page-by-page, plus as_of_seq (same for all tables)
GET /v1/sync/pull?since=<server_seq>&limit=500
→ { "changes":[ {"server_seq":9732,"origin_device":"…","table":"ventes","pk":"…","op":"UPSERT","row":{…}},
                {"server_seq":9733,"origin_device":"…","table":"produits","pk":"…","op":"DELTA","field":"stock_actuel","value":-1} ],
    "next_seq":9733, "has_more":false }
SSE /v1/sync/events  → "changed" nudge (client then calls pull). Polling every 15 s is the fallback.
```
`server_seq` is a single monotonic counter on the server. **Never use device clocks or `updated_at` for ordering.**

### 5.2 Joining PC 2
1. Install triggers, `apply_mute=1`.
2. Bootstrap tables in FK order (`TABLE_PRIORITY`), then store `pull_cursor = as_of_seq`.
3. `apply_mute=0`, start normal pull from the cursor.

### 5.3 Applying a page (the part that must not break)
- One SQLite transaction per page: apply all changes **and** `UPDATE sync_state SET pull_cursor=next_seq` in that same transaction. A crash then replays or skips nothing.
- Set `apply_mute=1` for the duration so triggers do **not** write these changes into this device's outbox (otherwise PC2 echoes everything back forever).
- Skip changes whose `origin_device` is this device (we already have them).
- `DELTA` ops add to the counter; they are safe to apply exactly once because the cursor is atomic with the apply.
- Per-change `SAVEPOINT`: a UNIQUE/FK failure on one change goes to a local `pull_rejects` table and the page continues. One bad row must never block the pipeline.
- Local unsent edits to the same row: don't skip the remote change (the old Supabase rule). Apply it; the local op arrives at the server later and its later `server_seq` wins, then comes back on pull. Everything converges.

## 6. UNIQUE collisions that will bite as soon as PC 2 sells

These are `UNIQUE` in `db.ts` and are generated per device today:
- `ventes.numero`, `factures_clients.numero`, `reparations.numero`, `documents.numero` (via `getLastNumber(prefix)`): two PCs both create the next number → different ids, same `numero` → pull fails. **Fix before PC 2 sells:** new numbers get a device code (`PC2-000123`); history is untouched.
- `caisse_interne.date_journal UNIQUE`: each PC creates today's row with its own id. Needs a deterministic id (`caisse:<YYYY-MM-DD>`) for new rows, and a server rule that merges same-date rows.
- `produits.code_barre` / `reference` UNIQUE, `operateurs.identifiant` UNIQUE, `categories.nom` UNIQUE: two PCs creating the same product/user offline. Server returns a `rejected` code `unique_conflict`; the panel shows it; do not auto-merge money or products silently.

## 7. Tests that prove this path (all against a mock server + synthetic DBs)

1. **Sales during seed:** start seed, pause after 2 tables, make 20 sales + 3 returns + 1 stock adjustment + 1 deleted draft, resume, finalize, drain. Server row counts, `SUM(total_ttc)` in millimes and per-product stock equal the device.
2. **No duplicates on crash:** kill the client after the server applied a batch but before the ack, restart → resend → all `duplicate`, counts unchanged. Repeat with kills at 5 random points.
3. **A→B→A:** edit a product price 10→12→10 offline; server ends at 10.
4. **Trigger coverage:** every table in `tables.ts` has insert/update/delete triggers; a generic test mutates each table and finds the outbox row. Run `ventes:create` through the real handler and assert outbox contains ventes, lignes_vente, stock DELTA, serial_numbers (when serial), client balance DELTA.
5. **Rollback safety:** a failing sale transaction leaves zero outbox rows.
6. **No echo:** PC 2 pulls 50 changes; PC 2's outbox is empty.
7. **Atomic cursor:** crash PC 2 in the middle of a page → restart → no missing and no doubly applied DELTA.
8. **Two PCs, same product offline:** PC1 sells 2, PC2 sells 3 → both converge to opening − 5.
9. **Bad row isolation:** one change violating UNIQUE lands in `pull_rejects`; the other 499 apply.
10. **Numbering:** PC 2 creates sale numbers with its prefix; pull on PC 1 never hits a UNIQUE error.
11. **Delete:** deleting a draft on PC 1 removes it on PC 2.
12. **Seed gate:** with the seed unfinished, the drainer sends nothing; after finalize it drains in `seq` order.

---

# PROMPT FOR CODEX (paste after the GUARDRAILS block)

```
Task: implement the live-sync path described in docs/LIVE_SYNC_PATH.md on branch feat/seed-main-pc.
Read docs/LIVE_SYNC_PATH.md, docs/SEED_CONTRACT.md and src/main/seed/* fully first, then list what
you read. Work in this order and stop after each step with the final report format:

STEP 1  Outbox + triggers + sync_state (section 3). Reuse the table list/column filter from
        src/main/seed/tables.ts. Include the DELTA triggers (3.4) and the apply_mute guard.
        Do not edit existing IPC handlers. Tests: sections 7.4, 7.5.
STEP 2  Seed ordering (3.2): triggers installed BEFORE the snapshot is taken; drainer disabled
        until finalize. Tests: 7.1 (with the mock backend), 7.12.
STEP 3  Drainer + /sync/push client (4.x) and mock backend support. Tests: 7.2, 7.3.
        Add the push endpoint to docs/SEED_CONTRACT.md; do not invent any other endpoint.
STEP 4  Pull client: bootstrap, pull loop, atomic page apply, apply_mute, origin skip, SAVEPOINT
        per change, pull_rejects (5.x). Tests: 7.6, 7.7, 7.8, 7.9, 7.11.
STEP 5  Panel: show outbox pending, rejected ops, pull_rejects, cursor/lag, last pull time.
STEP 6  Numbering and caisse_interne uniqueness (section 6) for NEW rows only. Tests: 7.10.
        Ask me before touching how numero is generated; show the current getLastNumber code first.

Rules specific to this task:
- Live ops are identified by (device_id, seq). Never by content hash.
- produits.stock_actuel and the other counters travel as DELTA ops, never in UPSERT rows.
- Everything is verified against the mock backend and synthetic SQLite files. No real server, no
  real database, no network calls to anything except the mock on localhost.
- If a test needs a server behaviour that is not in the contract, add it to the mock AND list it as
  an open point for the backend owner; do not hide it.
- Keep each step a separate commit. If a step needs more than ~500 changed lines, stop and split it.
```
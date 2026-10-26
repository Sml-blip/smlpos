# SMLSITE ↔ SMLPOS integration (Phase 1)

This folder is **documentation and SQL for the website team only**.  
It does **not** change SMLPOS runtime code or sync behaviour.

## Architecture

```
SMLPOS (Electron)
  → local SQLite
  → sync_queue
  → Supabase upsert (produits, categories, …)
        ↓ read-only (service role on server)
SMLSITE backend (Vercel / Inngest)
  → Turso shop DB
  → enrich (images, Gemini, SEO) — website only
```

**POS owns:** `id`, `reference`, `nom`, `categorie`, `prix_vente` (TTC), `stock_actuel`, `actif`, `updated_at`, optional `description`  
**Site owns:** slug, SEO, long copy, images, marketing — never write back to Supabase in Phase 1.

---

## 1. Credentials (get from shop owner / Supabase Dashboard)

| Variable | Where | Notes |
|----------|--------|--------|
| `SUPABASE_URL` | Dashboard → Settings → API → Project URL | Same project SMLPOS uses (`VITE_SUPABASE_URL` at POS build) |
| `SUPABASE_SERVICE_ROLE_KEY` | Dashboard → Settings → API → `service_role` | **Backend only** (Vercel env, Inngest). Never `NEXT_PUBLIC_*` |

Optional: invite website dev to the Supabase project with read access instead of sharing the service role.

**Do not commit real keys.** Use `env.example` in this folder.

---

## 2. Verify POS data is in the cloud

Run in **Supabase SQL Editor** (see `queries.sql`):

```sql
SELECT count(*) AS active_products FROM produits WHERE actif = 1;
-- Expect ~1300 for a full catalog; if low, open SMLPOS online and wait ~1 min
-- or use Paramètres → Synchroniser maintenant
```

```sql
SELECT count(*) AS total_products FROM produits;
SELECT max(updated_at) AS latest_change FROM produits;
```

---

## 3. Tables to read (Phase 1)

| Table | Purpose |
|-------|---------|
| `produits` | Catalog: name, category, TTC price, stock, visibility |
| `categories` | Optional canonical list (`id`, `nom`, `icone`) |

**Primary category field on products:** `produits.categorie` (text, e.g. `PC PORTABLE`).  
`categorie_id` is often empty; prefer text for shop mapping.

---

## 4. Product filters (website)

```sql
SELECT
  id,           -- use as pos_id / external id in Turso
  reference,    -- backup stable id
  code_barre,
  nom,
  categorie,
  prix_vente,   -- TTC (customer price in DT)
  prix_vente_ht,
  tva_taux,
  stock_actuel,
  description,  -- optional; if null, generate with Gemini
  type,         -- 'F' = sellable; 'NF' = exclude from shop
  actif,
  updated_at
FROM produits
WHERE actif = 1
  AND type = 'F'
  AND updated_at > :last_sync_iso
ORDER BY updated_at ASC
LIMIT 500;
```

- **`prix_vente` = TTC** (what the customer pays). HT is in `prix_vente_ht`.
- **`actif = 0`** → hide on website (POS soft-delete).
- **No `web_published` column** — use `actif = 1` only.

---

## 5. Incremental sync (recommended)

1. Store `last_sync_at` in Turso (or Inngest state).
2. Poll every 15–30 minutes with `updated_at > last_sync_at`.
3. Upsert into Turso by `pos_id = produits.id`.
4. Advance `last_sync_at` to max `updated_at` seen.

POS pushes changes within ~**5 seconds** when the desktop app is running and online.

---

## 6. Category mapping (one-time)

Export distinct POS categories:

```sql
SELECT categorie, count(*) AS n
FROM produits
WHERE actif = 1 AND type = 'F'
GROUP BY categorie
ORDER BY n DESC;
```

Map `categorie` → SMLSITE shop categories (e.g. `PC PORTABLE` → `pc-portable`).

---

## 7. Security (recommended for production)

Default SMLPOS migration uses permissive RLS (`allow_all`). For production shop:

- Run `rls-readonly-smlsite.sql` in Supabase **only if** you create a dedicated DB role, **or**
- Keep using **service role on server only** (simplest; never expose in browser).

**Phase 1 rule:** SMLSITE must **not** INSERT/UPDATE/DELETE on `produits` or `categories`.

---

## 8. Files in this folder

| File | Purpose |
|------|---------|
| `env.example` | Vercel / Inngest env template |
| `queries.sql` | Verification + export SQL |
| `rls-readonly-smlsite.sql` | Optional hardening (run in Supabase manually) |
| `product.types.ts` | TypeScript shape for synced rows |
| `sync-from-supabase.example.ts` | Reference fetch (copy into SMLSITE repo) |

---

## 9. POS sync behaviour (reference)

- Queue: local `sync_queue` → Supabase upsert
- Auto: every **5s** push while app open; pull ~every **15s**
- Manual: SMLPOS → Paramètres → **Synchroniser maintenant**
- Retries: up to 10 attempts per row; failed count in Settings

No POS code changes required for Phase 1 website launch.

---

## 10. Checklist for SMLSITE team

- [ ] `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in Vercel (server)
- [ ] `SELECT count(*) FROM produits WHERE actif = 1` ≈ expected catalog size
- [ ] Category mapping from `queries.sql` export
- [ ] Inngest cron: sync query above → Turso
- [ ] Shop UI reads Turso only; enrich pipeline separate
- [ ] Never expose service role in frontend

---

## Contact / handoff

POS builder confirms row count and shares Supabase access securely (1Password, etc.).  
Website questions about field meaning: see `product.types.ts` and Section 4 above.


# Email / WhatsApp to send (copy-paste)

---

**Subject:** SMLSITE Phase 1 — Supabase catalog access

Hi,

SMLPOS already syncs products to Supabase. SMLSITE can start building — no new POS features needed for Phase 1.

**Please provide securely (1Password / private channel, not email attachment):**

1. Supabase **Project URL**
2. Supabase **service role key** (backend only — never in browser)
   - Or invite us to the Supabase project with read on `produits` + `categories`

**Please confirm in Supabase SQL Editor:**

```sql
SELECT count(*) FROM produits WHERE actif = 1 AND type = 'F';
```

We expect ~1300 active sellable products. If the count is low, leave SMLPOS open online for a few minutes and use **Paramètres → Synchroniser maintenant**.

**Category export for mapping:**

```sql
SELECT categorie, count(*) FROM produits
WHERE actif = 1 AND type = 'F'
GROUP BY categorie ORDER BY 2 DESC;
```

**Integration docs** (in SMLPOS repo): `integrations/smlsite/README.md`

**Key facts:**
- `prix_vente` = **TTC** (customer price)
- Hide products when `actif = 0`; sellable type = `'F'`
- Website reads only; no write-back to Supabase in Phase 1
- Images / AI / SEO stay on SMLSITE side

Thanks


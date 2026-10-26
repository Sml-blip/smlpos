-- SMLSITE handoff — run in Supabase SQL Editor
-- Read-only checks; safe to run anytime

-- ── 1. Health check ─────────────────────────────────────────────────────────
SELECT count(*) AS active_sellable
FROM produits
WHERE actif = 1 AND type = 'F';

SELECT count(*) AS active_all_types
FROM produits
WHERE actif = 1;

SELECT count(*) AS total_rows FROM produits;

SELECT max(updated_at) AS latest_product_change FROM produits;

SELECT count(*) AS category_rows FROM categories;

-- ── 2. Category export (for shop mapping) ───────────────────────────────────
SELECT
  categorie,
  count(*) AS product_count
FROM produits
WHERE actif = 1 AND type = 'F'
GROUP BY categorie
ORDER BY product_count DESC, categorie;

-- ── 3. Categories table (canonical names) ───────────────────────────────────
SELECT id, nom, icone FROM categories ORDER BY nom;

-- ── 4. Incremental sync page (replace timestamp) ────────────────────────────
-- First run: use '1970-01-01T00:00:00Z' or omit WHERE for full export once
SELECT
  id,
  reference,
  code_barre,
  nom,
  categorie,
  categorie_id,
  type,
  prix_vente,
  prix_vente_ht,
  tva_taux,
  stock_actuel,
  description,
  actif,
  updated_at,
  created_at
FROM produits
WHERE actif = 1
  AND type = 'F'
  AND updated_at > '2026-01-01T00:00:00.000Z'
ORDER BY updated_at ASC
LIMIT 500;

-- ── 5. Sample products for enrich testing (5 names) ─────────────────────────
SELECT id, nom, categorie, prix_vente, stock_actuel
FROM produits
WHERE actif = 1 AND type = 'F'
ORDER BY updated_at DESC
LIMIT 5;

-- ── 6. Stale / zero stock (optional shop rules) ───────────────────────────
SELECT count(*) AS out_of_stock
FROM produits
WHERE actif = 1 AND type = 'F' AND coalesce(stock_actuel, 0) <= 0;

-- ── 7. Duplicate references (should be empty) ───────────────────────────────
SELECT reference, count(*) AS n
FROM produits
GROUP BY reference
HAVING count(*) > 1;


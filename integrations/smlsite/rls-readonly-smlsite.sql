-- OPTIONAL — run manually in Supabase SQL Editor for production hardening
-- Does NOT affect SMLPOS (POS uses anon key + allow_all today)
--
-- Prefer: service role on SMLSITE backend only, no RLS change.
-- Use this only if you want a dedicated read-only role instead of service role.

-- Example: create read-only role for a future restricted key (advanced)
-- 1. Create role in Supabase Dashboard or:
-- CREATE ROLE smlsite_reader NOLOGIN;

-- 2. Grant SELECT on catalog tables only:
-- GRANT USAGE ON SCHEMA public TO smlsite_reader;
-- GRANT SELECT ON TABLE produits TO smlsite_reader;
-- GRANT SELECT ON TABLE categories TO smlsite_reader;

-- 3. Create policy for authenticated read (if using anon + JWT instead of service role):
-- DROP POLICY IF EXISTS smlsite_read_produits ON produits;
-- CREATE POLICY smlsite_read_produits ON produits
--   FOR SELECT USING (actif = 1 AND type = 'F');

-- DROP POLICY IF EXISTS smlsite_read_categories ON categories;
-- CREATE POLICY smlsite_read_categories ON categories
--   FOR SELECT USING (true);

-- WARNING: Do not revoke POS write access. SMLPOS upserts require existing allow_all
-- or equivalent INSERT/UPDATE on produits. Coordinate with POS admin before tightening RLS.


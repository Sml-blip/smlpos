-- One-off additive migration. Execute as the owner role (pos_api).
-- This file intentionally contains no schema.sql, publication, grant, or PowerSync statements.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.sync2_changes ADD COLUMN IF NOT EXISTS operation text NOT NULL DEFAULT 'UPSERT';
ALTER TABLE public.sync2_changes ADD COLUMN IF NOT EXISTS delta_field text;
ALTER TABLE public.sync2_changes ADD COLUMN IF NOT EXISTS delta_value bigint;
ALTER TABLE public.sync2_seeds ADD COLUMN IF NOT EXISTS snapshot_seq bigint;
COMMIT;

CREATE TABLE IF NOT EXISTS sync_schema_versions(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS app_users(
 id uuid PRIMARY KEY, username text UNIQUE NOT NULL, password_hash text NOT NULL,
 role text NOT NULL CHECK(role IN ('admin','manager','cashier')), active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS devices(
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES app_users(id), name text NOT NULL,
 platform text NOT NULL CHECK(platform IN ('windows','android','development')),
 client_version text NOT NULL, importer boolean NOT NULL DEFAULT false,
 revoked_at timestamptz, last_seen_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS single_importer ON devices(importer) WHERE importer AND revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS refresh_sessions(
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES app_users(id), device_id uuid NOT NULL REFERENCES devices(id),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS upload_transactions(
 device_id uuid NOT NULL REFERENCES devices(id), transaction_id uuid NOT NULL,
 payload_hash text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(device_id,transaction_id)
);
CREATE TABLE IF NOT EXISTS sync_rejections(
 id uuid PRIMARY KEY, device_id uuid NOT NULL REFERENCES devices(id), transaction_id uuid,
 code text NOT NULL, message text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS seed_jobs(
 id uuid PRIMARY KEY, device_id uuid NOT NULL REFERENCES devices(id), manifest_hash text NOT NULL,
 status text NOT NULL CHECK(status IN ('approved','uploading','verified','cancelled')),
 approved_by uuid NOT NULL REFERENCES app_users(id), expected_counts jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), verified_at timestamptz
);
ALTER TABLE seed_jobs ADD COLUMN IF NOT EXISTS manifest jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS single_seed_job ON seed_jobs((true)) WHERE status <> 'cancelled';
CREATE TABLE IF NOT EXISTS seed_chunks(
 job_id uuid NOT NULL REFERENCES seed_jobs(id), chunk_index integer NOT NULL CHECK(chunk_index>=0),
 payload_hash text NOT NULL, row_count integer NOT NULL CHECK(row_count>0),
 received_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(job_id,chunk_index)
);
CREATE TABLE IF NOT EXISTS seed_rows(
 job_id uuid NOT NULL REFERENCES seed_jobs(id), table_name text NOT NULL, row_id uuid NOT NULL,
 chunk_index integer NOT NULL, data jsonb NOT NULL,
 source_created_at timestamptz, source_updated_at timestamptz,
 PRIMARY KEY(job_id,table_name,row_id),
 FOREIGN KEY(job_id,chunk_index) REFERENCES seed_chunks(job_id,chunk_index)
);
CREATE OR REPLACE FUNCTION immutable_business_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Business history is immutable; insert a reversal' USING ERRCODE='23000';
END $$;


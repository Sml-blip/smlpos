CREATE SEQUENCE IF NOT EXISTS sync2_seq;
CREATE TABLE IF NOT EXISTS sync2_seeds(id uuid PRIMARY KEY,device_id uuid NOT NULL REFERENCES devices(id),manifest jsonb NOT NULL,manifest_hash text NOT NULL,status text NOT NULL CHECK(status IN ('uploading','verified','active')),created_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS sync2_one_seed ON sync2_seeds((true));
CREATE TABLE IF NOT EXISTS sync2_batches(seed_id uuid REFERENCES sync2_seeds(id),batch_id text,payload_hash text NOT NULL,PRIMARY KEY(seed_id,batch_id));
CREATE TABLE IF NOT EXISTS sync2_seed_rows(seed_id uuid REFERENCES sync2_seeds(id),table_name text,row_id text,payload jsonb NOT NULL,PRIMARY KEY(seed_id,table_name,row_id));
CREATE TABLE IF NOT EXISTS sync2_records(table_name text,row_id text,payload jsonb NOT NULL,version bigint NOT NULL,deleted boolean NOT NULL DEFAULT false,PRIMARY KEY(table_name,row_id));
CREATE TABLE IF NOT EXISTS sync2_changes(seq bigint PRIMARY KEY,table_name text NOT NULL,row_id text NOT NULL,payload jsonb NOT NULL,deleted boolean NOT NULL,operation text NOT NULL DEFAULT 'UPSERT',delta_field text,delta_value bigint);
ALTER TABLE sync2_changes ADD COLUMN IF NOT EXISTS operation text NOT NULL DEFAULT 'UPSERT';
ALTER TABLE sync2_changes ADD COLUMN IF NOT EXISTS delta_field text;
ALTER TABLE sync2_changes ADD COLUMN IF NOT EXISTS delta_value bigint;
CREATE TABLE IF NOT EXISTS sync2_operations(op_id text PRIMARY KEY,device_id uuid NOT NULL REFERENCES devices(id),payload_hash text NOT NULL,result jsonb NOT NULL);


ALTER TABLE sync2_seeds ADD COLUMN IF NOT EXISTS snapshot_seq bigint;

import { readFile } from 'node:fs/promises'
import { createPool } from './db.ts'

// This command is exclusively for a new, disposable Compose staging database.
const url = new URL(process.env.DATABASE_URL ?? '')
if (process.env.STAGING_ONLY !== 'true' || process.env.SKIP_STARTUP_MIGRATION !== 'true' ||
    url.protocol !== 'postgresql:' || url.hostname !== 'postgres' || url.port !== '5432' ||
    url.username !== 'pos_api' || url.pathname !== '/smlpos_staging' || url.search || url.hash) {
  throw new Error('Refusing non-staging bootstrap target')
}
const schema = await readFile(new URL('../schema/schema.sql', import.meta.url), 'utf8')
const base = schema.split('\n').filter(line =>
  !line.startsWith('DO $$ BEGIN IF current_schema()=\'public\' AND EXISTS(SELECT 1 FROM pg_publication') &&
  !/^GRANT SELECT ON .* TO powersync_role;\s*$/.test(line)).join('\n')
if (/\b(?:PUBLICATION|GRANT|powersync)\b/i.test(base)) throw new Error('Unexpected publication or grant in staging base schema')
let sync = await readFile(new URL('../schema/sync2.sql', import.meta.url), 'utf8')
const columns = ",operation text NOT NULL DEFAULT 'UPSERT',delta_field text,delta_value bigint"
if (!sync.includes(columns)) throw new Error('Unexpected sync2 baseline')
sync = sync.replace(columns, '').split('\n').filter(line => !/^ALTER TABLE sync2_(changes|seeds) ADD COLUMN IF NOT EXISTS (operation|delta_field|delta_value|snapshot_seq)\b/.test(line)).join('\n')
if (/\b(?:PUBLICATION|GRANT|powersync|snapshot_seq|delta_field|delta_value)\b/i.test(sync)) throw new Error('Unexpected SQL in staging sync baseline')
const migration = await readFile(new URL('../migrations/20261027_sync2_additive.sql', import.meta.url), 'utf8')
const pool = createPool(url.toString())
try {
  const client = await pool.connect()
  try {
    const check = await client.query(`SELECT current_database() AS db, current_user AS owner,
      (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','S','v','m')) AS objects,
      (SELECT count(*) FROM pg_publication) AS publications,
      (SELECT count(*) FROM pg_replication_slots) AS slots`)
    const c = check.rows[0]
    if (c.db !== 'smlpos_staging' || c.owner !== 'pos_api' || Number(c.objects) || Number(c.publications) || Number(c.slots)) throw new Error('Staging database is not empty')
    await client.query('BEGIN')
    try { await client.query(base); await client.query(sync); await client.query('COMMIT') }
    catch (error) { await client.query('ROLLBACK'); throw error }
    console.log('Fresh staging baseline created as pos_api; no publication/grant SQL applied.')
    await client.query(migration)
    console.log('Explicit four-column additive migration completed as pos_api.')
  } finally { client.release() }
} finally { await pool.end() }

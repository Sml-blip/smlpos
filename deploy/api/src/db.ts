import pg from 'pg'
import { readFile } from 'node:fs/promises'
export const createPool = (url: string) => new pg.Pool({ connectionString: url, max: 8, connectionTimeoutMillis: 5000, statement_timeout: 15000 })
export type Pool = pg.Pool
export async function migrate(pool: Pool) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(7311042)")
    await client.query(await readFile(new URL('../schema/schema.sql', import.meta.url),'utf8'))
    await client.query(await readFile(new URL('../schema/sync2.sql', import.meta.url),'utf8'))
    await client.query('COMMIT')
  } catch(error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}


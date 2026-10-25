import Database from 'better-sqlite3'
import { createHash } from 'crypto'
import { createReadStream, existsSync, mkdirSync, statSync } from 'fs'
import { join } from 'path'

export interface BackupVerification {
  ok: boolean
  path: string
  bytes: number
  sha256: string
  integrity: string[]
  tables: Record<string, { backup: number; live: number | null }>
  problems: string[]
}

export function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(path)
      .on('data', c => h.update(c))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')))
  })
}

export function listUserTables(db: Database.Database): string[] {
  return (db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
  ).all() as { name: string }[]).map(r => r.name)
}

function countRows(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get() as { c: number }).c
}

/**
 * Verify a backup file WITHOUT touching it: read-only open, full integrity check,
 * same table set as the live DB, row counts side by side (live may be slightly ahead
 * because the app keeps selling — that is reported, not treated as an error).
 */
export async function verifyBackupFile(path: string, live: Database.Database | null): Promise<BackupVerification> {
  const problems: string[] = []
  const result: BackupVerification = {
    ok: false, path, bytes: 0, sha256: '', integrity: [], tables: {}, problems,
  }
  if (!existsSync(path)) {
    problems.push('backup_file_missing')
    return result
  }
  result.bytes = statSync(path).size
  if (result.bytes === 0) problems.push('backup_file_empty')
  result.sha256 = await hashFile(path)

  let bdb: Database.Database | null = null
  try {
    bdb = new Database(path, { readonly: true, fileMustExist: true })
    const integrity = (bdb.pragma('integrity_check') as { integrity_check: string }[]).map(r => r.integrity_check)
    result.integrity = integrity
    if (!(integrity.length === 1 && integrity[0] === 'ok')) problems.push('integrity_check_failed')

    const backupTables = listUserTables(bdb)
    const liveTables = live ? listUserTables(live) : null
    for (const t of backupTables) {
      result.tables[t] = { backup: countRows(bdb, t), live: liveTables?.includes(t) ? countRows(live!, t) : null }
    }
    if (liveTables) {
      for (const t of liveTables) if (!backupTables.includes(t)) problems.push(`table_missing_in_backup:${t}`)
      for (const t of backupTables) {
        const row = result.tables[t]
        // A backup can never contain MORE rows than the live DB it was taken from.
        if (row.live != null && row.backup > row.live) problems.push(`backup_ahead_of_live:${t}`)
      }
    }
  } catch (e) {
    problems.push(`backup_open_failed:${String(e).slice(0, 200)}`)
  } finally {
    try { bdb?.close() } catch { /* ignore */ }
  }
  result.ok = problems.length === 0
  return result
}

/**
 * Take a consistent copy of the LIVE database using SQLite's online backup API (safe while the
 * app is running), switch the copy to rollback-journal mode so it is a single self-contained
 * file, then verify it. The live database is only read.
 */
export async function createVerifiedBackup(
  live: Database.Database,
  destDir: string,
  now: Date = new Date(),
): Promise<BackupVerification> {
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })
  const ts = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23)
  // Never overwrite or reuse an existing backup, even when two are taken within the same millisecond.
  let dest = join(destDir, `smlpos_pre_seed_${ts}.db`)
  for (let i = 2; existsSync(dest); i++) dest = join(destDir, `smlpos_pre_seed_${ts}_${i}.db`)

  await live.backup(dest)

  const copy = new Database(dest)
  try {
    copy.pragma('journal_mode = DELETE')
  } finally {
    copy.close()
  }
  return verifyBackupFile(dest, live)
}

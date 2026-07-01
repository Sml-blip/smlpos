import { app, session } from 'electron'
import { existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import { closeDatabase, getDb } from './db'
import {
  applyPendingWipeBeforeDbOpen,
  deleteAllLocalDataFiles,
  getResetDiagnostics,
  requestWipeFlags,
} from './userDataWipe'

export { applyPendingWipeBeforeDbOpen, getResetDiagnostics } from './userDataWipe'

function readExternalBackupFolder(): string | null {
  try {
    const row = getDb().prepare(`SELECT value FROM app_settings WHERE key = 'backup_folder_path'`).get() as { value?: string } | undefined
    const folder = row?.value?.trim()
    return folder || null
  } catch {
    return null
  }
}

function wipeExternalLatestBackup(folder: string | null): void {
  if (!folder) return
  for (const name of ['smlpos_latest.db', 'smlpos_latest.db-wal', 'smlpos_latest.db-shm']) {
    const p = join(folder, name)
    if (!existsSync(p)) continue
    try { unlinkSync(p) } catch { /* ignore */ }
  }
}

/** Empty every table while the DB handle is still open (fallback if file delete fails). */
function purgeDatabaseContents(): void {
  try {
    const db = getDb()
    const tables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    `).all() as { name: string }[]

    db.pragma('foreign_keys = OFF')
    db.transaction(() => {
      for (const { name } of tables) {
        db.prepare(`DELETE FROM "${name}"`).run()
      }
    })()
    db.pragma('foreign_keys = ON')
    db.exec('VACUUM')
    console.log('[factoryReset] Database tables purged in-memory')
  } catch (e) {
    console.warn('[factoryReset] In-memory DB purge failed:', e)
  }
}

/** Close DB, delete files, relaunch. If delete fails, flag ensures wipe before DB opens next launch. */
export async function wipeAllUserData(): Promise<{ ok: boolean; error?: string; deferred?: boolean }> {
  const externalBackupFolder = readExternalBackupFolder()
  requestWipeFlags()
  purgeDatabaseContents()
  wipeExternalLatestBackup(externalBackupFolder)

  try {
    await session.defaultSession.clearStorageData()
  } catch (e) {
    console.warn('[factoryReset] clearStorageData failed:', e)
  }

  try {
    getDb().pragma('wal_checkpoint(TRUNCATE)')
  } catch { /* ignore */ }
  closeDatabase()

  const result = deleteAllLocalDataFiles()
  if (!result.ok) {
    console.warn('[factoryReset] Files still locked — wipe will run on next launch:', result.errors.join('; '))
    return { ok: true, deferred: true }
  }

  console.log('[factoryReset] User data wiped:', getResetDiagnostics())
  return { ok: true }
}

export function relaunchFresh(): void {
  app.relaunch()
  app.exit(0)
}

import { app } from 'electron'
import { existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import { closeDatabase, getDb } from './db'
import {
  applyPendingWipeBeforeDbOpen,
  deleteAllLocalDataFiles,
  getResetDiagnostics,
  requestWipeFlags,
} from './userDataWipe'

export { applyPendingWipeBeforeDbOpen, getResetDiagnostics, requestWipeFlags } from './userDataWipe'

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

/** Fast in-memory purge — no VACUUM (that can freeze the UI for minutes). */
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
    db.pragma('wal_checkpoint(TRUNCATE)')
    console.log('[factoryReset] Database tables purged in-memory')
  } catch (e) {
    console.warn('[factoryReset] In-memory DB purge failed:', e)
  }
}

/**
 * Factory reset must finish quickly and always relaunch.
 * Do NOT call session.clearStorageData() here — it often hangs while the renderer is alive.
 * Renderer storage dirs are deleted in deleteAllLocalDataFiles / pending wipe on next boot.
 */
export async function wipeAllUserData(): Promise<{ ok: boolean; error?: string; deferred?: boolean }> {
  const externalBackupFolder = readExternalBackupFolder()
  requestWipeFlags()
  purgeDatabaseContents()
  wipeExternalLatestBackup(externalBackupFolder)

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
  app.relaunch({ args: process.argv.slice(1).concat(['--smlpos-factory-reset']) })
  app.exit(0)
}

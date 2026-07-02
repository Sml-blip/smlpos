import { app } from 'electron'
import { closeDatabase, getDb } from './db'
import { createProtectedBackup } from './backupService'
import {
  applyPendingWipeBeforeDbOpen,
  deleteAllLocalDataFiles,
  getResetDiagnostics,
  markFactoryResetState,
} from './userDataWipe'

export { applyPendingWipeBeforeDbOpen, getResetDiagnostics } from './userDataWipe'

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
 * Factory reset: archive first, purge tables in place, clear UI cache only.
 * Never deletes backup files or the immutable archive folder.
 */
export async function wipeAllUserData(): Promise<{ ok: boolean; error?: string; deferred?: boolean }> {
  createProtectedBackup('pre_reset')
  purgeDatabaseContents()
  markFactoryResetState(app.getVersion())

  try {
    getDb().pragma('wal_checkpoint(TRUNCATE)')
  } catch { /* ignore */ }

  const result = deleteAllLocalDataFiles()
  closeDatabase()

  console.log('[factoryReset] Reset complete — archive preserved:', getResetDiagnostics())
  return { ok: true, deferred: !result.ok }
}

export function relaunchFresh(): void {
  app.relaunch()
  app.exit(0)
}

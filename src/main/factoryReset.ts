import { app, session } from 'electron'
import { db } from './db'
import {
  applyPendingWipeBeforeDbOpen,
  deleteAllLocalDataFiles,
  getUserDataDir,
  requestWipeFlags,
} from './userDataWipe'

export { applyPendingWipeBeforeDbOpen } from './userDataWipe'

/** Empty every table while the DB handle is still open (fallback if file delete fails). */
function purgeDatabaseContents(): void {
  try {
    const tables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    `).all() as { name: string }[]

    db.transaction(() => {
      db.pragma('foreign_keys = OFF')
      for (const { name } of tables) {
        db.prepare(`DELETE FROM "${name}"`).run()
      }
      db.pragma('foreign_keys = ON')
    })()
    db.pragma('wal_checkpoint(TRUNCATE)')
    console.log('[factoryReset] Database tables purged in-memory')
  } catch (e) {
    console.warn('[factoryReset] In-memory DB purge failed:', e)
  }
}

/** Close DB, delete files, relaunch. If delete fails, flag ensures wipe before DB opens next launch. */
export async function wipeAllUserData(): Promise<{ ok: boolean; error?: string; deferred?: boolean }> {
  requestWipeFlags()
  purgeDatabaseContents()

  try {
    await session.defaultSession.clearStorageData()
  } catch (e) {
    console.warn('[factoryReset] clearStorageData failed:', e)
  }

  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
  } catch { /* ignore */ }
  try {
    db.close()
  } catch { /* ignore */ }

  const result = deleteAllLocalDataFiles(getUserDataDir())
  if (!result.ok) {
    console.warn('[factoryReset] Files still locked — wipe will run on next launch:', result.errors.join('; '))
    return { ok: true, deferred: true }
  }

  console.log('[factoryReset] User data wiped:', getUserDataDir())
  return { ok: true }
}

export function relaunchFresh(): void {
  app.relaunch()
  app.exit(0)
}

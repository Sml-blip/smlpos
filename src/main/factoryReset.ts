import { app } from 'electron'
import { db } from './db'
import {
  applyPendingWipeBeforeDbOpen,
  deleteAllLocalDataFiles,
  getUserDataDir,
  requestWipeFlags,
} from './userDataWipe'

export { applyPendingWipeBeforeDbOpen } from './userDataWipe'

/** Close DB, delete files, relaunch. If delete fails, flag ensures wipe before DB opens next launch. */
export function wipeAllUserData(): { ok: boolean; error?: string; deferred?: boolean } {
  requestWipeFlags()

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

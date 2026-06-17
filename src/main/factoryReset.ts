import { app } from 'electron'
import { existsSync, unlinkSync, rmSync } from 'fs'
import { join } from 'path'
import { db, dbFilePath } from './db'

/** Delete SQLite DB, WAL files, and local backups — next launch is first-run state. */
export function wipeAllUserData(): void {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
  } catch { /* ignore */ }
  try {
    db.close()
  } catch { /* ignore */ }

  for (const suffix of ['', '-wal', '-shm']) {
    const p = suffix ? `${dbFilePath}${suffix}` : dbFilePath
    if (existsSync(p)) {
      try { unlinkSync(p) } catch { /* ignore */ }
    }
  }

  const backupDir = join(app.getPath('userData'), 'backups')
  if (existsSync(backupDir)) {
    try { rmSync(backupDir, { recursive: true, force: true }) } catch { /* ignore */ }
  }

  console.log('[factoryReset] User data wiped:', app.getPath('userData'))
}

export function relaunchFresh(): void {
  app.relaunch()
  app.exit(0)
}

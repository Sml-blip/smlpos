import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { getCanonicalBackupDir, getCanonicalDbPath } from './dataPaths'
import { getDb, dbFilePath } from './db'

const MAX_LOCAL_BACKUPS = 20

export function getBackupDir(): string {
  if (app.isPackaged) return getCanonicalBackupDir()
  const dir = join(app.getPath('userData'), 'backups')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function resolveLiveDbPath(): string {
  try {
    return dbFilePath || getCanonicalDbPath()
  } catch {
    return getCanonicalDbPath()
  }
}

export function createLocalBackup(): { path: string; filename: string } | null {
  try {
    const liveDb = resolveLiveDbPath()
    if (!existsSync(liveDb)) return null

    const backupDir = getBackupDir()
    const ts = new Date().toISOString().replace(/:/g, '-').replace('T', '_').slice(0, 19)
    const filename = `smlpos_${ts}.db`
    const backupPath = join(backupDir, filename)

    try {
      getDb().pragma('wal_checkpoint(FULL)')
    } catch {
      // DB may not be open yet — file copy still captures committed pages
    }
    copyFileSync(liveDb, backupPath)

    const files = readdirSync(backupDir)
      .filter(f => f.startsWith('smlpos_') && f.endsWith('.db'))
      .map(f => ({ name: f, time: statSync(join(backupDir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time)
    files.slice(MAX_LOCAL_BACKUPS).forEach(({ name }) => {
      try { unlinkSync(join(backupDir, name)) } catch { /* ignore */ }
    })

    return { path: backupPath, filename }
  } catch (e) {
    console.warn('[backup] Local backup failed:', e)
    return null
  }
}

/** Called before auto-update install — never skip even if DB handle is busy. */
export function createEmergencyBackup(): { path: string; filename: string } | null {
  try {
    const liveDb = resolveLiveDbPath()
    if (!existsSync(liveDb)) return null
    const backupDir = getBackupDir()
    const ts = new Date().toISOString().replace(/:/g, '-').replace('T', '_').slice(0, 19)
    const filename = `smlpos_pre_update_${ts}.db`
    const backupPath = join(backupDir, filename)
    copyFileSync(liveDb, backupPath)
    console.log('[backup] Pre-update emergency backup:', filename)
    return { path: backupPath, filename }
  } catch (e) {
    console.warn('[backup] Pre-update backup failed:', e)
    return null
  }
}

export function copyToExternalFolder(localPath: string, externalFolder?: string | null): boolean {
  try {
    let extFolder = externalFolder?.trim()
    if (!extFolder) {
      try {
        const row = getDb().prepare(`SELECT value FROM app_settings WHERE key='backup_folder_path'`).get() as { value?: string } | undefined
        extFolder = row?.value?.trim()
      } catch {
        return false
      }
    }
    if (!extFolder || !existsSync(extFolder)) return false
    const filename = localPath.split(/[\\/]/).pop()!
    copyFileSync(localPath, join(extFolder, filename))
    copyFileSync(localPath, join(extFolder, 'smlpos_latest.db'))
    return true
  } catch (e) {
    console.warn('[backup] External copy failed:', e)
    return false
  }
}

import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { getArchiveDir, getCanonicalBackupDir, getCanonicalDbPath } from './dataPaths'
import { getDb, dbFilePath } from './db'

const MAX_LOCAL_BACKUPS = 30
const MAX_ARCHIVE_SCHEDULED = 80

export type BackupReason =
  | 'scheduled'
  | 'startup'
  | 'pre_migration'
  | 'pre_update'
  | 'pre_reset'
  | 'quit'
  | 'legacy_wipe'
  | 'auto_recover'

/** Critical backups are never auto-deleted from the archive. */
const PROTECTED_ARCHIVE_PREFIXES = [
  'smlpos_pre_reset_',
  'smlpos_pre_update_',
  'smlpos_pre_migration_',
  'smlpos_quit_',
  'smlpos_legacy_wipe_',
  'smlpos_auto_recover_',
]

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

function timestampSlug(): string {
  return new Date().toISOString().replace(/:/g, '-').replace('T', '_').slice(0, 19)
}

function checkpointIfPossible(): void {
  try {
    getDb().pragma('wal_checkpoint(FULL)')
  } catch {
    // DB may not be open — file copy still captures committed pages
  }
}

function pruneRotatingBackups(dir: string, maxFiles: number, protectedPrefixes: string[]): void {
  if (!existsSync(dir)) return
  try {
    const files = readdirSync(dir)
      .filter(f => f.startsWith('smlpos_') && f.endsWith('.db'))
      .filter(f => !protectedPrefixes.some(p => f.startsWith(p)))
      .map(f => ({ name: f, time: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time)
    files.slice(maxFiles).forEach(({ name }) => {
      try { unlinkSync(join(dir, name)) } catch { /* ignore */ }
    })
  } catch { /* ignore */ }
}

/**
 * Copy live DB to archive + local backups (+ external if configured).
 * Archive copies are the last line of defence — never deleted by factory reset.
 */
export function createProtectedBackup(reason: BackupReason): {
  path: string
  filename: string
  archivePath: string
} | null {
  try {
    const liveDb = resolveLiveDbPath()
    if (!existsSync(liveDb)) return null

    checkpointIfPossible()

    const ts = timestampSlug()
    const filename = `smlpos_${reason}_${ts}.db`
    const archivePath = join(getArchiveDir(), filename)
    const localPath = join(getBackupDir(), filename)

    copyFileSync(liveDb, archivePath)
    copyFileSync(liveDb, localPath)

    copyToExternalFolder(archivePath)

    pruneRotatingBackups(getBackupDir(), MAX_LOCAL_BACKUPS, PROTECTED_ARCHIVE_PREFIXES)
    pruneRotatingBackups(getArchiveDir(), MAX_ARCHIVE_SCHEDULED, PROTECTED_ARCHIVE_PREFIXES)

    console.log(`[backup] Protected backup (${reason}): ${filename}`)
    return { path: localPath, filename, archivePath }
  } catch (e) {
    console.warn(`[backup] Protected backup failed (${reason}):`, e)
    return null
  }
}

/** Raw file copy when DB handle is unavailable (boot / legacy wipe flag). */
export function archiveLiveDbFileCopy(reason: BackupReason): string | null {
  try {
    const liveDb = resolveLiveDbPath()
    if (!existsSync(liveDb)) return null
    const filename = `smlpos_${reason}_${timestampSlug()}.db`
    const archivePath = join(getArchiveDir(), filename)
    copyFileSync(liveDb, archivePath)
    console.log(`[backup] Archive copy (${reason}): ${filename}`)
    return archivePath
  } catch (e) {
    console.warn(`[backup] Archive copy failed (${reason}):`, e)
    return null
  }
}

export function createLocalBackup(): { path: string; filename: string } | null {
  const r = createProtectedBackup('scheduled')
  return r ? { path: r.path, filename: r.filename } : null
}

export function createEmergencyBackup(): { path: string; filename: string } | null {
  const r = createProtectedBackup('pre_update')
  return r ? { path: r.path, filename: r.filename } : null
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

/** All directories scanned for recovery (archive first). */
export function getProtectedBackupScanDirs(): string[] {
  return [getArchiveDir(), getBackupDir()]
}

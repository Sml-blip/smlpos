import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { countProductsInDbFile } from './dbProbe'

/** Single canonical folder — must never change between releases. */
export const CANONICAL_APP_FOLDER = 'SMLPOS'

/**
 * Immutable archive — lives OUTSIDE userData so factory reset / wipe / updates never touch it.
 * %APPDATA%\SMLPOS-Archive\
 */
export const ARCHIVE_FOLDER = 'SMLPOS-Archive'

export function getArchiveDir(): string {
  const dir = join(getRoamingRoot(), ARCHIVE_FOLDER)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function getRoamingRoot(): string {
  return process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
}

export function getLocalAppDataRoot(): string {
  return process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
}

export function getCanonicalUserDataPath(): string {
  return join(getRoamingRoot(), CANONICAL_APP_FOLDER)
}

/** Call before app.ready so every install/update uses the same userData path. */
export function bootstrapCanonicalUserDataPath(): void {
  const canonical = getCanonicalUserDataPath()
  if (!existsSync(canonical)) mkdirSync(canonical, { recursive: true })
  app.setPath('userData', canonical)
}

/** Every AppData folder that may hold data from older builds or case variants. */
export function getLegacyUserDataDirs(): string[] {
  const roaming = getRoamingRoot()
  const local = getLocalAppDataRoot()
  const raw = [
    getCanonicalUserDataPath(),
    app.getPath('userData'),
    join(roaming, 'SMLPOS'),
    join(roaming, 'smlpos'),
    join(local, 'SMLPOS'),
    join(local, 'smlpos'),
    join(roaming, 'com.smlpos.desktop'),
    join(roaming, 'smlpos-desktop'),
  ]
  const seen = new Set<string>()
  const unique: string[] = []
  for (const dir of raw) {
    const key = dir.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(dir)
  }
  return unique
}

export function getCanonicalBackupDir(): string {
  const dir = join(getCanonicalUserDataPath(), 'backups')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function getCanonicalDbPath(): string {
  return join(getCanonicalUserDataPath(), 'smlpos.db')
}

/** Copy any DB file into the immutable archive (no DB handle required). */
export function archiveDbFileCopy(sourcePath: string, reason: string): string | null {
  if (!existsSync(sourcePath)) return null
  try {
    const ts = new Date().toISOString().replace(/:/g, '-').replace('T', '_').slice(0, 19)
    const filename = `smlpos_${reason}_${ts}.db`
    const archivePath = join(getArchiveDir(), filename)
    copyFileSync(sourcePath, archivePath)
    console.log(`[archive] Saved ${filename}`)
    return archivePath
  } catch (e) {
    console.warn(`[archive] Copy failed (${reason}):`, e)
    return null
  }
}

export function collectBackupDbPaths(): string[] {
  const paths: string[] = []
  const scanDirs = [getArchiveDir(), getCanonicalBackupDir()]
  for (const dir of getLegacyUserDataDirs()) {
    scanDirs.push(join(dir, 'backups'))
  }
  for (const dir of scanDirs) {
    if (!existsSync(dir)) continue
    try {
      for (const f of readdirSync(dir)) {
        if (f.startsWith('smlpos_') && f.endsWith('.db')) paths.push(join(dir, f))
      }
    } catch { /* ignore */ }
  }
  return paths
}

/**
 * On every boot (before DB open): pull smlpos.db + backups/ from legacy folders
 * into the canonical path so updates never strand data in an old AppData folder.
 */
export function migrateLegacyDataToCanonical(): {
  dbMerged: boolean
  dbFrom?: string
  backupsMerged: number
} {
  const canonical = getCanonicalUserDataPath()
  const canonicalDb = getCanonicalDbPath()
  const canonicalBackups = getCanonicalBackupDir()
  const archiveDir = getArchiveDir()
  let backupsMerged = 0
  let dbMerged = false
  let dbFrom: string | undefined

  const canonicalCount = countProductsInDbFile(canonicalDb) ?? 0

  const mergeBackupDir = (sourceDir: string) => {
    if (!existsSync(sourceDir)) return
    try {
      for (const f of readdirSync(sourceDir)) {
        if (!f.startsWith('smlpos_') || !f.endsWith('.db')) continue
        const src = join(sourceDir, f)
        const dest = join(canonicalBackups, f)
        try {
          if (!existsSync(dest)) {
            copyFileSync(src, dest)
            backupsMerged++
            continue
          }
          const srcStat = statSync(src)
          const destStat = statSync(dest)
          if (srcStat.size > destStat.size || srcStat.mtimeMs > destStat.mtimeMs) {
            copyFileSync(src, dest)
            backupsMerged++
          }
        } catch (e) {
          console.warn(`[migrate] Could not merge backup ${src}:`, e)
        }
      }
    } catch { /* ignore */ }
  }

  mergeBackupDir(archiveDir)

  for (const dir of getLegacyUserDataDirs()) {
    if (dir.toLowerCase() === canonical.toLowerCase()) continue
    mergeBackupDir(join(dir, 'backups'))

    const legacyDb = join(dir, 'smlpos.db')
    if (!existsSync(legacyDb)) continue
    const legacyCount = countProductsInDbFile(legacyDb) ?? 0
    if (legacyCount <= 0) continue
    if (legacyCount <= canonicalCount) continue

    try {
      copyFileSync(legacyDb, canonicalDb)
      for (const suffix of ['-wal', '-shm']) {
        const leg = `${legacyDb}${suffix}`
        if (existsSync(leg)) {
          try { copyFileSync(leg, `${canonicalDb}${suffix}`) } catch { /* ignore */ }
        }
      }
      dbMerged = true
      dbFrom = legacyDb
      console.log(`[migrate] Promoted DB from ${legacyDb} (${legacyCount} products)`)
    } catch (e) {
      console.warn(`[migrate] Could not copy legacy DB ${legacyDb}:`, e)
    }
  }

  return { dbMerged, dbFrom, backupsMerged }
}

import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync, copyFileSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { countProductsInDbFile } from './dbProbe'
import { getCanonicalDbPath, getCanonicalUserDataPath, getLegacyUserDataDirs, getArchiveDir, archiveDbFileCopy, collectBackupDbPaths } from './dataPaths'

export const WIPE_FLAG = '.wipe-requested'
export const SKIP_SEED_FLAG = '.skip-product-seed'
export const RESET_STATE_FILE = 'reset-state.json'

export interface ResetState {
  skipProductSeed: boolean
  factoryResetAt: string
  appVersion?: string
}

export function getUserDataDir(): string {
  return app.getPath('userData')
}

/** Roaming + Local AppData folders that may hold SMLPOS data (case variants). */
export function getUserDataDirCandidates(): string[] {
  try {
    return getLegacyUserDataDirs()
  } catch {
    const roaming = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
    const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
    return [getUserDataDir(), join(roaming, 'smlpos'), join(roaming, 'SMLPOS'), join(local, 'smlpos'), join(local, 'SMLPOS')]
  }
}

/** SQLite file used by the running app (packaged vs dev). */
export function getActiveDbPath(): string {
  return app.isPackaged
    ? getCanonicalDbPath()
    : join(process.cwd(), 'smlpos-dev.db')
}

/** Every SQLite path we have ever used — wipe all to avoid stale catalogs. */
export function getAllDbCandidatePaths(): string[] {
  const candidates = [
    getActiveDbPath(),
    join(getUserDataDir(), 'smlpos.db'),
    join(getUserDataDir(), 'smlpos-dev.db'),
    join(process.cwd(), 'smlpos-dev.db'),
  ]
  for (const dir of getUserDataDirCandidates()) {
    candidates.push(join(dir, 'smlpos.db'))
    candidates.push(join(dir, 'smlpos-dev.db'))
  }
  const seen = new Set<string>()
  const unique: string[] = []
  for (const candidate of candidates) {
    const key = candidate.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(candidate)
  }
  return unique
}

export function getPackagedDbPath(): string {
  return getCanonicalDbPath()
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function writeFileToAllUserDataDirs(filename: string, contents: string): void {
  for (const dir of getUserDataDirCandidates()) {
    try {
      ensureDir(dir)
      writeFileSync(join(dir, filename), contents, 'utf8')
    } catch (e) {
      console.warn(`[wipe] Could not write ${filename} to ${dir}:`, e)
    }
  }
}

/** Mark factory reset — persists across relaunch and blocks auto-seed permanently. */
export function markFactoryResetState(appVersion?: string): void {
  const state: ResetState = {
    skipProductSeed: true,
    factoryResetAt: new Date().toISOString(),
    appVersion,
  }
  const payload = JSON.stringify(state, null, 2)
  writeFileToAllUserDataDirs(RESET_STATE_FILE, payload)
  writeFileToAllUserDataDirs(SKIP_SEED_FLAG, '1')
  // Never set WIPE_FLAG — deferred wipes caused data loss on update/relaunch.
}

/** @deprecated Do not use — wipe flags caused data loss. Kept for API compat. */
export function requestWipeFlags(): void {
  markFactoryResetState(app.getVersion())
}

function readResetStateFromDir(dir: string): ResetState | null {
  const statePath = join(dir, RESET_STATE_FILE)
  if (!existsSync(statePath)) return null
  try {
    return JSON.parse(readFileSync(statePath, 'utf8')) as ResetState
  } catch {
    return { skipProductSeed: true, factoryResetAt: 'unknown' }
  }
}

/** Count products in a SQLite file without opening the main app connection. */
export { countProductsInDbFile } from './dbProbe'

/** If the active DB is missing/empty, copy the best legacy backup or sibling DB we can find. */
export function recoverLegacyDatabaseIfNeeded(): { recovered: boolean; from?: string; productCount?: number } {
  const activePath = getActiveDbPath()
  const activeCount = countProductsInDbFile(activePath)
  if (activeCount !== null && activeCount > 0) return { recovered: false }

  const scanPaths = new Set<string>()
  for (const p of collectBackupDbPaths()) scanPaths.add(p)
  for (const p of getAllDbCandidatePaths()) scanPaths.add(p)

  let best: { path: string; count: number; mtime: number } | null = null
  for (const candidate of scanPaths) {
    if (candidate.toLowerCase() === activePath.toLowerCase()) continue
    const cnt = countProductsInDbFile(candidate)
    if (cnt === null || cnt <= 0) continue
    let mtime = 0
    try { mtime = statSync(candidate).mtimeMs } catch { /* ignore */ }
    if (!best || cnt > best.count || (cnt === best.count && mtime > best.mtime)) {
      best = { path: candidate, count: cnt, mtime }
    }
  }

  if (!best) return { recovered: false }

  try {
    ensureDir(join(activePath, '..'))
    copyFileSync(best.path, activePath)
    for (const suffix of ['-wal', '-shm']) {
      const leg = `${best.path}${suffix}`
      if (existsSync(leg)) {
        try { copyFileSync(leg, `${activePath}${suffix}`) } catch { /* ignore */ }
      }
    }
    console.log(`[db-recover] Restored ${best.count} products from ${best.path}`)
    return { recovered: true, from: best.path, productCount: best.count }
  } catch (e) {
    console.error('[db-recover] Failed to copy legacy database:', e)
    return { recovered: false }
  }
}

/** Scan disk for recoverable SQLite databases (local backups, legacy paths, external folder). */
export function discoverRecoverableDatabases(externalFolder?: string | null): Array<{
  path: string
  productCount: number
  size: number
  mtime: number
  source: 'active' | 'legacy' | 'backup' | 'external' | 'archive'
}> {
  const results: Array<{
    path: string
    productCount: number
    size: number
    mtime: number
    source: 'active' | 'legacy' | 'backup' | 'external' | 'archive'
  }> = []
  const seen = new Set<string>()

  const add = (dbPath: string, source: 'active' | 'legacy' | 'backup' | 'external' | 'archive') => {
    const key = dbPath.toLowerCase()
    if (seen.has(key) || !existsSync(dbPath)) return
    seen.add(key)
    const productCount = countProductsInDbFile(dbPath)
    if (productCount === null || productCount <= 0) return
    let size = 0
    let mtime = 0
    try {
      const st = statSync(dbPath)
      size = st.size
      mtime = st.mtimeMs
    } catch { /* ignore */ }
    results.push({ path: dbPath, productCount, size, mtime, source })
  }

  add(getActiveDbPath(), 'active')
  const archiveRoot = getArchiveDir().toLowerCase()
  for (const p of collectBackupDbPaths()) {
    add(p, p.toLowerCase().startsWith(archiveRoot) ? 'archive' : 'backup')
  }
  for (const p of getAllDbCandidatePaths()) add(p, 'legacy')

  const ext = externalFolder?.trim()
  if (ext && existsSync(ext)) {
    try {
      for (const f of readdirSync(ext)) {
        if (f.startsWith('smlpos') && f.endsWith('.db')) add(join(ext, f), 'external')
      }
    } catch { /* ignore */ }
  }

  return results.sort((a, b) => b.mtime - a.mtime)
}

/** Legacy wipe flags from old builds — archive then clear flag; NEVER delete database files. */
export function applyPendingWipeBeforeDbOpen(): boolean {
  let shouldClear = false
  for (const dir of getUserDataDirCandidates()) {
    if (existsSync(join(dir, WIPE_FLAG))) {
      shouldClear = true
      break
    }
  }
  if (!shouldClear) return false

  const liveDb = getActiveDbPath()
  if (existsSync(liveDb)) {
    archiveDbFileCopy(liveDb, 'legacy_wipe')
  }

  for (const dir of getUserDataDirCandidates()) {
    const flagPath = join(dir, WIPE_FLAG)
    if (!existsSync(flagPath)) continue
    try { unlinkSync(flagPath) } catch { /* ignore */ }
  }
  console.log('[wipe] Legacy wipe flag cleared — database preserved, copy saved to archive')
  return true
}

function deleteSqliteFiles(dbPath: string, errors: string[]): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = suffix ? `${dbPath}${suffix}` : dbPath
    if (!existsSync(p)) continue
    try {
      unlinkSync(p)
    } catch (e) {
      errors.push(`${p}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}

function deleteRendererStorage(userDataDir: string, errors: string[]): void {
  const storageDirs = [
    'Local Storage',
    'Session Storage',
    'IndexedDB',
    'Partitions',
    'Cache',
    'Code Cache',
    'GPUCache',
    'blob_storage',
    'databases',
  ]
  for (const name of storageDirs) {
    const dirPath = join(userDataDir, name)
    if (!existsSync(dirPath)) continue
    try {
      rmSync(dirPath, { recursive: true, force: true })
    } catch (e) {
      errors.push(`${dirPath}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}

export function deleteAllLocalDataFiles(userDataDir?: string): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  const liveDb = getActiveDbPath()
  if (existsSync(liveDb)) {
    archiveDbFileCopy(liveDb, 'pre_reset')
  }

  // Only clear renderer cache — never delete smlpos.db or backups/ (data lives in archive).
  const dirsToClean = userDataDir ? [userDataDir] : [getUserDataDir()]
  for (const dir of dirsToClean) {
    deleteRendererStorage(dir, errors)
  }

  return { ok: errors.length === 0, errors }
}

/** After factory reset — never auto-import the 1146-product demo catalog. */
export function shouldSkipProductSeed(): boolean {
  for (const dir of getUserDataDirCandidates()) {
    if (existsSync(join(dir, SKIP_SEED_FLAG))) return true
    const state = readResetStateFromDir(dir)
    if (state?.skipProductSeed) return true
  }
  return false
}

export function getResetDiagnostics(): Record<string, unknown> {
  const dirs = getUserDataDirCandidates()
  return {
    activeDbPath: getActiveDbPath(),
    userDataDirs: dirs.map(dir => ({
      dir,
      wipeFlag: existsSync(join(dir, WIPE_FLAG)),
      skipSeedFlag: existsSync(join(dir, SKIP_SEED_FLAG)),
      resetState: readResetStateFromDir(dir),
    })),
    shouldSkipProductSeed: shouldSkipProductSeed(),
    dbCandidates: getAllDbCandidatePaths().map(p => ({ path: p, exists: existsSync(p) })),
  }
}

/** @deprecated use shouldSkipProductSeed */
export function consumeSkipProductSeedFlag(): boolean {
  return shouldSkipProductSeed()
}

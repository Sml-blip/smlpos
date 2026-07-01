import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

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
  const roaming = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
  const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
  const candidates = [
    getUserDataDir(),
    join(roaming, 'smlpos'),
    join(roaming, 'SMLPOS'),
    join(local, 'smlpos'),
    join(local, 'SMLPOS'),
  ]
  const seen = new Set<string>()
  const unique: string[] = []
  for (const dir of candidates) {
    const key = dir.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(dir)
  }
  return unique
}

/** SQLite file used by the running app (packaged vs dev). */
export function getActiveDbPath(): string {
  return app.isPackaged
    ? join(getUserDataDir(), 'smlpos.db')
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
  return join(getUserDataDir(), 'smlpos.db')
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
  writeFileToAllUserDataDirs(WIPE_FLAG, state.factoryResetAt)
}

/** Mark next launch (and current exit) for a full local data wipe. */
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

/** Run before SQLite opens — deletes DB even if previous wipe could not close the handle. */
export function applyPendingWipeBeforeDbOpen(): boolean {
  let shouldWipe = false
  for (const dir of getUserDataDirCandidates()) {
    if (existsSync(join(dir, WIPE_FLAG))) {
      shouldWipe = true
      break
    }
  }
  if (!shouldWipe) return false

  const result = deleteAllLocalDataFiles()
  if (result.ok) {
    for (const dir of getUserDataDirCandidates()) {
      const flagPath = join(dir, WIPE_FLAG)
      if (!existsSync(flagPath)) continue
      try { unlinkSync(flagPath) } catch { /* ignore */ }
    }
    console.log('[wipe] Pending wipe applied before DB open')
  } else {
    console.error('[wipe] Pending wipe failed — will retry on next launch:', result.errors.join('; '))
  }
  return result.ok
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

  for (const dbPath of getAllDbCandidatePaths()) {
    deleteSqliteFiles(dbPath, errors)
  }

  const dirsToClean = userDataDir ? [userDataDir] : getUserDataDirCandidates()
  for (const dir of dirsToClean) {
    const backupDir = join(dir, 'backups')
    if (existsSync(backupDir)) {
      try {
        rmSync(backupDir, { recursive: true, force: true })
      } catch (e) {
        errors.push(`${backupDir}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
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

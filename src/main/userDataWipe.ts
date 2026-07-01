import { app } from 'electron'
import { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'

export const WIPE_FLAG = '.wipe-requested'
export const SKIP_SEED_FLAG = '.skip-product-seed'

export function getUserDataDir(): string {
  return app.getPath('userData')
}

/** SQLite file used by the running app (packaged vs dev). */
export function getActiveDbPath(): string {
  return app.isPackaged
    ? join(getUserDataDir(), 'smlpos.db')
    : join(process.cwd(), 'smlpos-dev.db')
}

/** Every SQLite path we have ever used — wipe all to avoid stale catalogs. */
export function getAllDbCandidatePaths(): string[] {
  const userDataDir = getUserDataDir()
  const candidates = [
    getActiveDbPath(),
    join(userDataDir, 'smlpos.db'),
    join(userDataDir, 'smlpos-dev.db'),
    join(process.cwd(), 'smlpos-dev.db'),
  ]
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

/** Mark next launch (and current exit) for a full local data wipe. */
export function requestWipeFlags(): void {
  const dir = getUserDataDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, WIPE_FLAG), new Date().toISOString(), 'utf8')
  writeFileSync(join(dir, SKIP_SEED_FLAG), '1', 'utf8')
}

/** Run before SQLite opens — deletes DB even if previous wipe could not close the handle. */
export function applyPendingWipeBeforeDbOpen(): boolean {
  const dir = getUserDataDir()
  const flagPath = join(dir, WIPE_FLAG)
  if (!existsSync(flagPath)) return false

  const result = deleteAllLocalDataFiles(dir)
  if (result.ok) {
    try { unlinkSync(flagPath) } catch { /* ignore */ }
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

export function deleteAllLocalDataFiles(userDataDir: string): { ok: boolean; errors: string[] } {
  const errors: string[] = []

  for (const dbPath of getAllDbCandidatePaths()) {
    deleteSqliteFiles(dbPath, errors)
  }

  const backupDir = join(userDataDir, 'backups')
  if (existsSync(backupDir)) {
    try {
      rmSync(backupDir, { recursive: true, force: true })
    } catch (e) {
      errors.push(`${backupDir}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  deleteRendererStorage(userDataDir, errors)

  return { ok: errors.length === 0, errors }
}

/** Persistent after factory reset — blocks auto-seed until user imports a catalog. */
export function shouldSkipProductSeed(): boolean {
  return existsSync(join(getUserDataDir(), SKIP_SEED_FLAG))
}

/** @deprecated one-shot consume caused catalog to re-seed on the next app launch */
export function consumeSkipProductSeedFlag(): boolean {
  return shouldSkipProductSeed()
}

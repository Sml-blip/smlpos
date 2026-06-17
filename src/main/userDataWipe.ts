import { app } from 'electron'
import { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'

export const WIPE_FLAG = '.wipe-requested'
export const SKIP_SEED_FLAG = '.skip-product-seed'

export function getUserDataDir(): string {
  return app.getPath('userData')
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
  try { unlinkSync(flagPath) } catch { /* ignore */ }

  if (!result.ok) {
    console.error('[wipe] Pending wipe had errors:', result.errors.join('; '))
  } else {
    console.log('[wipe] Pending wipe applied before DB open')
  }
  return true
}

export function deleteAllLocalDataFiles(userDataDir: string): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  const dbPath = join(userDataDir, 'smlpos.db')

  for (const suffix of ['', '-wal', '-shm']) {
    const p = suffix ? `${dbPath}${suffix}` : dbPath
    if (!existsSync(p)) continue
    try {
      unlinkSync(p)
    } catch (e) {
      errors.push(`${p}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const backupDir = join(userDataDir, 'backups')
  if (existsSync(backupDir)) {
    try {
      rmSync(backupDir, { recursive: true, force: true })
    } catch (e) {
      errors.push(`${backupDir}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return { ok: errors.length === 0, errors }
}

/** One-shot skip after factory reset — empty product catalog for first use. */
export function consumeSkipProductSeedFlag(): boolean {
  const flagPath = join(getUserDataDir(), SKIP_SEED_FLAG)
  if (!existsSync(flagPath)) return false
  try { unlinkSync(flagPath) } catch { /* ignore */ }
  return true
}

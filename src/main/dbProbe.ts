import Database from 'better-sqlite3'
import { existsSync } from 'fs'

export function countProductsInDbFile(dbPath: string): number | null {
  if (!existsSync(dbPath)) return null
  try {
    const probe = new Database(dbPath, { readonly: true, fileMustExist: true })
    try {
      const row = probe.prepare('SELECT COUNT(*) as cnt FROM produits').get() as { cnt: number }
      return row?.cnt ?? 0
    } finally {
      probe.close()
    }
  } catch {
    return null
  }
}

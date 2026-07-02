import type Database from 'better-sqlite3'

/** Settings that stay local per machine — never overwritten by remote pull. */
export const LOCAL_SETTINGS_KEYS = new Set([
  'bootstrap_completed_at',
  'bootstrap_last_errors',
  'pull_last_at',
  'backup_folder_path',
])

const SYNC_PULL_ALLOWED = new Set([
  'operateurs', 'categories', 'fournisseurs', 'organisations', 'clients',
  'shifts', 'services_pos', 'transactions_services', 'produits', 'ventes',
  'lignes_vente', 'factures_clients', 'reparations', 'pieces_reparation',
  'sorties_caisse', 'factures_fournisseurs', 'lignes_facture_fournisseur',
  'paiements_fournisseurs', 'credits_clients', 'retours', 'ventes_en_ligne',
  'caisse_interne', 'mouvements_caisse_interne', 'personnels',
  'mouvements_personnels', 'documents', 'lignes_document', 'activity_logs',
  'app_settings',
])

function normalizeCell(value: unknown): unknown {
  if (value === undefined) return null
  if (value !== null && typeof value === 'object' && !Buffer.isBuffer(value)) {
    return JSON.stringify(value)
  }
  return value
}

function asIsoTime(v: unknown): number | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

export function applyRemoteRows(
  db: Database.Database,
  tableName: string,
  rows: Record<string, unknown>[],
): { applied: number; skipped: number } {
  if (!SYNC_PULL_ALLOWED.has(tableName) || rows.length === 0) {
    return { applied: 0, skipped: rows.length }
  }

  const info = db.prepare(`PRAGMA table_info("${tableName}")`).all() as {
    name: string
    notnull: number
    dflt_value: unknown
  }[]
  if (!info.length) return { applied: 0, skipped: rows.length }

  const columns = info.map(c => c.name)
  const pk = tableName === 'app_settings' ? 'key' : 'id'
  if (!columns.includes(pk)) return { applied: 0, skipped: rows.length }

  const placeholders = columns.map(c => `@${c}`).join(', ')
  const updates = columns.filter(c => c !== pk).map(c => `${c} = excluded.${c}`).join(', ')
  const sql = `
    INSERT INTO "${tableName}" (${columns.join(', ')})
    VALUES (${placeholders})
    ON CONFLICT(${pk}) DO UPDATE SET ${updates}
  `
  const stmt = db.prepare(sql)
  const selectLocalUpdatedAt = columns.includes('updated_at')
    ? db.prepare(`SELECT updated_at FROM "${tableName}" WHERE ${pk} = ? LIMIT 1`)
    : null
  let applied = 0
  let skipped = 0

  // If local device has unsynced changes for a row, remote pull must not override it.
  const pendingPks = new Set<string>()
  try {
    const pending = db.prepare(
      `SELECT payload FROM sync_queue WHERE table_name = ? AND synced_at IS NULL`,
    ).all(tableName) as { payload: string }[]
    for (const p of pending) {
      try {
        const parsed = JSON.parse(p.payload) as Record<string, unknown>
        const val = parsed[pk]
        if (val != null) pendingPks.add(String(val))
      } catch {
        // Ignore malformed queue payloads and continue safely.
      }
    }
  } catch {
    // sync_queue may be unavailable in rare migration states; continue without this guard.
  }

  const run = db.transaction((items: Record<string, unknown>[]) => {
    for (const raw of items) {
      if (tableName === 'app_settings') {
        const key = String(raw.key ?? '')
        if (LOCAL_SETTINGS_KEYS.has(key)) {
          skipped++
          continue
        }
      }

      const bound: Record<string, unknown> = {}
      for (const col of columns) {
        let v = raw[col]
        if (v === undefined) {
          const def = info.find(i => i.name === col)?.dflt_value
          v = def !== null && def !== undefined ? def : null
        }
        bound[col] = normalizeCell(v)
      }
      if (bound[pk] == null || bound[pk] === '') {
        skipped++
        continue
      }

      const pkVal = String(bound[pk])
      if (pendingPks.has(pkVal)) {
        skipped++
        continue
      }

      if (selectLocalUpdatedAt && columns.includes('updated_at')) {
        const remoteTs = asIsoTime(raw.updated_at)
        const localRow = selectLocalUpdatedAt.get(pkVal) as { updated_at?: string } | undefined
        const localTs = asIsoTime(localRow?.updated_at)
        if (remoteTs != null && localTs != null && remoteTs < localTs) {
          skipped++
          continue
        }
      }

      stmt.run(bound)
      applied++
    }
  })

  run(rows)
  return { applied, skipped }
}

export function getLocalTableCount(db: Database.Database, tableName: string): number {
  if (!SYNC_PULL_ALLOWED.has(tableName)) return 0
  try {
    const row = db.prepare(`SELECT COUNT(*) as cnt FROM "${tableName}"`).get() as { cnt: number }
    return row?.cnt ?? 0
  } catch {
    return 0
  }
}

export function isPullTableAllowed(tableName: string): boolean {
  return SYNC_PULL_ALLOWED.has(tableName)
}

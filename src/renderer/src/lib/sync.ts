/**
 * SMLPOS Offline Sync Engine
 * bootstrapSync() bulk-uploads local data to Supabase when remote tables are empty.
 * processSyncQueue() handles ongoing incremental sync via sync_queue table.
 */
import { supabase, isSupabaseEnabled } from './supabase'

const api = window.api

let _running = false
let _intervalId: ReturnType<typeof setInterval> | null = null
let _processing = false
let _circuitOpenUntil = 0
let _lastReachCheck = 0
let _lastReachResult = false

const CIRCUIT_PAUSE_MS = 20_000
const REACH_CHECK_TTL_MS = 8_000

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** Parent tables sync before children (FK safety) */
const TABLE_PRIORITY: Record<string, number> = {
  operateurs: 10, categories: 10, fournisseurs: 10, organisations: 10, clients: 10,
  personnels: 10, services_pos: 10, app_settings: 10, shifts: 20,
  produits: 30, caisse_interne: 30, documents: 30, ventes: 40,
  factures_fournisseurs: 40, reparations: 40, ventes_en_ligne: 40,
  lignes_vente: 50, lignes_document: 50, lignes_facture_fournisseur: 50,
  pieces_reparation: 50, factures_clients: 50, credits_clients: 50,
  sorties_caisse: 50, transactions_services: 50, paiements_fournisseurs: 50,
  mouvements_caisse_interne: 50, mouvements_personnels: 50, retours: 50,
  activity_logs: 60,
}

const BOOTSTRAP_TABLES: { table: string; onlyActive?: boolean }[] = [
  { table: 'categories' },
  { table: 'operateurs' },
  { table: 'services_pos' },
  { table: 'fournisseurs', onlyActive: true },
  { table: 'produits', onlyActive: true },
  { table: 'organisations', onlyActive: true },
  { table: 'personnels', onlyActive: true },
  { table: 'clients', onlyActive: true },
  { table: 'documents' },
  { table: 'app_settings' },
  { table: 'shifts' },
  { table: 'ventes' },
  { table: 'lignes_vente' },
]

function sortRowsByPriority<T extends { table_name: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const pa = TABLE_PRIORITY[a.table_name] ?? 45
    const pb = TABLE_PRIORITY[b.table_name] ?? 45
    return pa - pb
  })
}

function isTransientSyncError(msg: string): boolean {
  const m = msg.toLowerCase()
  return (
    m.includes('failed to fetch') ||
    m.includes('networkerror') ||
    m.includes('network request failed') ||
    m.includes('fetch failed') ||
    m.includes('timeout') ||
    m.includes('econnreset') ||
    m.includes('econnrefused') ||
    m.includes('socket hang up') ||
    m.includes('aborterror')
  )
}

function isDeferSyncError(msg: string): boolean {
  const m = msg.toLowerCase()
  return (
    isTransientSyncError(msg) ||
    m.includes('foreign key') ||
    m.includes('violates foreign key') ||
    m.includes('23503') ||
    m.includes('23505') && m.includes('duplicate') === false
  )
}

async function performRemoteSync(
  table_name: string,
  operation: string,
  payload: Record<string, unknown>,
): Promise<string | null> {
  const pk = table_name === 'app_settings' ? 'key' : 'id'
  const pkValue = payload[pk]

  if (operation === 'DELETE') {
    const { error } = await supabase!.from(table_name).delete().eq(pk, pkValue)
    return error?.message ?? null
  }

  const NOT_NULL_TEXT: Record<string, string[]> = {
    shifts: ['operateur_nom'],
    ventes: ['numero', 'total_ttc'],
    reparations: ['numero'],
    documents: ['numero', 'type_document'],
    produits: ['reference', 'nom'],
    clients: ['nom'],
    personnels: ['nom'],
    fournisseurs: ['nom'],
    lignes_vente: ['vente_id'],
  }
  const nullableOverrides = NOT_NULL_TEXT[table_name] ?? []
  const clean = Object.fromEntries(
    Object.entries(payload)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, (v === null && nullableOverrides.includes(k)) ? '' : v])
  )

  if (table_name === 'shifts' && clean.fond_de_caisse == null && payload.id) {
    try {
      const fond = await api.syncShiftsGetFondDeCaisse(String(payload.id)) as number | null
      if (fond != null) clean.fond_de_caisse = fond
      else if (operation === 'INSERT') clean.fond_de_caisse = 0
    } catch { /* ignore */ }
  }

  if (operation === 'UPDATE') {
    const { error } = await supabase!.from(table_name).update(clean).eq(pk, pkValue)
    return error?.message ?? null
  }
  const { error } = await supabase!.from(table_name).upsert(clean, { onConflict: pk })
  return error?.message ?? null
}

/** Ping Supabase before draining queue — avoids flooding retries when network/CSP blocks fetch. */
async function checkSupabaseReachable(): Promise<boolean> {
  if (!supabase) return false
  const now = Date.now()
  if (now - _lastReachCheck < REACH_CHECK_TTL_MS) return _lastReachResult
  _lastReachCheck = now
  try {
    const { error } = await supabase.from('produits').select('id').limit(1).maybeSingle()
    if (error && isTransientSyncError(error.message)) {
      _lastReachResult = false
    } else {
      // Reachable (including RLS/auth errors — server responded)
      _lastReachResult = true
    }
  } catch {
    _lastReachResult = false
  }
  if (!_lastReachResult) {
    _circuitOpenUntil = now + CIRCUIT_PAUSE_MS
    console.warn(`[sync] Supabase unreachable — pausing queue ${CIRCUIT_PAUSE_MS / 1000}s`)
  }
  return _lastReachResult
}

async function syncOneRow(row: {
  id: string; table_name: string; operation: string; payload: string
}): Promise<boolean> {
  let payload: Record<string, unknown>
  try { payload = JSON.parse(row.payload) } catch { payload = {} }

  let errorMsg: string | null = null
  const MAX_TRIES = 3

  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    if (attempt > 0) await sleep(800 * attempt)
    try {
      errorMsg = await performRemoteSync(row.table_name, row.operation, payload)
    } catch (e) {
      errorMsg = String(e)
    }
    if (!errorMsg) {
      await api.syncQueueMarkSynced(row.id)
      return true
    }
    if (!isTransientSyncError(errorMsg) || attempt === MAX_TRIES - 1) break
  }

  const pk = row.table_name === 'app_settings' ? 'key' : 'id'
  const pkValue = payload[pk]

  const errLower = errorMsg!.toLowerCase()
  if (errLower.includes('duplicate key') || errLower.includes('23505')) {
    await api.syncQueueMarkSynced(row.id)
    return true
  }

  if (isDeferSyncError(errorMsg!)) {
    console.warn(`[sync] Deferred ${row.table_name}#${pkValue}:`, errorMsg)
    return false
  }

  console.warn(`[sync] Failed ${row.table_name}#${pkValue}:`, errorMsg)
  await api.syncQueueMarkFailed(row.id, errorMsg!)
  return false
}

export async function processSyncQueue(): Promise<number> {
  if (!isSupabaseEnabled || !supabase) return 0
  if (!navigator.onLine) return 0
  if (Date.now() < _circuitOpenUntil) return 0
  if (_processing) return 0
  if (!(await checkSupabaseReachable())) return 0
  _processing = true
  let synced = 0
  try {
    let batchCount = 0
    while (batchCount < 20) {
      const rows = await api.syncQueueGetPending() as {
        id: string; table_name: string; operation: string; payload: string
      }[]
      if (!rows.length) break

      for (const row of sortRowsByPriority(rows)) {
        if (await syncOneRow(row)) synced++
      }
      await api.syncQueueCleanup()
      batchCount++
      if (rows.length < 100) break
    }
  } catch (e) {
    console.warn('[sync] processSyncQueue error:', e)
  } finally {
    _processing = false
  }
  return synced
}

export async function getPendingCount(): Promise<number> {
  try {
    return (await api.syncQueuePendingCount()) as number
  } catch {
    return 0
  }
}

export async function getFailedCount(): Promise<number> {
  try {
    return (await api.syncQueueFailedCount()) as number
  } catch {
    return 0
  }
}

export async function resetFailedItems(): Promise<number> {
  try {
    const res = await api.syncQueueResetAllFailed() as { reset: number }
    return res.reset ?? 0
  } catch {
    return 0
  }
}

export async function purgeFailedItems(): Promise<number> {
  try {
    const res = await api.syncQueuePurgeAllFailed() as { deleted: number }
    return res.deleted ?? 0
  } catch {
    return 0
  }
}

async function isRemoteTableEmpty(table: string): Promise<boolean> {
  const { count, error } = await supabase!.from(table).select('*', { count: 'exact', head: true })
  if (error) {
    console.warn(`[sync] Bootstrap check ${table}:`, error.message)
    return false
  }
  return (count ?? 0) === 0
}

export async function bootstrapSync(): Promise<void> {
  if (!isSupabaseEnabled || !supabase) return
  if (!navigator.onLine) return
  if (!(await checkSupabaseReachable())) return

  try {
    const settings = await api.settingsGetAll() as Record<string, string>
    if (settings.bootstrap_completed_at) {
      console.info('[sync] Bootstrap already completed at', settings.bootstrap_completed_at)
      return
    }

    console.info('[sync] Starting per-table bootstrap sync...')
    const errors: string[] = []

    const upload = async (table: string, onlyActive = false) => {
      const empty = await isRemoteTableEmpty(table)
      if (!empty) {
        console.info(`[sync] Bootstrap skip ${table} — remote not empty`)
        return
      }
      const rows = await api.syncBootstrapTableData(table, onlyActive) as Record<string, unknown>[]
      if (!rows.length) return
      const BATCH = 200
      const pk = table === 'app_settings' ? 'key' : 'id'
      for (let i = 0; i < rows.length; i += BATCH) {
        let batchError: string | null = null
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt > 0) await sleep(1000 * attempt)
          const { error } = await supabase!.from(table).upsert(rows.slice(i, i + BATCH), { onConflict: pk })
          batchError = error?.message ?? null
          if (!batchError || !isTransientSyncError(batchError)) break
        }
        if (batchError) {
          errors.push(`${table}: ${batchError}`)
          console.warn(`[sync] Bootstrap ${table} batch error:`, batchError)
        } else {
          console.info(`[sync] Bootstrap ${table} ${i + 1}–${Math.min(i + BATCH, rows.length)}`)
        }
      }
    }

    for (const { table, onlyActive } of BOOTSTRAP_TABLES) {
      await upload(table, onlyActive ?? false)
    }

    if (errors.length === 0) {
      const now = new Date().toISOString()
      await api.settingsSet('bootstrap_completed_at', now)
      console.info('[sync] Bootstrap sync complete ✓')
    } else {
      console.warn('[sync] Bootstrap completed with errors:', errors.join('; '))
      await api.settingsSet('bootstrap_last_errors', errors.slice(0, 5).join(' | '))
    }
  } catch (e) {
    console.warn('[sync] Bootstrap error:', e)
  }
}

export function startSyncPolling(intervalMs = 10_000) {
  if (_running || !isSupabaseEnabled) return
  _running = true

  processSyncQueue().then(n => { if (n > 0) console.info(`[sync] Flushed ${n} records on startup`) })

  _intervalId = setInterval(() => { processSyncQueue() }, intervalMs)

  window.addEventListener('online', () => {
    _circuitOpenUntil = 0
    _lastReachCheck = 0
    processSyncQueue().then(n => { if (n > 0) console.info(`[sync] Flushed ${n} on reconnect`) })
  })

  window.addEventListener('focus', () => {
    processSyncQueue()
  })
}

export function stopSyncPolling() {
  if (_intervalId) { clearInterval(_intervalId); _intervalId = null }
  _running = false
}

export async function getBootstrapStatus(): Promise<{ completed: boolean; errors?: string }> {
  try {
    const settings = await api.settingsGetAll() as Record<string, string>
    return {
      completed: !!settings.bootstrap_completed_at,
      errors: settings.bootstrap_last_errors,
    }
  } catch {
    return { completed: false }
  }
}

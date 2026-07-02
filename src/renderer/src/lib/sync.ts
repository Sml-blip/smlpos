/**
 * SMLPOS Offline Sync Engine
 * push: local SQLite → Supabase via sync_queue
 * pull: Supabase → local SQLite (multi-PC sync)
 */
import { supabase, isSupabaseEnabled } from './supabase'
import { invalidateProduitsCache } from './produitsCache'

const api = window.api

let _running = false
let _intervalId: ReturnType<typeof setInterval> | null = null
let _processing = false
let _pulling = false
let _pullTick = 0
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

const PULL_TABLES = Object.keys(TABLE_PRIORITY).sort(
  (a, b) => (TABLE_PRIORITY[a] ?? 45) - (TABLE_PRIORITY[b] ?? 45),
)

const PULL_PAGE_SIZE = 500
const PULL_EVERY_N_POLLS = 3

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
    console.warn(`[sync] Remote check ${table}:`, error.message)
    return true
  }
  return (count ?? 0) === 0
}

async function fetchRemoteTable(table: string): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase!
      .from(table)
      .select('*')
      .range(from, from + PULL_PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    if (!data?.length) break
    all.push(...(data as Record<string, unknown>[]))
    if (data.length < PULL_PAGE_SIZE) break
    from += PULL_PAGE_SIZE
  }
  return all
}

/** Download remote Supabase rows into local SQLite (multi-PC sync). */
export async function pullSyncFromRemote(_opts?: { full?: boolean }): Promise<{ applied: number; errors: string[] }> {
  if (!isSupabaseEnabled || !supabase) return { applied: 0, errors: [] }
  if (!navigator.onLine) return { applied: 0, errors: [] }
  if (_pulling) return { applied: 0, errors: [] }
  if (!(await checkSupabaseReachable())) return { applied: 0, errors: [] }

  _pulling = true
  let applied = 0
  const errors: string[] = []
  try {
    for (const table of PULL_TABLES) {
      try {
        const rows = await fetchRemoteTable(table)
        if (!rows.length) continue
        const result = await api.syncPullApplyRows(table, rows) as {
          applied?: number; error?: string | null
        }
        if (result.error) {
          errors.push(`${table}: ${result.error}`)
          console.warn(`[sync] Pull ${table}:`, result.error)
        } else {
          applied += result.applied ?? 0
          if ((result.applied ?? 0) > 0) {
            console.info(`[sync] Pulled ${table}: ${result.applied} row(s)`)
          }
        }
      } catch (e) {
        const msg = String(e)
        errors.push(`${table}: ${msg}`)
        console.warn(`[sync] Pull ${table} failed:`, msg)
      }
    }

    await api.settingsSet('pull_last_at', new Date().toISOString())
    if (applied > 0) {
      invalidateProduitsCache()
      window.dispatchEvent(new CustomEvent('smlpos:sync-pull-complete', { detail: { applied } }))
    }
  } finally {
    _pulling = false
  }
  return { applied, errors }
}

export async function bootstrapSync(): Promise<void> {
  if (!isSupabaseEnabled || !supabase) return
  if (!navigator.onLine) return
  if (!(await checkSupabaseReachable())) return

  try {
    const settings = await api.settingsGetAll() as Record<string, string>
    const remoteHasData =
      !(await isRemoteTableEmpty('produits')) ||
      !(await isRemoteTableEmpty('ventes')) ||
      !(await isRemoteTableEmpty('clients'))

    if (remoteHasData) {
      console.info('[sync] Remote data found — pulling into local database...')
      const pull = await pullSyncFromRemote({ full: true })
      if (pull.errors.length) {
        await api.settingsSet('bootstrap_last_errors', pull.errors.slice(0, 5).join(' | '))
      } else {
        await api.settingsSet('bootstrap_last_errors', '')
      }
      if (!settings.bootstrap_completed_at) {
        await api.settingsSet('bootstrap_completed_at', new Date().toISOString())
      }
      console.info(`[sync] Bootstrap pull complete — ${pull.applied} row(s) applied`)
      return
    }

    if (settings.bootstrap_completed_at) {
      console.info('[sync] Bootstrap already completed at', settings.bootstrap_completed_at)
      return
    }

    console.info('[sync] Remote empty — uploading local data...')
    const errors: string[] = []

    const upload = async (table: string, onlyActive = false) => {
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
      console.info('[sync] Bootstrap upload complete ✓')
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

  const runCycle = async () => {
    const pushed = await processSyncQueue()
    if (pushed > 0) console.info(`[sync] Pushed ${pushed} record(s)`)
    _pullTick++
    if (_pullTick >= PULL_EVERY_N_POLLS) {
      _pullTick = 0
      const pulled = await pullSyncFromRemote({ full: false })
      if (pulled.applied > 0) console.info(`[sync] Pulled ${pulled.applied} record(s) from remote`)
    }
  }

  runCycle()

  _intervalId = setInterval(() => { runCycle() }, intervalMs)

  window.addEventListener('online', () => {
    _circuitOpenUntil = 0
    _lastReachCheck = 0
    runCycle()
  })

  window.addEventListener('focus', () => {
    runCycle()
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

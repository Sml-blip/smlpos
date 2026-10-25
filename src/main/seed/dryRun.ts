import Database from 'better-sqlite3'
import { createHash } from 'crypto'
import {
  CONTRACT_VERSION, DRIFT_TOLERANCE_MILLIMES, EXCLUDED_TABLES, LOCAL_ONLY_SETTING_KEYS, MONEY_UNIT,
  SECRET_SETTING_PATTERN, classifyColumn, moneyColumnsOf, primaryKeyOf, tableOrder, toMillimes,
  type ColumnKind,
} from './tables'
import { listUserTables } from './snapshot'

export interface Issue {
  table: string
  code: string
  column?: string
  count: number
  samples: string[]
}

export interface TableReport {
  name: string
  rows: number
  seedable: number
  skipped: number
  moneyColumns: string[]
  /** Sum of each money column in millimes — the server must reproduce these after upload. */
  moneySumsMillimes: Record<string, number>
  /** sha256 over the ordered per-row hashes. */
  digest: string
  columns: string[]
}

export interface SeedReport {
  contractVersion: number
  moneyUnit: string
  createdAt: string
  backupPath: string
  backupSha256: string
  schemaVersion: string | null
  status: 'passed' | 'blocked'
  tables: TableReport[]
  excludedTables: string[]
  excludedSettingKeys: string[]
  blockers: Issue[]
  warnings: Issue[]
  notes: string[]
  /** Binds approval to exactly this data + contract. */
  digest: string
}

class IssueSink {
  private map = new Map<string, Issue>()
  add(table: string, code: string, sample: string, column?: string): void {
    const key = `${table}|${code}|${column ?? ''}`
    const cur = this.map.get(key) ?? { table, code, column, count: 0, samples: [] }
    cur.count++
    if (cur.samples.length < 5) cur.samples.push(sample)
    this.map.set(key, cur)
  }
  list(): Issue[] { return [...this.map.values()] }
}

export interface ColumnInfo { name: string; type: string; kind: ColumnKind }

export function describeColumns(db: Database.Database, table: string): ColumnInfo[] {
  const info = db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string; type: string }[]
  return info.map(c => ({ name: c.name, type: c.type || '', kind: classifyColumn(table, c.name, c.type || '') }))
}

export function isSeedableSetting(key: string): boolean {
  return !LOCAL_ONLY_SETTING_KEYS.has(key) && !SECRET_SETTING_PATTERN.test(key)
}

export interface ConvertedRow {
  pk: string
  row: Record<string, unknown>
  hash: string
}

/** Convert one raw SQLite row to its wire form (money → millimes). Records issues, never throws. */
export function convertRow(
  table: string,
  raw: Record<string, unknown>,
  cols: ColumnInfo[],
  sink: IssueSink | null,
): ConvertedRow | null {
  const pkCol = primaryKeyOf(table)
  const pkVal = raw[pkCol]
  if (pkVal == null || String(pkVal) === '') {
    sink?.add(table, 'missing_pk', `rowid-less row without ${pkCol}`)
    return null
  }
  const pk = String(pkVal)
  if (pk.length > 128) sink?.add(table, 'id_too_long', pk.slice(0, 40))

  const out: Record<string, unknown> = {}
  for (const c of [...cols].sort((a, b) => a.name.localeCompare(b.name))) {
    let v = raw[c.name]
    if (v === undefined) v = null
    if (Buffer.isBuffer(v)) {
      sink?.add(table, 'blob_value', `${pk}.${c.name}`, c.name)
      continue
    }
    if (v !== null && c.kind === 'money') {
      const r = toMillimes(v)
      if (!r.ok) {
        sink?.add(table, `money_${r.reason}`, `${pk}.${c.name}=${String(v).slice(0, 20)}`, c.name)
        continue
      }
      if (r.drift > DRIFT_TOLERANCE_MILLIMES) {
        sink?.add(table, 'money_sub_millime', `${pk}.${c.name}=${String(v)}`, c.name)
      }
      v = r.millimes
    } else if (v !== null && c.kind === 'integer' && typeof v === 'number' && !Number.isInteger(v)) {
      sink?.add(table, 'integer_column_fractional', `${pk}.${c.name}=${v}`, c.name)
    }
    out[c.name] = v
  }
  const hash = createHash('sha256').update(JSON.stringify([table, out])).digest('hex')
  return { pk, row: out, hash }
}

/** Parent links checked for orphans (warnings: old POS data often has deleted parents). */
const REFS: [child: string, column: string, parent: string][] = [
  ['lignes_vente', 'vente_id', 'ventes'],
  ['factures_clients', 'vente_id', 'ventes'],
  ['pieces_reparation', 'reparation_id', 'reparations'],
  ['lignes_facture_fournisseur', 'facture_id', 'factures_fournisseurs'],
  ['paiements_fournisseurs', 'facture_id', 'factures_fournisseurs'],
  ['lignes_document', 'document_id', 'documents'],
  ['mouvements_personnels', 'personnel_id', 'personnels'],
  ['credits_clients', 'client_id', 'clients'],
  ['serial_numbers', 'produit_id', 'produits'],
  ['ventes', 'shift_id', 'shifts'],
  ['lignes_vente', 'produit_id', 'produits'],
]

function tableHasColumn(db: Database.Database, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).some(c => c.name === column)
}

function readSchemaVersion(db: Database.Database): string | null {
  try {
    const r = db.prepare(`SELECT value FROM app_settings WHERE key='schema_version'`).get() as { value?: string } | undefined
    return r?.value ?? null
  } catch { return null }
}

/** Selected rows of a table in pk order (settings filtered). */
export function* iterateSeedRows(
  db: Database.Database,
  table: string,
): Generator<{ raw: Record<string, unknown>; skipped: boolean }> {
  const pk = primaryKeyOf(table)
  const stmt = db.prepare(`SELECT * FROM "${table}" ORDER BY "${pk}"`)
  for (const raw of stmt.iterate() as IterableIterator<Record<string, unknown>>) {
    const skipped = table === 'app_settings' && !isSeedableSetting(String(raw.key ?? ''))
    yield { raw, skipped }
  }
}

/**
 * Pure, offline dry run over a (verified) database copy. Makes no network call and writes nothing.
 * `serverTables` (optional, from the backend preflight) adds a contract-compatibility check.
 */
export function buildReport(
  backupDb: Database.Database,
  meta: { backupPath: string; backupSha256: string; integrityOk: boolean; now?: Date },
  serverTables?: Record<string, { columns: string[] }> | null,
): SeedReport {
  const sink = new IssueSink()
  const notes: string[] = []
  const all = listUserTables(backupDb)
  const excludedTables = all.filter(t => EXCLUDED_TABLES.has(t))
  const names = tableOrder(all.filter(t => !EXCLUDED_TABLES.has(t)))
  const tables: TableReport[] = []
  const excludedSettingKeys: string[] = []

  if (!meta.integrityOk) sink.add('*', 'integrity_failed', 'PRAGMA integrity_check did not return ok')

  for (const name of names) {
    const cols = describeColumns(backupDb, name)
    for (const c of cols) {
      if (c.kind === 'real_unclassified') sink.add(name, 'real_unclassified', `${name}.${c.name} (${c.type})`, c.name)
    }
    const money = moneyColumnsOf(name).filter(m => cols.some(c => c.name === m))
    const sums: Record<string, number> = Object.fromEntries(money.map(m => [m, 0]))
    const digest = createHash('sha256')
    let rows = 0
    let seedable = 0
    let skipped = 0

    for (const { raw, skipped: skip } of iterateSeedRows(backupDb, name)) {
      rows++
      if (skip) {
        skipped++
        excludedSettingKeys.push(String(raw.key))
        continue
      }
      const conv = convertRow(name, raw, cols, sink)
      if (!conv) { skipped++; continue }
      seedable++
      digest.update(conv.hash)
      for (const m of money) {
        const v = conv.row[m]
        if (typeof v === 'number') sums[m] += v
      }
    }

    if (serverTables) {
      const server = serverTables[name]
      if (!server) sink.add(name, 'table_unknown_to_server', name)
      else {
        const allowed = new Set(server.columns)
        for (const c of cols) if (!allowed.has(c.name)) sink.add(name, 'column_unknown_to_server', `${name}.${c.name}`, c.name)
      }
    }

    tables.push({
      name, rows, seedable, skipped, moneyColumns: money, moneySumsMillimes: sums,
      digest: digest.digest('hex'), columns: cols.map(c => c.name),
    })
  }

  for (const [child, column, parent] of REFS) {
    if (!all.includes(child) || !all.includes(parent) || !tableHasColumn(backupDb, child, column)) continue
    const pk = primaryKeyOf(parent)
    const r = backupDb.prepare(
      `SELECT COUNT(*) AS c FROM "${child}" c LEFT JOIN "${parent}" p ON c."${column}" = p."${pk}"
       WHERE c."${column}" IS NOT NULL AND c."${column}" != '' AND p."${pk}" IS NULL`,
    ).get() as { c: number }
    if (r.c > 0) {
      const ex = backupDb.prepare(
        `SELECT c."${column}" AS v FROM "${child}" c LEFT JOIN "${parent}" p ON c."${column}" = p."${pk}"
         WHERE c."${column}" IS NOT NULL AND c."${column}" != '' AND p."${pk}" IS NULL LIMIT 5`,
      ).all() as { v: string }[]
      for (let i = 0; i < r.c; i++) sink.add(child, 'orphan_ref', `${column}→${parent}: ${ex[Math.min(i, ex.length - 1)]?.v}`, column)
    }
  }

  const fk = backupDb.pragma('foreign_key_check') as unknown[]
  if (fk.length > 0) {
    for (const row of fk as { table: string; rowid: number; parent: string }[]) {
      sink.add(row.table, 'fk_violation', `rowid ${row.rowid} → ${row.parent}`)
    }
  }

  if (excludedSettingKeys.length) notes.push(`${excludedSettingKeys.length} setting(s) stay on this PC (credentials, local paths).`)
  if (excludedTables.length) notes.push(`Local-only tables not seeded: ${excludedTables.join(', ')}.`)

  const BLOCKING = new Set([
    'integrity_failed', 'missing_pk', 'id_too_long', 'blob_value', 'real_unclassified',
    'money_not_numeric', 'money_not_finite', 'money_out_of_range', 'integer_column_fractional',
    'table_unknown_to_server', 'column_unknown_to_server',
  ])
  const issues = sink.list()
  const blockers = issues.filter(i => BLOCKING.has(i.code))
  const warnings = issues.filter(i => !BLOCKING.has(i.code))

  const digest = createHash('sha256').update(JSON.stringify({
    v: CONTRACT_VERSION, backup: meta.backupSha256,
    tables: tables.map(t => [t.name, t.seedable, t.digest, t.moneySumsMillimes]),
  })).digest('hex')

  return {
    contractVersion: CONTRACT_VERSION,
    moneyUnit: MONEY_UNIT,
    createdAt: (meta.now ?? new Date()).toISOString(),
    backupPath: meta.backupPath,
    backupSha256: meta.backupSha256,
    schemaVersion: readSchemaVersion(backupDb),
    status: blockers.length === 0 ? 'passed' : 'blocked',
    tables, excludedTables, excludedSettingKeys, blockers, warnings, notes, digest,
  }
}

export interface PendingRow { table: string; pk: string; hash: string; opId: string; row: Record<string, unknown> }

export function opIdFor(installId: string, table: string, pk: string, hash: string): string {
  return createHash('sha256').update(`${installId}|${table}|${pk}|${hash}`).digest('hex')
}

/**
 * Rows still to upload for one table: every seedable row whose (pk, hash) is NOT already acknowledged
 * in the ledger. A crash/resume therefore re-sends at most one unacknowledged batch, and the server
 * dedupes it by op_id. A row edited after the first seed gets a new hash and is re-sent.
 */
export function* pendingRows(
  backupDb: Database.Database,
  table: string,
  installId: string,
  isAcked: (table: string, pk: string, hash: string) => boolean,
): Generator<PendingRow> {
  const cols = describeColumns(backupDb, table)
  for (const { raw, skipped } of iterateSeedRows(backupDb, table)) {
    if (skipped) continue
    const conv = convertRow(table, raw, cols, null)
    if (!conv) continue
    if (isAcked(table, conv.pk, conv.hash)) continue
    yield { table, pk: conv.pk, hash: conv.hash, opId: opIdFor(installId, table, conv.pk, conv.hash), row: conv.row }
  }
}

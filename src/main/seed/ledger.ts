import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'

/**
 * Seed ledger — a SEPARATE sqlite file (userData/seed-state.db). smlpos.db is never written by the
 * seed feature. The ledger holds: config, the approved report, acknowledged rows (resume + delta),
 * and rejected operations (shown in the panel).
 */
export type SeedState = 'idle' | 'backup_ok' | 'checked' | 'blocked' | 'approved' | 'running' | 'paused' | 'finalizing' | 'done' | 'needs_review' | 'failed'

export interface RejectedOp {
  op_id: string
  table_name: string
  pk: string
  code: string
  message: string
  at: string
}

export class SeedLedger {
  readonly db: Database.Database
  private ackStmt: Database.Statement
  private hasAckStmt: Database.Statement

  constructor(path: string) {
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS config (k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS acked_rows (
        table_name TEXT NOT NULL, pk TEXT NOT NULL, row_hash TEXT NOT NULL, acked_at TEXT NOT NULL,
        PRIMARY KEY (table_name, pk, row_hash)
      );
      CREATE TABLE IF NOT EXISTS rejected_ops (
        op_id TEXT PRIMARY KEY, table_name TEXT NOT NULL, pk TEXT NOT NULL,
        code TEXT NOT NULL, message TEXT NOT NULL, at TEXT NOT NULL, resolved INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT
      );
    `)
    this.ackStmt = this.db.prepare(
      `INSERT OR IGNORE INTO acked_rows (table_name, pk, row_hash, acked_at) VALUES (?, ?, ?, ?)`,
    )
    this.hasAckStmt = this.db.prepare(
      `SELECT 1 FROM acked_rows WHERE table_name = ? AND pk = ? AND row_hash = ? LIMIT 1`,
    )
  }

  close(): void { try { this.db.close() } catch { /* ignore */ } }

  get(key: string): string | null {
    const r = this.db.prepare(`SELECT v FROM config WHERE k = ?`).get(key) as { v: string } | undefined
    return r?.v ?? null
  }
  set(key: string, value: string | null): void {
    if (value == null) this.db.prepare(`DELETE FROM config WHERE k = ?`).run(key)
    else this.db.prepare(`INSERT INTO config (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`).run(key, value)
  }
  getJson<T>(key: string): T | null {
    const v = this.get(key)
    if (!v) return null
    try { return JSON.parse(v) as T } catch { return null }
  }
  setJson(key: string, value: unknown): void { this.set(key, JSON.stringify(value)) }

  /** Stable per-installation id; part of every op_id. */
  installId(): string {
    let id = this.get('install_id')
    if (!id) { id = randomUUID(); this.set('install_id', id) }
    return id
  }

  state(): SeedState { return (this.get('state') as SeedState | null) ?? 'idle' }
  setState(s: SeedState): void { this.set('state', s); this.event('state', s) }

  event(kind: string, detail?: string): void {
    this.db.prepare(`INSERT INTO events (at, kind, detail) VALUES (?, ?, ?)`).run(new Date().toISOString(), kind, detail ?? null)
  }

  isAcked = (table: string, pk: string, hash: string): boolean =>
    this.hasAckStmt.get(table, pk, hash) !== undefined

  ackMany(rows: { table: string; pk: string; hash: string }[]): void {
    const at = new Date().toISOString()
    this.db.transaction(() => { for (const r of rows) this.ackStmt.run(r.table, r.pk, r.hash, at) })()
  }

  ackedCount(table?: string): number {
    const r = table
      ? this.db.prepare(`SELECT COUNT(*) AS c FROM acked_rows WHERE table_name = ?`).get(table)
      : this.db.prepare(`SELECT COUNT(*) AS c FROM acked_rows`).get()
    return (r as { c: number }).c
  }

  addRejected(items: Omit<RejectedOp, 'at'>[]): void {
    const at = new Date().toISOString()
    const stmt = this.db.prepare(
      `INSERT INTO rejected_ops (op_id, table_name, pk, code, message, at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(op_id) DO UPDATE SET code = excluded.code, message = excluded.message, at = excluded.at, resolved = 0`,
    )
    this.db.transaction(() => { for (const i of items) stmt.run(i.op_id, i.table_name, i.pk, i.code, i.message.slice(0, 500), at) })()
  }
  resolveRejected(opIds: string[]): void {
    const stmt = this.db.prepare(`UPDATE rejected_ops SET resolved = 1 WHERE op_id = ?`)
    this.db.transaction(() => { for (const id of opIds) stmt.run(id) })()
  }
  rejected(limit = 200): RejectedOp[] {
    return this.db.prepare(
      `SELECT op_id, table_name, pk, code, message, at FROM rejected_ops WHERE resolved = 0 ORDER BY at DESC LIMIT ?`,
    ).all(limit) as RejectedOp[]
  }
  rejectedCount(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS c FROM rejected_ops WHERE resolved = 0`).get() as { c: number }).c
  }
}

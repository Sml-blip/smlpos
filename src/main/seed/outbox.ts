import type Database from 'better-sqlite3'
import { COUNTER_COLUMNS, LOCAL_ONLY_SETTING_KEYS, SECRET_SETTING_FRAGMENTS, primaryKeyOf, syncedTableNames } from './tables'

const ident = (name: string) => `"${name.replaceAll('"', '""')}"`
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`
const now = "strftime('%Y-%m-%dT%H:%M:%fZ','now')"
const active = "COALESCE((SELECT v FROM sync_state WHERE k='apply_mute'),'0')='0'"
function settingFilter(alias: string) {
  return `${alias}."key" NOT IN (${[...LOCAL_ONLY_SETTING_KEYS].map(literal).join(',')}) AND ${SECRET_SETTING_FRAGMENTS.map(part => `instr(lower(${alias}."key"),${literal(part)})=0`).join(' AND ')}`
}
const beforeKey = (table: string, pk: string, column: string) => `'before:'||json_array(${literal(table)},NEW.${ident(pk)},${literal(column)})`

/** Step 1 only: additive capture, no network, drainer or handler changes.
 * Installation is explicit; the seed service will install it after a verified
 * backup and before taking its seed snapshot in Step 2. */
export function installOutbox(db: Database.Database): string[] {
  if (db.inTransaction) throw new Error('Install outbox outside a business transaction')
  const names = syncedTableNames((db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map(row => row.name))
  // SQLite REPLACE must expose its implicit deletes; otherwise a different row
  // removed by a UNIQUE conflict would disappear without a tombstone.
  const recursiveBefore = db.pragma('recursive_triggers', { simple: true })
  db.pragma('recursive_triggers = ON')
  try { db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS sync_state(k TEXT PRIMARY KEY,v TEXT);
      CREATE TABLE IF NOT EXISTS outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT,table_name TEXT NOT NULL,pk TEXT NOT NULL,
      op TEXT NOT NULL CHECK(op IN ('UPSERT','DELETE','DELTA')),row_json TEXT,delta_field TEXT,delta_value REAL,
      at TEXT NOT NULL,sent_at TEXT,attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT);
      CREATE INDEX IF NOT EXISTS outbox_pending ON outbox(sent_at,seq);
      INSERT OR IGNORE INTO sync_state(k,v) VALUES('apply_mute','0');
      INSERT OR IGNORE INTO sync_state(k,v) VALUES('device_id',''),('install_id',''),('pull_cursor','0');
      INSERT OR IGNORE INTO sync_state(k,v) VALUES('seed_finalized_at','');
      INSERT OR IGNORE INTO sync_state(k,v) VALUES('outbox_drain_enabled','0');`)
    for (const table of names) {
      const columns = (db.prepare(`PRAGMA table_info(${ident(table)})`).all() as { name: string }[]).map(column => column.name)
      const pk = primaryKeyOf(table)
      if (!columns.includes(pk)) throw new Error(`No audited primary key for ${table}`)
      const counters = (COUNTER_COLUMNS[table] ?? []).filter(column => columns.includes(column))
      const json = `json_object(${columns.filter(column => !counters.includes(column)).flatMap(column => [literal(column), `NEW.${ident(column)}`]).join(',')})`
      const allowed = (alias: string) => table === 'app_settings' ? ` AND (${settingFilter(alias)})` : ''
      const upsert = `INSERT INTO outbox(table_name,pk,op,row_json,at) VALUES(${literal(table)},NEW.${ident(pk)},'UPSERT',${json},${now});`
      const tombstone = `INSERT INTO outbox(table_name,pk,op,at) VALUES(${literal(table)},OLD.${ident(pk)},'DELETE',${now});`
      const clear = counters.map(column => `DELETE FROM sync_state WHERE k=${beforeKey(table, pk, column)};`).join('\n')
      // BEFORE INSERT remembers the replaced value inside the same transaction.
      // This handles both normal inserts and existing INSERT OR REPLACE handlers.
      if (counters.length) {
        db.exec(`CREATE TRIGGER IF NOT EXISTS ${ident(`live_${table}_before_insert`)} BEFORE INSERT ON ${ident(table)} WHEN ${active} BEGIN
          ${counters.map(column => `INSERT INTO sync_state(k,v) VALUES(${beforeKey(table, pk, column)},COALESCE((SELECT ${ident(column)} FROM ${ident(table)} WHERE ${ident(pk)}=NEW.${ident(pk)}),0)) ON CONFLICT(k) DO UPDATE SET v=excluded.v;`).join('\n')}
        END;`)
      }
      for (const operation of ['INSERT', 'UPDATE'] as const) {
        const deltas = counters.map(column => {
          const old = operation === 'UPDATE' ? `(CASE WHEN OLD.${ident(pk)} IS NEW.${ident(pk)} THEN COALESCE(OLD.${ident(column)},0) ELSE 0 END)` : `COALESCE((SELECT CAST(v AS REAL) FROM sync_state WHERE k=${beforeKey(table, pk, column)}),0)`
          const delta = `(COALESCE(NEW.${ident(column)},0)-${old})`
          return `INSERT INTO outbox(table_name,pk,op,delta_field,delta_value,at) SELECT ${literal(table)},NEW.${ident(pk)},'DELTA',${literal(column)},${delta},${now} WHERE ${delta}<>0;`
        }).join('\n')
        db.exec(`CREATE TRIGGER IF NOT EXISTS ${ident(`live_${table}_${operation.toLowerCase()}`)} AFTER ${operation} ON ${ident(table)} WHEN ${active}${allowed('NEW')} BEGIN
          ${operation === 'UPDATE' ? `INSERT INTO outbox(table_name,pk,op,at) SELECT ${literal(table)},OLD.${ident(pk)},'DELETE',${now} WHERE OLD.${ident(pk)} IS NOT NEW.${ident(pk)};` : ''}
          ${upsert}\n${deltas}\n${clear}
        END;`)
      }
      db.exec(`CREATE TRIGGER IF NOT EXISTS ${ident(`live_${table}_delete`)} AFTER DELETE ON ${ident(table)} WHEN ${active}${allowed('OLD')} BEGIN ${tombstone} END;`)
    }
  })() } catch (error) { db.pragma(`recursive_triggers = ${recursiveBefore ? 'ON' : 'OFF'}`); throw error }
  return names
}

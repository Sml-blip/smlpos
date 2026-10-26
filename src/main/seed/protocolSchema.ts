import type Database from 'better-sqlite3'
import { syncedTableNames } from './tables'

/** Add only protocol-owned storage after the caller verifies a protection backup.
 * Business IDs, amounts and historical rows are never rewritten here.
 */
export function prepareProtocolSchema(db: Database.Database, remote: Record<string,{columns:string[];pk:string}>) {
 db.transaction(()=>{
  if(remote.stock_movements)db.exec(`CREATE TABLE IF NOT EXISTS stock_movements(
   id TEXT PRIMARY KEY,produit_id TEXT NOT NULL,delta INTEGER NOT NULL,reason TEXT NOT NULL,
   ref_id TEXT,device_id TEXT,created_at TEXT,updated_at TEXT,deleted_at TEXT)`)
  const tables=syncedTableNames((db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {name:string}[]).map(row=>row.name))
  for(const table of tables){
   const quote=(s:string)=>'"'+s.replaceAll('"','""')+'"'
   const columns=new Set((db.prepare(`PRAGMA table_info(${quote(table)})`).all() as {name:string}[]).map(row=>row.name))
   for(const column of ['updated_at','deleted_at','device_id','numero_legacy_device']){
    if(remote[table]?.columns.includes(column)&&!columns.has(column))db.exec(`ALTER TABLE ${quote(table)} ADD COLUMN ${quote(column)} TEXT`)
   }
  }
 })()
}

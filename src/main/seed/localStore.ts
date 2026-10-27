import { createHash,randomBytes } from 'node:crypto'
import { existsSync,mkdirSync,readFileSync,statSync,statfsSync,writeFileSync } from 'node:fs'
import { join,resolve } from 'node:path'
import { BUSINESS_TABLES,localSetting,quote,SEED_TABLES } from './contract.ts'

export interface Sqlite {
 exec(sql:string):unknown
 prepare(sql:string):{all(...args:any[]):any[];get(...args:any[]):any;run(...args:any[]):any}
 close():void
}
export type OpenCopy=(path:string)=>Sqlite
export type VerifiedCopy={path:string;sha256:string;counts:Record<string,number>;integrityOk:true}
const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex')
export function uuid7(){const bytes=randomBytes(16);bytes.writeUIntBE(Date.now(),0,6);bytes[6]=(bytes[6]&15)|0x70;bytes[8]=(bytes[8]&63)|0x80;const h=bytes.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`}
const columns=(db:Sqlite,table:string)=>db.prepare(`PRAGMA table_info(${quote(table)})`).all() as Array<{name:string}>
const tables=(db:Sqlite)=>db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>String(row.name))
export function rowCounts(db:Sqlite){return Object.fromEntries(tables(db).map(table=>[table,Number(db.prepare(`SELECT count(*) n FROM ${quote(table)}`).get().n)]))}
export function meta(db:Sqlite,key:string){return db.prepare('SELECT value FROM sync_meta WHERE key=?').get(key)?.value as string|undefined}
export function setMeta(db:Sqlite,key:string,value:string){db.prepare('INSERT INTO sync_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value)}

/** VACUUM INTO uses one consistent SQLite read snapshot, including the outbox
 * fence. No file-system copy of a live WAL database is treated as a backup. */
export function verifiedCopy(db:Sqlite,options:{sourcePath:string;directory:string;open:OpenCopy}):VerifiedCopy{
 mkdirSync(options.directory,{recursive:true})
 const disk=statfsSync(options.directory,{bigint:true})
 const size=statSync(options.sourcePath).size+(existsSync(`${options.sourcePath}-wal`)?statSync(`${options.sourcePath}-wal`).size:0)
 if(disk.bavail*disk.bsize<BigInt(size)*2n)throw new Error('Espace disque insuffisant : deux fois la taille de la base est requis')
 const path=join(options.directory,`smlpos_preseed_${Date.now()}_${uuid7()}.db`)
 const before=rowCounts(db)
 db.prepare('VACUUM INTO ?').run(path)
 const copy=options.open(path)
 try{
  const integrity=copy.prepare('PRAGMA integrity_check').all()
  if(integrity.length!==1 || integrity[0].integrity_check!=='ok')throw new Error('La sauvegarde ne passe pas le contrôle SQLite')
  const counts=rowCounts(copy)
  // Normal synchronous use holds the JS thread throughout this operation.
  // The copy itself is consistent even when another process writes meanwhile.
  // A mismatched pre-copy count blocks installation rather than asserting safety.
  if(JSON.stringify(counts)!==JSON.stringify(before))throw new Error('La base a changé pendant la sauvegarde : recommencez')
  const result={path,sha256:hash(readFileSync(path)),counts,integrityOk:true as const}
  writeFileSync(`${path}.json`,JSON.stringify(result,null,2),{mode:0o600})
  return result
 }finally{copy.close()}
}

function verifyCertificate(certificate:VerifiedCopy,open:OpenCopy){
 if(!certificate || certificate.integrityOk!==true || hash(readFileSync(certificate.path))!==certificate.sha256)throw new Error('Sauvegarde vérifiée requise avant migration')
 const copy=open(certificate.path)
 try{if(JSON.stringify(rowCounts(copy))!==JSON.stringify(certificate.counts) || copy.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Sauvegarde de migration invalide')}
 finally{copy.close()}
}

/** Installs capture only after independently checking a backup certificate.
 * Capture and the drainer are OFF on installation. Existing IDs and money in
 * the business tables are not modified. No triggers are installed on sync_queue. */
export function installSeedStore(db:Sqlite,certificate:VerifiedCopy,open:OpenCopy,existingDeviceId?:string){
 verifyCertificate(certificate,open)
 db.exec('BEGIN IMMEDIATE')
 try{
  db.exec(`CREATE TABLE IF NOT EXISTS sync_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS seed_state(table_name TEXT PRIMARY KEY,cursor TEXT,rows_total INTEGER NOT NULL DEFAULT 0,rows_sent INTEGER NOT NULL DEFAULT 0,rows_rejected INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'PENDING',updated_at TEXT);
   CREATE TABLE IF NOT EXISTS seed_rejects(id TEXT PRIMARY KEY,table_name TEXT,row_id TEXT,reason TEXT NOT NULL,created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS outbox(op_id TEXT PRIMARY KEY,table_name TEXT NOT NULL,row_id TEXT NOT NULL,op TEXT NOT NULL CHECK(op IN ('INSERT','UPDATE','DELETE')),payload TEXT NOT NULL,created_at TEXT NOT NULL,sent_at TEXT,attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT);
   CREATE INDEX IF NOT EXISTS outbox_pending ON outbox(sent_at);
   CREATE TABLE IF NOT EXISTS stock_movements(id TEXT PRIMARY KEY,produit_id TEXT NOT NULL,delta INTEGER NOT NULL,reason TEXT NOT NULL,ref_id TEXT,device_id TEXT,created_at TEXT NOT NULL);`)
  const defaults:Record<string,string>={device_id:existingDeviceId??uuid7(),device_name:'PC principal',seed_role:'main',backend_url:'https://api.pos.sml.boutique',sync_backend:'legacy',capture_enabled:'0',applying_remote:'0',outbox_drain_enabled:'0',seed_schema_version:'2'}
  if(existingDeviceId && !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existingDeviceId))throw new Error('Identifiant appareil invalide')
  for(const [key,value] of Object.entries(defaults))db.prepare('INSERT OR IGNORE INTO sync_meta(key,value) VALUES(?,?)').run(key,value)
  const existing=new Set(tables(db))
  for(const table of SEED_TABLES){
   if(!existing.has(table))throw new Error(`Table métier manquante : ${table}`)
   const names=new Set(columns(db,table).map(column=>column.name))
   for(const column of ['updated_at','deleted_at','device_id'])if(!names.has(column))db.exec(`ALTER TABLE ${quote(table)} ADD COLUMN ${quote(column)} TEXT`)
   if(names.has('numero') && !names.has('numero_legacy_device'))db.exec(`ALTER TABLE ${quote(table)} ADD COLUMN numero_legacy_device TEXT`)
   const all=columns(db,table).map(column=>column.name)
   const id=table==='app_settings'?'key':'id'
   const active="COALESCE((SELECT value FROM sync_meta WHERE key='capture_enabled'),'0')='1' AND COALESCE((SELECT value FROM sync_meta WHERE key='applying_remote'),'0')='0'"
   // Reference settings are filtered by an explicit local key set at export.
   // Capture also stays local, so a new private setting can never leak merely
   // because it was not known when this trigger was generated.
   for(const operation of ['INSERT','UPDATE','DELETE']){
    const row=operation==='DELETE'?'OLD':'NEW'
    const json=`json_object(${all.flatMap(column=>[`'${column}'`,`${row}.${quote(column)}`]).join(',')})`
    db.exec(`CREATE TRIGGER IF NOT EXISTS ${quote(`sync2_${table}_${operation.toLowerCase()}`)} AFTER ${operation} ON ${quote(table)} WHEN ${active} BEGIN
     INSERT INTO outbox(op_id,table_name,row_id,op,payload,created_at) VALUES(lower(hex(randomblob(16))),'${table}',${row}.${quote(id)},'${operation}',${json},strftime('%Y-%m-%dT%H:%M:%fZ','now'));
    END;`)
   }
  }
  // Capture stock deltas at the same SQLite transaction boundary as the
  // existing mutable stock cache. Other device pulls must set applying_remote.
  const stamp="printf('%012x',CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))"
  const movementId=`lower(substr(${stamp},1,8)||'-'||substr(${stamp},9,4)||'-7'||substr(hex(randomblob(2)),2,3)||'-'||substr('89ab',abs(random()%4)+1,1)||substr(hex(randomblob(2)),2,3)||'-'||hex(randomblob(6)))`
  db.exec(`CREATE TRIGGER IF NOT EXISTS sync2_stock_delta AFTER UPDATE OF stock_actuel ON produits
   WHEN NEW.stock_actuel IS NOT OLD.stock_actuel AND COALESCE((SELECT value FROM sync_meta WHERE key='capture_enabled'),'0')='1' AND COALESCE((SELECT value FROM sync_meta WHERE key='applying_remote'),'0')='0'
   BEGIN INSERT INTO stock_movements(id,produit_id,delta,reason,ref_id,device_id,created_at) VALUES(${movementId},NEW.id,COALESCE(NEW.stock_actuel,0)-COALESCE(OLD.stock_actuel,0),'LOCAL_CHANGE',NEW.id,(SELECT value FROM sync_meta WHERE key='device_id'),strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;`)
  db.exec(`CREATE TRIGGER IF NOT EXISTS sync2_stock_initial AFTER INSERT ON produits
   WHEN COALESCE(NEW.stock_actuel,0)<>0 AND COALESCE((SELECT value FROM sync_meta WHERE key='capture_enabled'),'0')='1' AND COALESCE((SELECT value FROM sync_meta WHERE key='applying_remote'),'0')='0'
   BEGIN INSERT INTO stock_movements(id,produit_id,delta,reason,ref_id,device_id,created_at) VALUES(${movementId},NEW.id,NEW.stock_actuel,'LOCAL_INITIAL_STOCK',NEW.id,(SELECT value FROM sync_meta WHERE key='device_id'),strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;`)
  db.exec('COMMIT')
 }catch(error){db.exec('ROLLBACK');throw error}
}

export function beginSeedSnapshot(db:Sqlite,options:{sourcePath:string;directory:string;open:OpenCopy}){
 if(meta(db,'seed_complete_at'))throw new Error('Ce poste a déjà terminé son import initial')
 if(meta(db,'seed_snapshot_path'))throw new Error('Une préparation existe déjà : reprenez-la ou annulez-la explicitement')
 if(!meta(db,'device_id'))throw new Error('Migration de préparation non installée')
 // Every change from this point is captured. The fence is read INSIDE the
 // snapshot, so concurrent commits cannot fall into a snapshot/outbox gap.
 setMeta(db,'capture_enabled','1')
 const snapshot=verifiedCopy(db,options)
 const copy=options.open(snapshot.path)
 let fence:number
 try{fence=Number(copy.prepare('SELECT COALESCE(max(rowid),0) n FROM outbox').get().n)}finally{copy.close()}
 db.exec('BEGIN IMMEDIATE')
 try{
  setMeta(db,'seed_snapshot_path',resolve(snapshot.path));setMeta(db,'seed_snapshot_sha256',snapshot.sha256);setMeta(db,'seed_snapshot_fence',String(fence));setMeta(db,'seed_status','BACKUP_COMPLETE')
  for(const table of SEED_TABLES)db.prepare('INSERT OR IGNORE INTO seed_state(table_name,rows_total,updated_at) VALUES(?,?,?)').run(table,snapshot.counts[table]??0,new Date().toISOString())
  db.exec('COMMIT')
 }catch(error){db.exec('ROLLBACK');throw error}
 return {...snapshot,fence}
}

export function archiveLegacyQueue(db:Sqlite,directory:string){
 mkdirSync(directory,{recursive:true})
 const path=join(directory,`legacy-sync-queue-${Date.now()}-${uuid7()}.json`)
 writeFileSync(path,JSON.stringify(db.prepare('SELECT * FROM sync_queue ORDER BY rowid').all()),{mode:0o600})
 return path
}

/** Export filtering is repeated at the transport boundary; outbox data stays
 * on this computer until there is an implemented, verified cut-over. */
export function pendingDelta(db:Sqlite,limit=500){
 if(!Number.isSafeInteger(limit) || limit<1 || limit>500)throw new Error('Invalid batch limit')
 const fence=Number(meta(db,'seed_snapshot_fence')??0)
 return db.prepare('SELECT rowid local_seq,* FROM outbox WHERE rowid>? AND sent_at IS NULL ORDER BY rowid LIMIT ?').all(fence,limit).filter(row=>row.table_name!=='app_settings'||!localSetting(String(row.row_id)))
}


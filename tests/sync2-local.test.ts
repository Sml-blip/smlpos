import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync,readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { archiveLegacyQueue,beginSeedSnapshot,installSeedStore,meta,pendingDelta,setMeta,uuid7,verifiedCopy } from '../src/main/seed/localStore.ts'
import type { Sqlite } from '../src/main/seed/localStore.ts'
const schema=JSON.parse(readFileSync(new URL('../docs/data-audit/source-inventory.json',import.meta.url),'utf8'))
const open=(path:string)=>new DatabaseSync(path) as unknown as Sqlite
test('verified backup precedes additive migration; snapshot fence retains 20 sales across three database restarts',()=>{
 const directory=mkdtempSync(join(tmpdir(),'smlpos-sync2-fixture-'));const path=join(directory,'synthetic.db');let db=open(path)
 try{
  for(const table of schema.tables)db.exec(table.ddl)
  db.exec("INSERT INTO produits(id,reference,nom,prix_vente,stock_actuel) VALUES('legacy-product','LEGACY','Synthetic',12.345,100); INSERT INTO operateurs(id,nom,identifiant) VALUES('op-hamdi','Fixture','fixture');")
  const before=db.prepare("SELECT id,reference,prix_vente,stock_actuel FROM produits").get()
  const backup=verifiedCopy(db,{sourcePath:path,directory,open})
  assert.throws(()=>installSeedStore(db,{...backup,sha256:'0'.repeat(64)},open),/Sauvegarde/)
  installSeedStore(db,backup,open)
  const device=meta(db,'device_id');assert.match(device!,/^[\da-f-]{14}7[\da-f-]+$/)
  assert.deepEqual({...db.prepare('SELECT id,reference,prix_vente,stock_actuel FROM produits').get()},{...before})
  assert.equal(meta(db,'sync_backend'),'legacy');assert.equal(meta(db,'outbox_drain_enabled'),'0')
  installSeedStore(db,backup,open);assert.equal(meta(db,'device_id'),device)
  const sale=(number:number)=>{
   db.exec('BEGIN');try{const id=uuid7();db.prepare('INSERT INTO ventes(id,numero,total_ttc) VALUES(?,?,?)').run(id,`MAIN-${number}`,12.345);db.prepare('INSERT INTO lignes_vente(id,vente_id,produit_id,designation,quantite,prix_unitaire,total_ligne) VALUES(?,?,?,?,?,?,?)').run(uuid7(),id,'legacy-product','Synthetic',1,12.345,12.345);db.prepare("UPDATE produits SET stock_actuel=stock_actuel-1 WHERE id='legacy-product'").run();db.exec('COMMIT')}catch(error){db.exec('ROLLBACK');throw error}
  }
  setMeta(db,'capture_enabled','1');sale(0)
  const snapshot=beginSeedSnapshot(db,{sourcePath:path,directory,open})
  assert.ok(snapshot.fence>0)
  for(let i=1;i<=20;i++){
   sale(i)
   if([5,11,17].includes(i)){db.close();db=open(path)}
  }
  const delta=pendingDelta(db)
  assert.equal(delta.filter(row=>row.table_name==='ventes').length,20)
  assert.equal(delta.filter(row=>row.table_name==='lignes_vente').length,20)
  assert.equal(delta.filter(row=>row.table_name==='stock_movements').length,20)
  assert.equal(new Set(delta.map(row=>row.op_id)).size,delta.length)
  const copy=open(snapshot.path)
  try{assert.equal(copy.prepare('SELECT count(*) n FROM ventes').get().n,1);assert.equal(copy.prepare("SELECT stock_actuel n FROM produits WHERE id='legacy-product'").get().n,99)}finally{copy.close()}
  assert.equal(db.prepare("SELECT stock_actuel n FROM produits WHERE id='legacy-product'").get().n,79)
  assert.equal(delta.filter(row=>row.table_name==='stock_movements').reduce((sum,row)=>sum+JSON.parse(row.payload).delta,0),-20)
  db.prepare("INSERT INTO app_settings(key,value) VALUES('r2_secret_access_key','fixture-secret')").run()
  assert.equal(pendingDelta(db).some(row=>row.table_name==='app_settings'&&row.row_id==='r2_secret_access_key'),false)
  const count=db.prepare('SELECT count(*) n FROM outbox').get().n
  setMeta(db,'applying_remote','1');db.prepare("UPDATE produits SET stock_actuel=78 WHERE id='legacy-product'").run();setMeta(db,'applying_remote','0')
  assert.equal(db.prepare('SELECT count(*) n FROM outbox').get().n,count)
  const queuePath=archiveLegacyQueue(db,directory);assert.deepEqual(JSON.parse(readFileSync(queuePath,'utf8')),[])
 }finally{db.close()}
})


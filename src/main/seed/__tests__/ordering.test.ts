import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { SeedService } from '../service'
import { SeedLedger } from '../ledger'
import { MockBackend } from './mockBackend'
import { COUNTER_COLUMNS, moneyColumnsOf, primaryKeyOf, syncedTableNames, toMillimes } from '../tables'
import { canDrainOutbox, captureState, pendingLiveRows } from '../gate'
import { verifyBackupFile } from '../snapshot'

function setup() {
  const directory=mkdtempSync(join(tmpdir(),'sml-step2-')),db=new Database(join(directory,'synthetic.db'))
  const source=readFileSync(resolve('src/main/db.ts'),'utf8')
  for(const match of source.matchAll(/CREATE TABLE IF NOT EXISTS[\s\S]*?;/g))db.exec(match[0])
  for(const match of source.matchAll(/ALTER TABLE[^`]+/g))try{db.exec(match[0])}catch{/* already present */}
  db.exec("INSERT INTO categories(id,nom) VALUES('cat','Category'); INSERT INTO clients(id,nom) VALUES('client','Client'); INSERT INTO produits(id,reference,nom,prix_vente,stock_actuel) VALUES('p','REF','Product',12.345,100); INSERT INTO documents(id,numero,type_document,statut) VALUES('draft','DRAFT-1','DEVIS','BROUILLON')")
  const tables=Object.fromEntries(syncedTableNames((db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {name:string}[]).map(row=>row.name)).map(table=>[table,{pk:primaryKeyOf(table),columns:(db.prepare(`PRAGMA table_info("${table}")`).all() as {name:string}[]).map(column=>column.name)}]))
  const backend=new MockBackend({tables}),ledger=new SeedLedger(join(directory,'ledger.db'))
  const deps={liveDb:()=>db,ledger,archiveDir:join(directory,'archive'),secrets:{seal:(s:string)=>s,open:(s:string)=>s},appVersion:'1.9.1001',platform:'win32',legacyQueue:()=>({pending:0,failed:0}),fetchImpl:backend.fetch,sleep:async()=>{}}
  const service=new SeedService(deps)
  const close=()=>{ledger.close();db.close();assert.ok(directory.startsWith(join(tmpdir(),'sml-step2-')));rmSync(directory,{recursive:true,force:true})}
  return {db,backend,ledger,service,deps,close}
}

test('capture precedes snapshot; 20 sales, 3 returns, adjustment and deleted draft survive seed pause',async()=>{
  const f=setup()
  try {
    await f.service.registerDevice('https://mock.invalid','good-token','Fixture')
    let copies=0;const native=f.db.backup.bind(f.db)
    f.db.backup=async(path:string)=>{
      if(++copies===2){assert.ok(f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='outbox'").get());f.db.exec("UPDATE produits SET stock_actuel=95 WHERE id='p'")}
      return native(path)
    }
    await f.service.backupAndCheck()
    const protection=f.ledger.getJson<{path:string}>('migration_backup')!,snapshot=f.ledger.getJson<{path:string}>('backup')!
    const raw=new Database(protection.path,{readonly:true}),copy=new Database(snapshot.path,{readonly:true})
    try{assert.equal(raw.prepare("SELECT name FROM sqlite_master WHERE name='outbox'").get(),undefined);assert.ok(copy.prepare("SELECT name FROM sqlite_master WHERE name='outbox'").get());assert.equal((copy.prepare("SELECT stock_actuel n FROM produits WHERE id='p'").get() as {n:number}).n,95)}finally{raw.close();copy.close()}
    assert.ok(Number(captureState(f.db,'snapshot_fence'))>0);assert.equal(canDrainOutbox(f.db),false)
    await f.service.approve('SEED')
    const touched=new Set<string>();f.backend.onBatch=table=>{touched.add(table);if(touched.size===2)f.service.pause()}
    await f.service.run();assert.equal(f.ledger.state(),'paused');assert.deepEqual(pendingLiveRows(f.db),[])
    for(let i=0;i<20;i++)f.db.transaction(()=>{
      f.db.prepare('INSERT INTO ventes(id,numero,total_ttc) VALUES(?,?,?)').run(`sale-${i}`,`MAIN-${i}`,12.345)
      f.db.prepare('INSERT INTO lignes_vente(id,vente_id,produit_id,designation,quantite,prix_unitaire,total_ligne) VALUES(?,?,?,?,?,?,?)').run(`line-${i}`,`sale-${i}`,'p','Product',1,12.345,12.345)
      f.db.exec("UPDATE produits SET stock_actuel=stock_actuel-1 WHERE id='p'")
    })()
    for(let i=0;i<3;i++)f.db.transaction(()=>{
      f.db.prepare("INSERT INTO retours(id,produit_id,designation,quantite,prix_unitaire,type_retour) VALUES(?,'p','Product',1,12.345,'SANS_PROBLEME')").run(`return-${i}`)
      f.db.exec("UPDATE produits SET stock_actuel=stock_actuel+1 WHERE id='p'")
    })()
    f.db.exec("UPDATE produits SET stock_actuel=stock_actuel+5 WHERE id='p'; DELETE FROM documents WHERE id='draft'")
    assert.equal(canDrainOutbox(f.db),false);f.backend.onBatch=null;await f.service.run()
    assert.equal(f.ledger.state(),'done',f.ledger.get('message')??'');assert.equal(canDrainOutbox(f.db),true)
    const ops=pendingLiveRows(f.db,500);assert.ok(ops.length>20)
    // Direct mock projection only: the HTTP drainer is Step 3. This proves the
    // snapshot boundary and the retained delta stream without inventing a route.
    const applied=new Set<string>()
    for(const op of [...ops,...ops]){
      const key=`fixture:${op.seq}`;if(applied.has(key))continue;applied.add(key)
      const table=String(op.table_name),pk=String(op.pk),rows=f.backend.rows.get(table)??new Map<string,Record<string,unknown>>()
      f.backend.rows.set(table,rows)
      if(op.op==='DELETE'){rows.delete(pk);continue}
      const old=rows.get(pk)??{}
      if(op.op==='DELTA'){
        const field=String(op.delta_field),money=moneyColumnsOf(table).includes(field),value=money?toMillimes(op.delta_value):null
        assert.ok(!money||value?.ok);rows.set(pk,{...old,[field]:Number(old[field]??0)+(value?.ok?value.millimes:Number(op.delta_value))});continue
      }
      const row=JSON.parse(String(op.row_json)) as Record<string,unknown>
      for(const field of moneyColumnsOf(table))if(row[field]!=null){const value=toMillimes(row[field]);assert.ok(value.ok);if(value.ok)row[field]=value.millimes}
      assert.ok((COUNTER_COLUMNS[table]??[]).every(field=>!(field in row)));rows.set(pk,{...old,...row})
    }
    assert.equal(f.backend.count('ventes'),20);assert.equal(f.backend.count('retours'),3);assert.equal(f.backend.count('documents'),0)
    assert.equal([...f.backend.rows.get('ventes')!.values()].reduce((n,row)=>n+Number(row.total_ttc),0),20*12345)
    assert.equal(f.backend.rows.get('produits')!.get('p')!.stock_actuel,83)
    assert.equal((f.db.prepare("SELECT stock_actuel n FROM produits WHERE id='p'").get() as {n:number}).n,83)
    f.ledger.setState('finalizing');assert.equal(new SeedService(f.deps).canRun(),false);assert.equal(f.ledger.state(),'done')
  }finally{f.close()}
})

test('rejections keep gate closed; a verified snapshot remains valid after source deletion',async()=>{
  const f=setup()
  try {
    await f.service.registerDevice('https://mock.invalid','good-token','Fixture');await f.service.backupAndCheck();await f.service.approve('SEED')
    f.backend.rejectPks.add('p');await f.service.run();assert.equal(f.ledger.state(),'needs_review');assert.equal(canDrainOutbox(f.db),false)
    f.backend.rejectPks.clear();await f.service.run();assert.equal(canDrainOutbox(f.db),true)
    const backup=f.ledger.getJson<{path:string}>('backup')!
    f.db.exec("DELETE FROM documents WHERE id='draft'")
    assert.equal((await verifyBackupFile(backup.path,f.db)).ok,true)
    f.service.resetForNewPass();assert.equal(canDrainOutbox(f.db),false)
  }finally{f.close()}
})

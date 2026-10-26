import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { BackendClient } from '../client'
import type { LiveChange,PullPage } from '../client'
import { PullClient } from '../pull'
import { OutboxDrainer } from '../drainer'
import { installOutbox } from '../outbox'
import { captureState,openVerifiedGate,setCaptureState } from '../gate'
import { MockBackend } from './mockBackend'
import { seedProductsIfEmpty } from '../../seedProducts'
import { reserveNumber } from '../numbering'
import { prepareEmptyReplica } from '../replica'
function fixture(empty=false,shared?:MockBackend,device='dev-2') {
 const directory=mkdtempSync(join(tmpdir(),'sml-pull-')),path=join(directory,'fixture.db');let db=new Database(path)
 db.exec("CREATE TABLE categories(id TEXT PRIMARY KEY,nom TEXT UNIQUE); CREATE TABLE produits(id TEXT PRIMARY KEY,nom TEXT,reference TEXT UNIQUE,prix_vente REAL,stock_actuel INTEGER DEFAULT 0,device_id TEXT); CREATE TABLE ventes(id TEXT PRIMARY KEY,numero TEXT UNIQUE,total_ttc REAL); CREATE TABLE lignes_vente(id TEXT PRIMARY KEY,vente_id TEXT REFERENCES ventes(id),designation TEXT,total_ligne REAL); CREATE TABLE stock_movements(id TEXT PRIMARY KEY,produit_id TEXT,delta INTEGER,reason TEXT,ref_id TEXT,device_id TEXT); CREATE TABLE clients(id TEXT PRIMARY KEY,nom TEXT,solde_credit REAL,solde_fidelite REAL,device_id TEXT); INSERT INTO categories VALUES('c','Category')")
 if(!empty)db.exec("INSERT INTO produits VALUES('p','Product','P',10,100,NULL)")
 installOutbox(db);setCaptureState(db,'device_id',device);setCaptureState(db,'snapshot_hash','a'.repeat(64));setCaptureState(db,'snapshot_fence','0')
 const tables=Object.fromEntries(['categories','produits','ventes','lignes_vente','stock_movements','clients'].map(table=>[table,{pk:'id',columns:(db.prepare(`PRAGMA table_info(${table})`).all() as {name:string}[]).map(column=>column.name)}]))
 const backend=shared??new MockBackend({serverState:'seeded',tables})
 if(!shared)backend.rows.set('categories',new Map([['c',{id:'c',nom:'Category'}]]))
 if(!shared)backend.rows.set('produits',new Map([['p',{id:'p',nom:'Product',reference:'P',prix_vente:10000,stock_actuel:100}]]))
 const client=(fetchImpl=backend.fetch)=>new BackendClient({baseUrl:'https://mock.invalid',fetchImpl,maxAttempts:1,loadSession:()=>({access_token:'mock',refresh_token:'mock',expires_at:'2099-01-01T00:00:00Z'}),saveSession:()=>{}})
 return {get db(){return db},backend,client,enable:()=>openVerifiedGate(db,'b'.repeat(64),'a'.repeat(64)),reopen:()=>{db.close();db=new Database(path);db.pragma('recursive_triggers=ON')},close:()=>{db.close();assert.ok(directory.startsWith(join(tmpdir(),'sml-pull-')));rmSync(directory,{recursive:true,force:true})}}
}
const stock=(db:Database.Database)=>(db.prepare("SELECT stock_actuel n FROM produits WHERE id='p'").get() as {n:number}).n
const queued=(db:Database.Database)=>(db.prepare('SELECT count(*) n FROM outbox').get() as {n:number}).n
const delta=(seq:number):LiveChange=>({server_seq:seq,origin_device:'dev-1',table:'produits',pk:'p',op:'DELTA',field:'stock_actuel',value:-1})

test('sync2 pull metadata applies money DELTA in millimes rather than as an UPSERT',async()=>{
 const f=fixture();try{
  setCaptureState(f.db,'apply_mute','1');f.db.prepare("INSERT INTO clients VALUES('client','Client',10,2,'dev-2')").run();setCaptureState(f.db,'apply_mute','0')
  f.backend.liveSequence=1;f.backend.liveChanges=[{server_seq:1,origin_device:'dev-1',table:'clients',pk:'client',op:'DELTA',field:'solde_credit',value:-1250,row:{id:'client',nom:'Client',device_id:'dev-1'}}]
  const result=await new PullClient(f.db,f.client()).once()
  assert.equal(result.applied,1);assert.equal((f.db.prepare("SELECT solde_credit FROM clients WHERE id='client'").get() as {solde_credit:number}).solde_credit,8.75)
  assert.equal((f.db.prepare('SELECT count(*) n FROM pull_rejects').get() as {n:number}).n,0)
 }finally{f.close()}
})

test('explicit secondary-PC preparation refuses business history, locks writes until a restart-safe bootstrap completes', async () => {
 const f=fixture();try{
  f.db.exec("CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT)")
  f.backend.tableSpec.app_settings={pk:'key',columns:['key','value']}
  f.db.exec("INSERT INTO ventes VALUES('history','VTE-HISTORY',10)")
  assert.throws(()=>prepareEmptyReplica(f.db),/business history/)
  assert.equal(stock(f.db),100)
  f.db.exec("DELETE FROM ventes; DELETE FROM outbox")
  prepareEmptyReplica(f.db)
  assert.throws(()=>f.db.exec("INSERT INTO ventes VALUES('bad','VTE-BAD',10)"),/Finish joining/)
  assert.equal((f.db.prepare('SELECT count(*) n FROM produits').get() as {n:number}).n,0)
  f.reopen();assert.throws(()=>f.db.exec("INSERT INTO ventes VALUES('bad','VTE-BAD',10)"),/Finish joining/)
  await new PullClient(f.db,f.client()).bootstrap()
  assert.equal(stock(f.db),100);assert.equal(captureState(f.db,'replica_join_pending'),'0');assert.equal(queued(f.db),0)
  f.db.exec("INSERT INTO ventes VALUES('new','VTE-NEW',10)")
  assert.equal(queued(f.db),1)
 }finally{f.close()}
})

test('REPLACE delete/UPSERT across pages and restart restores counter before applying its difference', () => {
 const f=fixture();try{
  new PullClient(f.db,f.client()).applyPage({changes:[{server_seq:1,origin_device:'dev-1',table:'produits',pk:'p',op:'DELETE'}],next_seq:1,has_more:true})
  f.reopen()
  new PullClient(f.db,f.client()).applyPage({changes:[{server_seq:2,origin_device:'dev-1',table:'produits',pk:'p',op:'UPSERT',row:{id:'p',nom:'Replaced',reference:'P',prix_vente:12000}},{...delta(3),value:-2}],next_seq:3,has_more:false})
  assert.equal(stock(f.db),98);assert.equal(queued(f.db),0)
 }finally{f.close()}
})

test('two offline PCs reserve distinct sale numbers and pull all twenty sales without a UNIQUE collision', async () => {
 const a=fixture(false,undefined,'10000000-0000-4000-8000-000000000001'),b=fixture(false,a.backend,'20000000-0000-4000-8000-000000000002')
 try {
  for(const [index,pc] of [a,b].entries()){
   pc.enable();setCaptureState(pc.db,'sync_backend','vps')
   for(let sale=0;sale<10;sale++)pc.db.prepare('INSERT INTO ventes VALUES(?,?,?)').run(`pc${index}-${sale}`,reserveNumber(pc.db,'ventes','VTE-20261025-0001'),10)
   pc.reopen() // Reservation state must survive process/database restart.
   assert.match(reserveNumber(pc.db,'ventes','VTE-20261025-0001'),/-000011$/)
  }
  await new OutboxDrainer(a.db,a.client()).once();await new OutboxDrainer(b.db,b.client()).once()
  for(const pc of [a,b]){
   await new PullClient(pc.db,pc.client()).once()
   assert.equal((pc.db.prepare('SELECT count(*) n FROM ventes').get() as {n:number}).n,20)
   assert.equal((pc.db.prepare('SELECT count(*) n FROM pull_rejects').get() as {n:number}).n,0)
  }
 }finally{a.close();b.close()}
})
test('50 remote deltas produce no echo; failed cursor commit rolls back data and replay applies once',()=>{
 const f=fixture();try{
  const pull=new PullClient(f.db,f.client()),page:PullPage={changes:Array.from({length:50},(_,i)=>delta(i+1)),next_seq:50,has_more:false}
  f.db.exec("CREATE TEMP TRIGGER fail_cursor BEFORE UPDATE ON sync_state WHEN NEW.k='pull_cursor' BEGIN SELECT RAISE(ABORT,'simulated crash before commit'); END")
  assert.throws(()=>pull.applyPage(page),/simulated crash/);assert.equal(stock(f.db),100);assert.equal(captureState(f.db,'pull_cursor'),'0');assert.equal(captureState(f.db,'apply_mute'),'0')
  f.reopen();const resumed=new PullClient(f.db,f.client());assert.equal(resumed.applyPage(page).applied,50);assert.equal(stock(f.db),50)
  assert.equal(resumed.applyPage(page).skipped,50);assert.equal(stock(f.db),50);assert.equal(queued(f.db),0)
 }finally{f.close()}
})
test('one UNIQUE collision and one FK failure are quarantined while later rows advance the cursor',()=>{
 const f=fixture();try{
  const pull=new PullClient(f.db,f.client())
  const changes:LiveChange[]=Array.from({length:500},(_,i)=>({server_seq:i+1,origin_device:'dev-1',table:'produits',pk:`new-${i}`,op:'UPSERT',row:{id:`new-${i}`,nom:'Remote',reference:i===0?'P':`R${i}`,prix_vente:12345}}))
  const result=pull.applyPage({changes,next_seq:500,has_more:false});assert.equal(result.applied,499);assert.equal(result.rejected,1);assert.equal(queued(f.db),0)
  const next:LiveChange[]=[{server_seq:501,origin_device:'dev-1',table:'lignes_vente',pk:'orphan',op:'UPSERT',row:{id:'orphan',vente_id:'missing',designation:'Line',total_ligne:1000}},{server_seq:502,origin_device:'dev-1',table:'ventes',pk:'valid',op:'UPSERT',row:{id:'valid',numero:'PC1-1',total_ttc:1000}}]
  assert.equal(pull.applyPage({changes:next,next_seq:502,has_more:false}).rejected,1);assert.equal(captureState(f.db,'pull_cursor'),'502')
  assert.equal((f.db.prepare('SELECT count(*) n FROM pull_rejects').get() as {n:number}).n,2)
  assert.equal((f.db.prepare("SELECT prix_vente n FROM produits WHERE id='new-1'").get() as {n:number}).n,12.345)
 }finally{f.close()}
})
test('two offline stock changes send ledger-backed DELTAs and converge on pull',async()=>{
 const a=fixture(false,undefined,'dev-1'),b=fixture(false,a.backend,'dev-2');try{
  a.enable();b.enable();a.db.exec("UPDATE produits SET stock_actuel=98 WHERE id='p'");b.db.exec("UPDATE produits SET stock_actuel=97 WHERE id='p'")
  a.backend.deviceId='dev-1';const da=await new OutboxDrainer(a.db,a.client()).once()
  a.backend.deviceId='dev-2';const db=await new OutboxDrainer(b.db,b.client()).once()
  assert.equal(da.applied,2);assert.equal(da.rejected,0);assert.equal(db.applied,2);assert.equal(db.rejected,0)
  assert.equal(a.backend.rows.get('produits')!.get('p')!.stock_actuel,95)
  await new PullClient(a.db,a.client()).once();await new PullClient(b.db,b.client()).once()
  assert.equal(stock(a.db),95);assert.equal(stock(b.db),95);assert.equal(queued(a.db),0);assert.equal(queued(b.db),0)
 }finally{a.close();b.close()}
})
test('remote state overrides an unsent edit; its later own echo restores the winning server state',async()=>{
 const f=fixture();try{
  f.enable();f.db.exec("UPDATE categories SET nom='Local' WHERE id='c'")
  await f.client().pushLive('dev-1',[{seq:1,table:'categories',pk:'c',op:'UPSERT',row:{id:'c',nom:'Remote'},at:'2020-01-01T00:00:00Z'}])
  const pull=new PullClient(f.db,f.client());await pull.once();assert.equal((f.db.prepare("SELECT nom FROM categories WHERE id='c'").get() as {nom:string}).nom,'Remote')
  await new OutboxDrainer(f.db,f.client()).once();await pull.once();assert.equal((f.db.prepare("SELECT nom FROM categories WHERE id='c'").get() as {nom:string}).nom,'Local');assert.equal(queued(f.db),1)
  await f.client().pushLive('dev-1',[{seq:2,table:'categories',pk:'c',op:'DELETE',at:'2020-01-01T00:00:00Z'}]);await pull.once();assert.equal(f.db.prepare("SELECT id FROM categories WHERE id='c'").get(),undefined);assert.equal(queued(f.db),1)
 }finally{f.close()}
})
test('bootstrap pulls the activated snapshot from sequence zero',async()=>{
 const f=fixture(true);try{
  const pull=new PullClient(f.db,f.client());await pull.bootstrap();assert.equal(stock(f.db),100);assert.equal(captureState(f.db,'pull_cursor'),'1');assert.equal(queued(f.db),0)
 }finally{f.close()}
})
test('a 600-row bootstrap resumes after a failed page without duplicate or echo rows',async()=>{
 const f=fixture(true);try{
  f.backend.rows.set('produits',new Map(Array.from({length:600},(_,i)=>{const id=`p${String(i).padStart(4,'0')}`;return [id,{id,nom:'Remote',reference:`R${i}`,prix_vente:10000,stock_actuel:1}]})))
  const broken:typeof fetch=async(input,init)=>{const url=new URL(String(input));if(url.pathname==='/sync2/pull'&&Number(url.searchParams.get('since'))>0)throw new TypeError('connection lost');return f.backend.fetch(input,init)}
  await assert.rejects(new PullClient(f.db,f.client(broken)).bootstrap(),/connection lost/);assert.equal((f.db.prepare('SELECT count(*) n FROM produits').get() as {n:number}).n,500)
  f.reopen();await new PullClient(f.db,f.client()).bootstrap();assert.equal((f.db.prepare('SELECT count(*) n FROM produits').get() as {n:number}).n,600);assert.equal(queued(f.db),0);assert.equal(captureState(f.db,'bootstrap_complete'),'1')
 }finally{f.close()}
})
test('an interrupted join never repopulates the bundled catalog on restart',()=>{
 const f=fixture(true);try{
  setCaptureState(f.db,'bootstrap_tables','["produits"]');f.reopen();seedProductsIfEmpty(f.db)
  assert.equal((f.db.prepare('SELECT count(*) n FROM produits').get() as {n:number}).n,0);assert.equal(queued(f.db),0)
 }finally{f.close()}
})

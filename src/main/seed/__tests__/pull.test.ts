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
function fixture(empty=false,shared?:MockBackend,device='dev-2') {
 const directory=mkdtempSync(join(tmpdir(),'sml-pull-')),path=join(directory,'fixture.db');let db=new Database(path)
 db.exec('CREATE TABLE categories(id TEXT PRIMARY KEY,nom TEXT UNIQUE); CREATE TABLE produits(id TEXT PRIMARY KEY,nom TEXT,reference TEXT UNIQUE,prix_vente REAL,stock_actuel INTEGER DEFAULT 0); CREATE TABLE ventes(id TEXT PRIMARY KEY,numero TEXT UNIQUE,total_ttc REAL); CREATE TABLE lignes_vente(id TEXT PRIMARY KEY,vente_id TEXT REFERENCES ventes(id),designation TEXT,total_ligne REAL)')
 if(!empty)db.exec("INSERT INTO produits VALUES('p','Product','P',10,100)")
 installOutbox(db);setCaptureState(db,'device_id',device);setCaptureState(db,'snapshot_hash','a'.repeat(64));setCaptureState(db,'snapshot_fence','0')
 const tables=Object.fromEntries(['categories','produits','ventes','lignes_vente'].map(table=>[table,{pk:'id',columns:(db.prepare(`PRAGMA table_info(${table})`).all() as {name:string}[]).map(column=>column.name)}]))
 const backend=shared??new MockBackend({serverState:'seeded',tables})
 if(!shared)backend.rows.set('produits',new Map([['p',{id:'p',nom:'Product',reference:'P',prix_vente:10000,stock_actuel:100}]]))
 const client=(fetchImpl=backend.fetch)=>new BackendClient({baseUrl:'https://mock.invalid',fetchImpl,maxAttempts:1,loadSession:()=>({access_token:'mock',refresh_token:'mock',expires_at:'2099-01-01T00:00:00Z'}),saveSession:()=>{}})
 return {get db(){return db},backend,client,enable:()=>openVerifiedGate(db,'b'.repeat(64),'a'.repeat(64)),reopen:()=>{db.close();db=new Database(path);db.pragma('recursive_triggers=ON')},close:()=>{db.close();assert.ok(directory.startsWith(join(tmpdir(),'sml-pull-')));rmSync(directory,{recursive:true,force:true})}}
}
const stock=(db:Database.Database)=>(db.prepare("SELECT stock_actuel n FROM produits WHERE id='p'").get() as {n:number}).n
const queued=(db:Database.Database)=>(db.prepare('SELECT count(*) n FROM outbox').get() as {n:number}).n
const delta=(seq:number):LiveChange=>({server_seq:seq,origin_device:'dev-1',table:'produits',pk:'p',op:'DELTA',field:'stock_actuel',value:-1})
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
test('two offline devices converge to opening minus five with no pull echo',async()=>{
 const a=fixture(false,undefined,'dev-1'),b=fixture(false,a.backend,'dev-2');try{
  a.enable();b.enable();a.db.exec("UPDATE produits SET stock_actuel=98 WHERE id='p'");b.db.exec("UPDATE produits SET stock_actuel=97 WHERE id='p'")
  await new OutboxDrainer(a.db,a.client()).once();await new OutboxDrainer(b.db,b.client()).once()
  await new PullClient(a.db,a.client()).once();await new PullClient(b.db,b.client()).once()
  assert.equal(stock(a.db),95);assert.equal(stock(b.db),95);assert.equal(a.backend.rows.get('produits')!.get('p')!.stock_actuel,95);assert.equal(queued(a.db),2);assert.equal(queued(b.db),2)
 }finally{a.close();b.close()}
})
test('remote state overrides an unsent edit; its later own echo restores the winning server state',async()=>{
 const f=fixture();try{
  f.enable();f.db.exec("UPDATE produits SET prix_vente=12 WHERE id='p'")
  await f.client().pushLive('dev-1',[{seq:1,table:'produits',pk:'p',op:'UPSERT',row:{id:'p',nom:'Product',reference:'P',prix_vente:14000},at:'2020-01-01T00:00:00Z'}])
  const pull=new PullClient(f.db,f.client());await pull.once();assert.equal((f.db.prepare("SELECT prix_vente n FROM produits WHERE id='p'").get() as {n:number}).n,14)
  await new OutboxDrainer(f.db,f.client()).once();await pull.once();assert.equal((f.db.prepare("SELECT prix_vente n FROM produits WHERE id='p'").get() as {n:number}).n,12);assert.equal(queued(f.db),1)
  await f.client().pushLive('dev-1',[{seq:2,table:'produits',pk:'p',op:'DELETE',at:'2020-01-01T00:00:00Z'}]);await pull.once();assert.equal(f.db.prepare("SELECT id FROM produits WHERE id='p'").get(),undefined);assert.equal(queued(f.db),1)
 }finally{f.close()}
})
test('bootstrap pins one snapshot while a new sale arrives, then pull catches up',async()=>{
 const f=fixture(true);try{
  let changed=false;f.backend.onBootstrapPage=async()=>{if(!changed){changed=true;await f.client().pushLive('dev-1',[{seq:1,table:'produits',pk:'p',op:'DELTA',field:'stock_actuel',value:-1,at:'2026-10-25T00:00:00Z'}])}}
  const pull=new PullClient(f.db,f.client());await pull.bootstrap();assert.equal(stock(f.db),100);assert.equal(captureState(f.db,'pull_cursor'),'0');assert.equal(queued(f.db),0)
  await pull.once();assert.equal(stock(f.db),99);assert.equal(captureState(f.db,'pull_cursor'),'1');assert.equal(queued(f.db),0)
 }finally{f.close()}
})
test('a 600-row bootstrap resumes after a failed page without duplicate or echo rows',async()=>{
 const f=fixture(true);try{
  f.backend.rows.set('produits',new Map(Array.from({length:600},(_,i)=>{const id=`p${String(i).padStart(4,'0')}`;return [id,{id,nom:'Remote',reference:`R${i}`,prix_vente:10000,stock_actuel:1}]})))
  const broken:typeof fetch=async(input,init)=>{const url=new URL(String(input));if(url.pathname==='/v1/sync/bootstrap'&&url.searchParams.get('table')==='produits'&&url.searchParams.get('after'))throw new TypeError('connection lost');return f.backend.fetch(input,init)}
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

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { BackendClient } from '../client'
import { OutboxDrainer } from '../drainer'
import { installOutbox } from '../outbox'
import { openVerifiedGate,setCaptureState } from '../gate'
import { MockBackend } from './mockBackend'

function fixture() {
  const directory=mkdtempSync(join(tmpdir(),'sml-drainer-')),path=join(directory,'synthetic.db');let db=new Database(path),time=1_000_000
  db.exec("CREATE TABLE categories(id TEXT PRIMARY KEY,nom TEXT); INSERT INTO categories VALUES('c','Category'); CREATE TABLE produits(id TEXT PRIMARY KEY,nom TEXT,reference TEXT,prix_vente REAL,stock_actuel INTEGER); INSERT INTO produits VALUES('p','Product','P',10,10); CREATE TABLE clients(id TEXT PRIMARY KEY,nom TEXT,solde_credit REAL,solde_fidelite REAL); INSERT INTO clients VALUES('client','Client',10,2)")
  installOutbox(db);setCaptureState(db,'device_id','dev-1');setCaptureState(db,'snapshot_hash','a'.repeat(64));setCaptureState(db,'snapshot_fence','0')
  const backend=new MockBackend({serverState:'seeded',tables:{categories:{pk:'id',columns:['id','nom']},produits:{pk:'id',columns:['id','nom','reference','prix_vente','stock_actuel']},clients:{pk:'id',columns:['id','nom','solde_credit','solde_fidelite']}}})
  backend.rows.set('categories',new Map([['c',{id:'c',nom:'Category'}]]))
  backend.rows.set('produits',new Map([['p',{id:'p',nom:'Product',reference:'P',prix_vente:10000,stock_actuel:10}]]))
  backend.rows.set('clients',new Map([['client',{id:'client',nom:'Client',solde_credit:10000,solde_fidelite:2000}]]))
  const client=(fetchImpl=backend.fetch)=>new BackendClient({baseUrl:'https://mock.invalid',fetchImpl,maxAttempts:1,sleep:async()=>{},loadSession:()=>({access_token:'mock',refresh_token:'mock',expires_at:'2099-01-01T00:00:00Z'}),saveSession:()=>{}})
  return {get db(){return db},backend,client,clock:()=>time,advance:()=>{time+=100_000},
    enable:()=>openVerifiedGate(db,'b'.repeat(64),'a'.repeat(64)),
    reopen:()=>{db.close();db=new Database(path);db.pragma('recursive_triggers=ON')},
    close:()=>{db.close();assert.ok(directory.startsWith(join(tmpdir(),'sml-drainer-')));rmSync(directory,{recursive:true,force:true})}}
}
test('seed gate prevents requests; allowlisted stock DELTA and product UPSERT are sent',async()=>{
 const f=fixture();try{
  f.db.exec("UPDATE categories SET nom='Changed' WHERE id='c'; UPDATE produits SET stock_actuel=8 WHERE id='p'; UPDATE categories SET nom='Category' WHERE id='c'")
  const drainer=new OutboxDrainer(f.db,f.client(),f.clock)
  assert.equal((await drainer.once()).gated,true);assert.equal(f.backend.calls.length,0)
  f.enable();const result=await drainer.once();assert.equal(result.applied,3);assert.equal(result.rejected,0)
  assert.equal(f.backend.rows.get('categories')!.get('c')!.nom,'Category')
  assert.equal(f.backend.rows.get('produits')!.get('p')!.stock_actuel,8)
  assert.equal(f.backend.liveSeen.size,3);assert.equal((f.db.prepare('SELECT count(*) n FROM outbox WHERE sent_at IS NULL').get() as {n:number}).n,0)
  const sent=f.backend.pushBatches.at(-1)!.ops
  assert.ok(sent.some(op=>op.table==='produits'&&op.op==='DELTA'&&op.field==='stock_actuel'&&op.value===-2&&!('payload' in op)))
  assert.ok(sent.some(op=>op.table==='produits'&&op.op==='INSERT'&& !('stock_actuel' in (op.payload as Record<string,unknown>))))
 }finally{f.close()}
})
test('money counter is sent as integer millime DELTA, never as an absolute UPSERT',async()=>{
 const f=fixture();try{
  f.enable();f.db.exec("UPDATE clients SET solde_credit=12.345 WHERE id='client'")
  const result=await new OutboxDrainer(f.db,f.client(),f.clock).once()
  assert.equal(result.applied,2);assert.equal(result.rejected,0)
  const sent=f.backend.pushBatches.at(-1)!.ops
  assert.ok(sent.some(op=>op.table==='clients'&&op.op==='DELTA'&&op.field==='solde_credit'&&op.value===2345&&!('payload' in op)))
  assert.ok(sent.some(op=>op.table==='clients'&&op.op==='INSERT'&&!('solde_credit' in (op.payload as Record<string,unknown>))))
  assert.equal(f.backend.rows.get('clients')!.get('client')!.solde_credit,12345)
 }finally{f.close()}
})
test('five lost acknowledgements and database restarts resend the same sequence without duplication',async()=>{
 const f=fixture();try{
  f.enable()
  for(let point=0;point<5;point++){
   f.db.prepare("UPDATE categories SET nom=? WHERE id='c'").run(`Category ${point}`)
   f.backend.dropPushResponses=1
   const lost=await new OutboxDrainer(f.db,f.client(),f.clock).once();assert.ok(lost.error)
   assert.equal((f.db.prepare('SELECT count(*) n FROM outbox WHERE sent_at IS NULL').get() as {n:number}).n,1)
   const seen=f.backend.liveSeen.size,requests=f.backend.calls.length
   assert.ok((await new OutboxDrainer(f.db,f.client(),f.clock).once()).retryAt);assert.equal(f.backend.calls.length,requests)
   f.reopen();f.advance()
   const resumed=await new OutboxDrainer(f.db,f.client(),f.clock).once();assert.equal(resumed.duplicates,1);assert.equal(f.backend.liveSeen.size,seen)
  }
  assert.equal(f.backend.liveSeen.size,5);assert.equal(f.backend.rows.get('categories')!.get('c')!.nom,'Category 4')
 }finally{f.close()}
})
test('a rejected operation remains visible and does not block the next page',async()=>{
 const f=fixture();try{
  f.enable();f.backend.rejectPks.add('bad');f.db.exec("INSERT INTO categories VALUES('bad','Bad')")
  for(let i=0;i<205;i++)f.db.prepare("UPDATE categories SET nom=? WHERE id='c'").run(`Category ${i}`)
  const drainer=new OutboxDrainer(f.db,f.client(),f.clock)
  const first=await drainer.once();assert.equal(first.rejected,1);assert.equal(first.applied,199)
  assert.equal((await drainer.once()).applied,6)
  const bad=f.db.prepare("SELECT sent_at,last_error FROM outbox WHERE pk='bad'").get() as {sent_at:string|null;last_error:string}
  assert.equal(bad.sent_at,null);assert.match(bad.last_error,/^rejected:/)
  assert.equal(f.backend.rows.get('categories')!.get('c')!.nom,'Category 204')
 }finally{f.close()}
})
test('incomplete ACKs acknowledge nothing; a later valid reply recovers through duplicate receipts',async()=>{
 const f=fixture();try{
  f.enable();f.db.exec("UPDATE categories SET nom='Changed' WHERE id='c'")
  const broken:typeof fetch=async(input,init)=>{const response=await f.backend.fetch(input,init);if(String(input).endsWith('/sync2/push'))return new Response(JSON.stringify({results:[],server_seq:f.backend.liveSequence}),{status:200});return response}
  assert.ok((await new OutboxDrainer(f.db,f.client(broken),f.clock).once()).error)
  assert.equal((f.db.prepare('SELECT sent_at FROM outbox').get() as {sent_at:unknown}).sent_at,null)
  f.advance();assert.equal((await new OutboxDrainer(f.db,f.client(),f.clock).once()).duplicates,1)
 }finally{f.close()}
})

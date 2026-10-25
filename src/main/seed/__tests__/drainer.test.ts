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
  db.exec("CREATE TABLE produits(id TEXT PRIMARY KEY,nom TEXT,reference TEXT,prix_vente REAL,stock_actuel INTEGER); INSERT INTO produits VALUES('p','Product','P',10,10)")
  installOutbox(db);setCaptureState(db,'device_id','dev-1');setCaptureState(db,'snapshot_hash','a'.repeat(64));setCaptureState(db,'snapshot_fence','0')
  const backend=new MockBackend({serverState:'seeded',tables:{produits:{pk:'id',columns:['id','nom','reference','prix_vente','stock_actuel']}}})
  backend.rows.set('produits',new Map([['p',{id:'p',nom:'Product',reference:'P',prix_vente:10000,stock_actuel:10}]]))
  const client=(fetchImpl=backend.fetch)=>new BackendClient({baseUrl:'https://mock.invalid',fetchImpl,maxAttempts:1,sleep:async()=>{},loadSession:()=>({access_token:'mock',refresh_token:'mock',expires_at:'2099-01-01T00:00:00Z'}),saveSession:()=>{}})
  return {get db(){return db},backend,client,clock:()=>time,advance:()=>{time+=100_000},
    enable:()=>openVerifiedGate(db,'b'.repeat(64),'a'.repeat(64)),
    reopen:()=>{db.close();db=new Database(path);db.pragma('recursive_triggers=ON')},
    close:()=>{db.close();assert.ok(directory.startsWith(join(tmpdir(),'sml-drainer-')));rmSync(directory,{recursive:true,force:true})}}
}
test('seed gate prevents requests; A→B→A and counter deltas apply in sequence, in millimes',async()=>{
 const f=fixture();try{
  f.db.exec("UPDATE produits SET prix_vente=12,stock_actuel=8 WHERE id='p'; UPDATE produits SET prix_vente=10,stock_actuel=7 WHERE id='p'")
  const drainer=new OutboxDrainer(f.db,f.client(),f.clock)
  assert.equal((await drainer.once()).gated,true);assert.equal(f.backend.calls.length,0)
  f.enable();const result=await drainer.once();assert.equal(result.applied,4)
  assert.equal(f.backend.rows.get('produits')!.get('p')!.prix_vente,10000);assert.equal(f.backend.rows.get('produits')!.get('p')!.stock_actuel,7)
  assert.equal(f.backend.liveSeen.size,4);assert.equal((f.db.prepare('SELECT count(*) n FROM outbox WHERE sent_at IS NULL').get() as {n:number}).n,0)
 }finally{f.close()}
})
test('five lost acknowledgements and database restarts resend the same sequence without duplication',async()=>{
 const f=fixture();try{
  f.enable()
  for(let point=0;point<5;point++){
   f.db.prepare("UPDATE produits SET prix_vente=? WHERE id='p'").run(20+point)
   f.backend.dropPushResponses=1
   const lost=await new OutboxDrainer(f.db,f.client(),f.clock).once();assert.ok(lost.error)
   assert.equal((f.db.prepare('SELECT count(*) n FROM outbox WHERE sent_at IS NULL').get() as {n:number}).n,1)
   const seen=f.backend.liveSeen.size,requests=f.backend.calls.length
   assert.ok((await new OutboxDrainer(f.db,f.client(),f.clock).once()).retryAt);assert.equal(f.backend.calls.length,requests)
   f.reopen();f.advance()
   const resumed=await new OutboxDrainer(f.db,f.client(),f.clock).once();assert.equal(resumed.duplicates,1);assert.equal(f.backend.liveSeen.size,seen)
  }
  assert.equal(f.backend.liveSeen.size,5);assert.equal(f.backend.rows.get('produits')!.get('p')!.prix_vente,24000)
 }finally{f.close()}
})
test('a rejected operation remains visible and does not block the next page',async()=>{
 const f=fixture();try{
  f.enable();f.backend.rejectPks.add('bad');f.db.exec("INSERT INTO produits VALUES('bad','Bad','BAD',10,0)")
  for(let i=0;i<205;i++)f.db.prepare("UPDATE produits SET prix_vente=? WHERE id='p'").run(100+i)
  const drainer=new OutboxDrainer(f.db,f.client(),f.clock)
  const first=await drainer.once();assert.equal(first.rejected,1);assert.equal(first.applied,199)
  assert.equal((await drainer.once()).applied,6)
  const bad=f.db.prepare("SELECT sent_at,last_error FROM outbox WHERE pk='bad'").get() as {sent_at:string|null;last_error:string}
  assert.equal(bad.sent_at,null);assert.match(bad.last_error,/^rejected:/)
  assert.equal(f.backend.rows.get('produits')!.get('p')!.prix_vente,304000)
 }finally{f.close()}
})
test('incomplete ACKs acknowledge nothing; a later valid reply recovers through duplicate receipts',async()=>{
 const f=fixture();try{
  f.enable();f.db.exec("UPDATE produits SET prix_vente=11 WHERE id='p'")
  const broken:typeof fetch=async(input,init)=>{const response=await f.backend.fetch(input,init);if(String(input).endsWith('/v1/sync/push'))return new Response(JSON.stringify({results:[],server_seq:f.backend.liveSequence}),{status:200});return response}
  assert.ok((await new OutboxDrainer(f.db,f.client(broken),f.clock).once()).error)
  assert.equal((f.db.prepare('SELECT sent_at FROM outbox').get() as {sent_at:unknown}).sent_at,null)
  f.advance();assert.equal((await new OutboxDrainer(f.db,f.client(),f.clock).once()).duplicates,1)
 }finally{f.close()}
})

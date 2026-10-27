import assert from 'node:assert/strict'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { connectDatabase, initDatabase, closeDatabase } from '../../src/main/db'
import { SeedService } from '../../src/main/seed/service'
import { SeedLedger } from '../../src/main/seed/ledger'
import { captureState, setCaptureState } from '../../src/main/seed/gate'
import { liveIssues } from '../../src/main/seed/monitor'
import { generateWorkload } from './workload.mjs'

async function main(){
 const baseUrl=process.env.SMLPOS_PROOF_URL!,password=process.env.SMLPOS_PROOF_PASSWORD!,root=process.env.SMLSEED_TMP!
 assert.equal(new URL(baseUrl).hostname,'127.0.0.1')
 const source=connectDatabase();initDatabase()
 const replicaPath=join(root,'replica.db');await source.backup(replicaPath)
 let replica=new Database(replicaPath);replica.pragma('foreign_keys=ON');replica.pragma('recursive_triggers=ON')
 const ledgers:SeedLedger[]=[]
 const service=(db:()=>Database.Database,name:string,fetchImpl:typeof fetch=fetch)=>{
  const ledger=new SeedLedger(join(root,name+'.ledger.db'));ledgers.push(ledger)
  return new SeedService({liveDb:db,ledger,archiveDir:join(root,name+'-backups'),secrets:{seal:()=>null,open:()=>null},appVersion:'1.9.1039',platform:'win32',legacyQueue:()=>({pending:0,failed:0}),fetchImpl,sleep:async()=>{}})
 }
 let lostAck=false,interruptReplica=false,duplicateNext=false,seedAbort=true,pullAborts=0,reordered=0
 let delayedReplay: {input: Parameters<typeof fetch>[0]; init?: Parameters<typeof fetch>[1]} | null=null
 const sourceFetch:typeof fetch=async(input,init)=>{
  const controller=new AbortController()
  if(init?.signal){if(init.signal.aborted)controller.abort();else init.signal.addEventListener('abort',()=>controller.abort(),{once:true})}
  const response=await fetch(input,{...init,signal:controller.signal})
  if(seedAbort && new URL(String(input)).pathname==='/sync2/seed/batch' && response.ok){
   seedAbort=false;controller.abort();return response
  }
  if(delayedReplay&&new URL(String(input)).pathname==='/sync2/push'){
   const previous=delayedReplay;delayedReplay=null
   const replay=await fetch(previous.input,previous.init);assert.equal(replay.status,200,'delayed push replay failed');reordered++
  }
  if(duplicateNext&&new URL(String(input)).pathname==='/sync2/push'){
   duplicateNext=false
   delayedReplay={input,init}
  }
  if(lostAck&&new URL(String(input)).pathname==='/sync2/push'){lostAck=false;controller.abort();return response}
  return response
 }
 const replicaFetch:typeof fetch=async(input,init)=>{
  const url=new URL(String(input))
  const controller=new AbortController()
  if(init?.signal){if(init.signal.aborted)controller.abort();else init.signal.addEventListener('abort',()=>controller.abort(),{once:true})}
  const response=await fetch(input,{...init,signal:controller.signal})
  if(interruptReplica&&url.pathname==='/sync2/pull'&&Number(url.searchParams.get('since'))>0){
   const chunk=await response.body!.getReader().read();const bytes=chunk.value??new Uint8Array();let first=true;pullAborts++
   return new Response(new ReadableStream({pull(stream){if(first){first=false;stream.enqueue(bytes.slice(0,Math.max(1,Math.floor(bytes.length/2))))}else{controller.abort();stream.error(new TypeError('Synthetic mid-page connection abort'))}}}),{status:response.status,headers:response.headers})
  }
  return response
 }
 const a=service(()=>source,'source',sourceFetch);let b=service(()=>replica,'replica',replicaFetch)
 const count=(db:Database.Database,table:string)=>(db.prepare(`SELECT count(*) n FROM "${table}"`).get() as {n:number}).n
 const balance=(db:Database.Database)=>(db.prepare("SELECT solde_credit n FROM clients WHERE id='proof-client'").get() as {n:number}).n
 const stock=(db:Database.Database)=>(db.prepare("SELECT stock_actuel n FROM produits WHERE id='proof-product'").get() as {n:number}).n
 const clean=(db:Database.Database)=>assert.deepEqual(liveIssues(db),[])
 async function drain(svc:SeedService,db:Database.Database){
  for(let i=0;i<30;i++){const result=await svc.drainLiveChanges();assert.equal(result.error,undefined);assert.equal(result.rejected,0,JSON.stringify(liveIssues(db)));if((await svc.status()).live.pending===0)return}
  throw new Error('Outbox did not drain')
 }
 async function pull(svc:SeedService,db:Database.Database){
  for(let i=0;i<30;i++){const result=await svc.pullLiveChanges();assert.equal(result.rejected,0,JSON.stringify(liveIssues(db)));if(!result.hasMore)return}
  throw new Error('Pull did not finish')
 }
 try{
  source.exec("INSERT INTO clients(id,nom,solde_credit,solde_fidelite) VALUES('proof-client','Synthetic customer',20,0); INSERT INTO produits(id,nom,reference,stock_actuel,prix_vente) VALUES('proof-product','Synthetic product','SYNTHETIC-PROOF',100,12.345); INSERT INTO ventes(id,numero,client_id,total_ttc) VALUES('proof-seeded-sale','SYNTHETIC-OLD','proof-client',12.345); INSERT INTO lignes_vente(id,vente_id,produit_id,designation,quantite,prix_unitaire,total_ligne) VALUES('proof-seeded-line','proof-seeded-sale','proof-product','Synthetic',1,12.345,12.345)")
  await a.registerDevice(baseUrl,'desktop-proof',password,'Synthetic source')
  const report=await a.backupAndCheck();assert.equal(report.status,'passed',JSON.stringify(report.blockers))
  source.exec("UPDATE produits SET stock_actuel=stock_actuel+4 WHERE id='proof-product'; UPDATE clients SET solde_credit=solde_credit+1.25 WHERE id='proof-client'")
  await a.approve('SEED');await a.run();assert.equal((await a.status()).seed.state,'done')
  assert.equal(seedAbort,false);console.log('PASS: connection aborted after server seed batch; retry completed')
  await pull(a,source);assert.equal(stock(source),104);assert.equal(balance(source),21.25)
  lostAck=true;await drain(a,source);await pull(a,source);assert.equal(lostAck,false)
  assert.equal(stock(source),104);assert.equal(balance(source),21.25)
  console.log('PASS: post-snapshot writes survive activation and a lost HTTP acknowledgement')
  console.log('PASS: real-schema source backup, seed batches, verify and activation over HTTP')
  await b.registerDevice(baseUrl,'desktop-proof',password,'Synthetic replica')
  const identity=captureState(replica,'device_id')
  await b.prepareReplica('JOIN');interruptReplica=true
  await assert.rejects(b.bootstrapReplica(),/Synthetic mid-page connection abort/)
  assert.ok(pullAborts>=1);console.log('PASS: connection aborted mid-pull page; join resumes')
  assert.notEqual(captureState(replica,'bootstrap_complete'),'1')
  assert.equal((replica.prepare("SELECT value FROM app_settings WHERE key='first_touch_pending'").get() as {value:string}).value,'1')
  // Model closing the app mid-download: discard both database and service
  // objects, reopen the persisted files, then resume the same device join.
  ledgers.pop()!.close();replica.close();replica=new Database(replicaPath);replica.pragma('foreign_keys=ON');replica.pragma('recursive_triggers=ON')
  b=service(()=>replica,'replica',replicaFetch)
  await b.registerDevice(baseUrl,'desktop-proof',password,'Synthetic replica')
  interruptReplica=false;await b.bootstrapReplica()
  assert.equal(captureState(replica,'bootstrap_complete'),'1');clean(replica)
  assert.equal((replica.prepare("SELECT value FROM app_settings WHERE key='first_touch_pending'").get() as {value:string}).value,'0')
  console.log('PASS: interrupted download resumes and POS login unlocks only after verification')
  assert.equal(count(replica,'ventes'),count(source,'ventes'));assert.equal(count(replica,'lignes_vente'),count(source,'lignes_vente'))
  assert.equal(stock(replica),104);assert.equal(balance(replica),21.25)
  replica.close();replica=new Database(replicaPath);replica.pragma('foreign_keys=ON');replica.pragma('recursive_triggers=ON')
  assert.equal(captureState(replica,'device_id'),identity)
  b=service(()=>replica,'replica')
  await b.registerDevice(baseUrl,'desktop-proof',password,'Synthetic replica')
  console.log('PASS: fresh replica joins, verifies counts/money, and retains identity after reopen')
  await pull(a,source);clean(source)
  for(const [index,db] of [source,replica].entries())db.transaction(()=>{
   db.prepare("INSERT INTO ventes(id,numero,client_id,total_ttc) VALUES(?,?,?,?)").run('proof-sale-'+index,'SYNTHETIC-PC-'+index,'proof-client',12.345)
   db.prepare("INSERT INTO lignes_vente(id,vente_id,produit_id,designation,quantite,prix_unitaire,total_ligne) VALUES(?,?,?,?,?,?,?)").run('proof-line-'+index,'proof-sale-'+index,'proof-product','Synthetic',1,12.345,12.345)
   db.exec("UPDATE produits SET stock_actuel=stock_actuel-1 WHERE id='proof-product'; UPDATE clients SET solde_credit=solde_credit+12.345 WHERE id='proof-client'")
  })()
  await Promise.all([drain(a,source),drain(b,replica)])
  await pull(a,source);await pull(b,replica)
  for(const db of [source,replica]){clean(db);assert.equal(stock(db),102);assert.equal(balance(db),45.94);assert.equal(count(db,'ventes'),3);assert.equal(count(db,'lignes_vente'),3)}
  await pull(a,source);await pull(b,replica)
  assert.equal(stock(source),102);assert.equal(balance(replica),45.94)
  console.log('PASS: offline sales + lines + stock + balances converge in both directions without replay duplication')
  const price=(db:Database.Database)=>(db.prepare("SELECT round(prix_vente*1000) n FROM produits WHERE id='proof-product'").get() as {n:number}).n
  source.prepare('UPDATE produits SET prix_vente=? WHERE id=?').run(10.001,'proof-product')
  await drain(a,source);await pull(b,replica);assert.equal(price(replica),10001)
  replica.prepare('UPDATE produits SET prix_vente=? WHERE id=?').run(20.002,'proof-product')
  await drain(b,replica);await pull(a,source);assert.equal(price(source),20002)
  source.prepare('UPDATE produits SET prix_vente=? WHERE id=?').run(30.003,'proof-product')
  await drain(a,source);await pull(b,replica);assert.equal(price(replica),30003)
  console.log('PASS: explicit A→B→A price edits converge in millimes')
  if (process.env.SMLPOS_WORKLOAD_SEED) {
   const seed=Number(process.env.SMLPOS_WORKLOAD_SEED)
   const workload=generateWorkload(seed,200)
   let pending=0,restarts=0
   const flush=async(reverse:boolean)=>{
    if(reverse){await drain(b,replica);await drain(a,source)}else{await drain(a,source);await drain(b,replica)}
    await pull(a,source);await pull(b,replica);pending=0
   }
   for(const item of workload){
    if(item.duplicate)duplicateNext=true
    const db=item.device==='A'?source:replica
    const id=`work-${seed}-${item.index}`
    db.transaction(()=>{
     if(item.kind==='sale'){
      const amount=item.value/1000
      db.prepare('INSERT INTO ventes(id,numero,client_id,total_ttc) VALUES(?,?,?,?)').run(id,`NUM-${seed}-${item.index}`,'proof-client',amount)
      db.prepare('INSERT INTO lignes_vente(id,vente_id,produit_id,designation,quantite,prix_unitaire,total_ligne) VALUES(?,?,?,?,?,?,?)').run(id+'-line',id,'proof-product','Synthetic',1,amount,amount)
      db.prepare('UPDATE produits SET stock_actuel=stock_actuel-1 WHERE id=?').run('proof-product')
     }else if(item.kind==='return'){
      db.prepare('INSERT INTO retours(id,produit_id,designation,quantite,prix_unitaire,type_retour,montant_rembourse) VALUES(?,?,?,?,?,?,?)').run(id,'proof-product','Synthetic',1,item.value/1000,'SANS_PROBLEME',item.value/1000)
      db.prepare('UPDATE produits SET stock_actuel=stock_actuel+1 WHERE id=?').run('proof-product')
     }else if(item.kind==='price'){
      db.prepare('UPDATE produits SET prix_vente=? WHERE id=?').run(item.value/1000,'proof-product')
     }else if(item.kind==='stock'){
      db.prepare('UPDATE produits SET stock_actuel=stock_actuel+? WHERE id=?').run(item.value%7-3,'proof-product')
     }else{
      db.prepare('INSERT INTO categories(id,nom) VALUES(?,?)').run(id,id)
      db.prepare('DELETE FROM categories WHERE id=?').run(id)
     }
    })()
    pending++
    // Offline windows accumulate writes locally. Alternating drain order changes
    // cross-device request order while preserving each device's outbox order.
    if(pending>=8 || (!item.offline && item.kind==='price')) await flush(item.reorder)
    if(item.restart && item.device==='B'){
     ledgers.pop()!.close();replica.close();replica=new Database(replicaPath)
     replica.pragma('foreign_keys=ON');replica.pragma('recursive_triggers=ON')
     b=service(()=>replica,'replica');await b.registerDevice(baseUrl,'desktop-proof',password,'Synthetic replica')
     restarts++
    }
   }
   await flush(false)
   if(delayedReplay){const previous=delayedReplay;delayedReplay=null;assert.equal((await fetch(previous.input,previous.init)).status,200);reordered++}
   assert.ok(reordered>0,'workload did not replay any requests out of order')
   const snapshot=(db:Database.Database)=>({
    sales:count(db,'ventes'), lines:count(db,'lignes_vente'), returns:count(db,'retours'),
    categories:count(db,'categories'), stock:stock(db),
    price:(db.prepare("SELECT round(prix_vente*1000) n FROM produits WHERE id='proof-product'").get() as {n:number}).n,
    millimes:(db.prepare('SELECT coalesce(sum(round(total_ttc*1000)),0) n FROM ventes').get() as {n:number}).n,
    duplicateNumbers:(db.prepare('SELECT count(*) n FROM (SELECT numero FROM ventes GROUP BY numero HAVING count(*)>1)').get() as {n:number}).n,
    pending:(db.prepare('SELECT count(*) n FROM outbox WHERE sent_at IS NULL').get() as {n:number}).n,
    pullRejects:(db.prepare('SELECT count(*) n FROM pull_rejects').get() as {n:number}).n,
   })
   const first=snapshot(source),second=snapshot(replica)
   assert.deepEqual(second,first);assert.equal(first.duplicateNumbers,0);assert.equal(first.pending,0);assert.equal(first.pullRejects,0)
   const allStock=(db:Database.Database)=>db.prepare('SELECT id,stock_actuel FROM produits ORDER BY id').all()
   const stockA=allStock(source),stockB=allStock(replica);assert.deepEqual(stockB,stockA)
   writeFileSync(join(root,'stock-check.json'),JSON.stringify(stockA))
   console.log(`PASS random seed=${seed} operations=${workload.length} sqlite_reopens=${restarts} reordered_replays=${reordered} products=${stockA.length} result=${JSON.stringify(first)}`)
  }
 }finally{for(const ledger of ledgers)ledger.close();replica.close();closeDatabase()}
}
main().catch(error=>{console.error(error);process.exitCode=1})

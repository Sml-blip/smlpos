import assert from 'node:assert/strict'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { connectDatabase, initDatabase, closeDatabase } from '../../src/main/db'
import { SeedService } from '../../src/main/seed/service'
import { SeedLedger } from '../../src/main/seed/ledger'
import { captureState, setCaptureState } from '../../src/main/seed/gate'
import { liveIssues } from '../../src/main/seed/monitor'

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
 let lostAck=false,interruptReplica=false
 const sourceFetch:typeof fetch=async(input,init)=>{
  const response=await fetch(input,init)
  if(lostAck&&new URL(String(input)).pathname==='/sync2/push'){lostAck=false;await response.arrayBuffer();throw new TypeError('Synthetic lost acknowledgement')}
  return response
 }
 const replicaFetch:typeof fetch=async(input,init)=>{
  const url=new URL(String(input))
  if(interruptReplica&&url.pathname==='/sync2/pull'&&Number(url.searchParams.get('since'))>0)throw new TypeError('Synthetic network interruption')
  return fetch(input,init)
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
  await pull(a,source);assert.equal(stock(source),104);assert.equal(balance(source),21.25)
  lostAck=true;await drain(a,source);await pull(a,source);assert.equal(lostAck,false)
  assert.equal(stock(source),104);assert.equal(balance(source),21.25)
  console.log('PASS: post-snapshot writes survive activation and a lost HTTP acknowledgement')
  console.log('PASS: real-schema source backup, seed batches, verify and activation over HTTP')
  await b.registerDevice(baseUrl,'desktop-proof',password,'Synthetic replica')
  const identity=captureState(replica,'device_id')
  await b.prepareReplica('JOIN');interruptReplica=true
  await assert.rejects(b.bootstrapReplica(),/Synthetic network interruption/)
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
 }finally{for(const ledger of ledgers)ledger.close();replica.close();closeDatabase()}
}
main().catch(error=>{console.error(error);process.exitCode=1})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { hash } from '@node-rs/argon2'
import { createPool,migrate } from '../src/db.ts'
import { createApp } from '../src/app.ts'
import { canonical,digest,newId } from '../src/domain.ts'
import { contract,emptyStats,addStats } from '../src/sync2Contract.ts'

test('TEXT-ID seed, 20 post-snapshot sales, replay and two-device offline stock',{skip:!process.env.TEST_DATABASE_URL},async t=>{
 const admin=createPool(process.env.TEST_DATABASE_URL!);const schema=`test_${newId().replaceAll('-','')}`
 await admin.query(`CREATE SCHEMA ${schema}`)
 const uri=new URL(process.env.TEST_DATABASE_URL!);uri.searchParams.set('options',`-csearch_path=${schema}`)
 const pool=createPool(uri.toString())
 try{
  await migrate(pool)
  const user=newId(),password='synthetic-sync2-password'
  await pool.query('INSERT INTO app_users(id,username,password_hash,role) VALUES($1,$2,$3,$4)',[user,'sync2-fixture',await hash(password),'admin'])
  const privateKey=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}).toString()
  const app=createApp(pool,{privateKey,keyId:'fixture',issuer:'https://fixture.invalid',minimumVersion:'1.10.0',liveWrites:false,sync2Enabled:true,syncUrl:'https://fixture.invalid'})
  const request=(path:string,body?:unknown,token?:string)=>app.request(path,{method:body===undefined?'GET':'POST',headers:{'X-Client-Version':'1.10.0','Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)})
  const login=async()=>{const response=await request('/auth/login',{username:'sync2-fixture',password,deviceId:newId(),deviceName:'Synthetic PC',platform:'development'});return (await response.json()).accessToken as string}
  const first=await login(),second=await login()
  const rows:Record<string,Array<Record<string,unknown>>>={operateurs:[{id:'op-hamdi',nom:'Fixture',identifiant:'fixture'}],produits:[{id:'legacy-product',nom:'Product',reference:'LEGACY',prix_vente:12345,stock_actuel:100}],clients:[{id:'client-1',nom:'Customer',solde_credit:100000,solde_fidelite:500}],ventes:[{id:'legacy-sale',numero:'VTE-OLD-001',total_ttc:12345}],stock_movements:[{id:'opening:legacy-product',produit_id:'legacy-product',delta:100,reason:'OPENING_BALANCE',ref_id:'legacy-product'}]}
  const expected=Object.fromEntries(Object.keys(contract).map(table=>[table,emptyStats(table)]))
  for(const [table,batch] of Object.entries(rows))for(const row of batch)addStats(expected[table],String(row.id),row)
  const manifest={snapshotHash:digest('verified legacy copy'),expected}
  const started=await request('/sync2/seed/start',manifest,first);assert.equal(started.status,200)
  const seedId=(await started.json()).seedId
  await t.test('keeps legacy TEXT IDs, refuses activation before verification and resumes duplicate batches',async()=>{
   assert.equal((await request('/sync2/seed/activate',{seedId,reviewedManifestHash:digest(canonical(manifest))},first)).status,409)
   for(const [table,batch] of Object.entries(rows)){
    const input={seedId,batchId:digest(table+manifest.snapshotHash),table,rows:batch}
    const received=await request('/sync2/seed/batch',input,first);assert.equal(received.status,200,JSON.stringify(await received.json()))
    assert.equal((await (await request('/sync2/seed/batch',input,first)).json()).duplicate,batch.length)
   }
   assert.equal((await (await request('/sync2/seed/verify',{seedId},first)).json()).ok,true)
   assert.equal((await request('/sync2/seed/activate',{seedId,reviewedManifestHash:digest(canonical(manifest))},first)).status,200)
   assert.equal((await (await request('/sync2/seed/activate',{seedId,reviewedManifestHash:digest(canonical(manifest))},first)).json()).replayed,true)
   assert.equal((await pool.query("SELECT payload->>'numero' numero FROM sync2_records WHERE table_name='ventes' AND row_id='legacy-sale'")).rows[0].numero,'VTE-OLD-001')
  })
  await t.test('post-snapshot sales apply once despite three interruptions and lost acknowledgements',async()=>{
   const ops=Array.from({length:20},(_,index)=>({opId:`sale-operation-${index}`,table:'ventes',rowId:`sale-after-snapshot-${index}`,op:'INSERT',payload:{id:`sale-after-snapshot-${index}`,numero:`MAIN-${String(index+1).padStart(6,'0')}`,total_ttc:12345}}))
   for(let i=0;i<ops.length;i++){
    const result=await request('/sync2/push',{ops:[ops[i]]},first);assert.equal(result.status,200)
    if([4,10,16].includes(i))assert.equal((await (await request('/sync2/push',{ops:[ops[i]]},first)).json()).results[0].status,'duplicate')
   }
   assert.equal(Number((await pool.query("SELECT count(*) n FROM sync2_records WHERE table_name='ventes'")).rows[0].n),21)
   assert.equal((await pool.query("SELECT sum((payload->>'total_ttc')::numeric)::text n FROM sync2_records WHERE table_name='ventes'")).rows[0].n,String(21*12345))
   const changed={...ops[0],payload:{...ops[0].payload,total_ttc:1}}
   assert.equal((await request('/sync2/push',{ops:[changed]},first)).status,409)
  })
  await t.test('two devices sell offline; stock is opening plus both movements and pull uses server sequence',async()=>{
   const movement=(name:string)=>({opId:name,table:'stock_movements',rowId:name,op:'INSERT',payload:{id:name,produit_id:'legacy-product',delta:-1,reason:'SALE',ref_id:name}})
   const results=await Promise.all([request('/sync2/push',{ops:[movement('pc1-stock')]},first),request('/sync2/push',{ops:[movement('pc2-stock')]},second)])
   assert.deepEqual(results.map(result=>result.status),[200,200])
   assert.equal((await pool.query("SELECT payload->>'stock_actuel' n FROM sync2_records WHERE table_name='produits' AND row_id='legacy-product'")).rows[0].n,'98')
   let since='0',received=0,last='0'
   do{
    const page=await (await request(`/sync2/pull?since=${since}&limit=7`,undefined,second)).json()
    for(const row of page.rows){assert.ok(BigInt(row.seq)>BigInt(last));last=row.seq}
    received+=page.rows.length;since=page.nextSeq
    if(!page.hasMore)break
   }while(true)
   assert.equal(received,Number((await pool.query('SELECT count(*) n FROM sync2_changes')).rows[0].n))
   assert.equal((await (await request(`/sync2/pull?since=${since}`,undefined,second)).json()).rows.length,0)
   const frozen=await request('/sync2/push',{ops:[{opId:'change-final-sale',table:'ventes',rowId:'legacy-sale',op:'UPDATE',payload:{...rows.ventes[0],total_ttc:1}}]},first)
   assert.equal((await frozen.json()).results[0].code,'IMMUTABLE_ROW')
  })
  await t.test('stock DELTA creates one server movement, recomputes stock and replays explicitly once',async()=>{
   const op={opId:'stock-delta-operation',table:'produits',rowId:'legacy-product',op:'DELTA',field:'stock_actuel',value:-2}
   const before=Number((await pool.query("SELECT count(*) n FROM sync2_records WHERE table_name='stock_movements'")).rows[0].n)
   const applied=(await (await request('/sync2/push',{ops:[op]},first)).json()).results[0]
   assert.equal(applied.status,'applied')
   assert.equal(Number((await pool.query("SELECT payload->>'stock_actuel' n FROM sync2_records WHERE table_name='produits' AND row_id='legacy-product'")).rows[0].n),96)
   const generated=(await pool.query("SELECT payload FROM sync2_records WHERE table_name='stock_movements' AND payload->>'ref_id'=$1",[op.opId])).rows[0].payload
   assert.equal(generated.produit_id,'legacy-product');assert.equal(generated.delta,-2);assert.equal(generated.reason,'SYNC2_DELTA')
   assert.equal(Number((await pool.query("SELECT count(*) n FROM sync2_records WHERE table_name='stock_movements'")).rows[0].n),before+1)
   assert.equal((await (await request('/sync2/push',{ops:[op]},first)).json()).results[0].status,'duplicate')
   assert.equal(Number((await pool.query("SELECT count(*) n FROM sync2_records WHERE table_name='stock_movements'")).rows[0].n),before+1)
   const pulled=(await (await request('/sync2/pull?since=0&limit=500',undefined,second)).json()).rows.filter((row:Record<string,unknown>)=>row.op==='DELTA'&&row.table_name==='produits'&&row.row_id==='legacy-product')
   assert.equal(pulled.at(-1).field,'stock_actuel');assert.equal(pulled.at(-1).value,-2)
   assert.equal(pulled.at(-1).payload.device_id,(await pool.query('SELECT device_id FROM sync2_operations WHERE op_id=$1',[op.opId])).rows[0].device_id)
  })
  await t.test('concurrent stock DELTAs serialize and both create exactly one movement',async()=>{
   const before=Number((await pool.query("SELECT count(*) n FROM sync2_records WHERE table_name='stock_movements'")).rows[0].n)
   const ops=[
    {opId:'parallel-stock-delta-pc1',table:'produits',rowId:'legacy-product',op:'DELTA',field:'stock_actuel',value:-4},
    {opId:'parallel-stock-delta-pc2',table:'produits',rowId:'legacy-product',op:'DELTA',field:'stock_actuel',value:3},
   ]
   const responses=await Promise.all(ops.map((op,index)=>request('/sync2/push',{ops:[op]},index===0?first:second)))
   assert.deepEqual(responses.map(response=>response.status),[200,200])
   const results=await Promise.all(responses.map(response=>response.json()))
   assert.deepEqual(results.map(result=>result.results[0].status),['applied','applied'])
   assert.equal(Number((await pool.query("SELECT payload->>'stock_actuel' n FROM sync2_records WHERE table_name='produits' AND row_id='legacy-product'")).rows[0].n),95)
   assert.equal(Number((await pool.query("SELECT count(*) n FROM sync2_records WHERE table_name='stock_movements' AND payload->>'ref_id' IN ('parallel-stock-delta-pc1','parallel-stock-delta-pc2')")).rows[0].n),2)
   assert.equal(Number((await pool.query("SELECT count(*) n FROM sync2_records WHERE table_name='stock_movements'")).rows[0].n),before+2)
  })
  await t.test('money counter DELTA updates the stored value and pull event by integer millimes',async()=>{
   const op={opId:'client-credit-delta',table:'clients',rowId:'client-1',op:'DELTA',field:'solde_credit',value:-1235}
   const applied=(await (await request('/sync2/push',{ops:[op]},first)).json()).results[0]
   assert.equal(applied.status,'applied')
   assert.equal(Number((await pool.query("SELECT payload->>'solde_credit' n FROM sync2_records WHERE table_name='clients' AND row_id='client-1'")).rows[0].n),98765)
   assert.equal((await (await request('/sync2/push',{ops:[op]},first)).json()).results[0].status,'duplicate')
   const pulled=(await (await request('/sync2/pull?since=0&limit=500',undefined,second)).json()).rows.filter((row:Record<string,unknown>)=>row.op==='DELTA'&&row.table_name==='clients'&&row.row_id==='client-1')
   assert.equal(pulled.at(-1).field,'solde_credit');assert.equal(pulled.at(-1).value,-1235);assert.equal(pulled.at(-1).payload.solde_credit,undefined)
   assert.equal(pulled.at(-1).payload.device_id,(await pool.query('SELECT device_id FROM sync2_operations WHERE op_id=$1',[op.opId])).rows[0].device_id)
   const stale={opId:'stale-absolute-client-balance',table:'clients',rowId:'client-1',op:'UPDATE',payload:{id:'client-1',nom:'Customer',solde_credit:100000,solde_fidelite:500}}
   const staleResult=(await (await request('/sync2/push',{ops:[stale]},first)).json()).results[0]
   assert.equal(staleResult.code,'COUNTER_DELTA_REQUIRED')
   assert.equal(Number((await pool.query("SELECT payload->>'solde_credit' n FROM sync2_records WHERE table_name='clients' AND row_id='client-1'")).rows[0].n),98765)
   const verified=await (await request('/sync2/verification',undefined,second)).json()
   assert.ok(Number.isSafeInteger(verified.serverSeq));assert.equal(verified.tables.produits.count,1)
   assert.equal(verified.tables.produits.moneyTotals.prix_vente,'12345')
   assert.equal(verified.tables.clients.count,1);assert.equal(verified.tables.clients.moneyTotals.solde_credit,'98765')
  })
  await t.test('invalid DELTAs are individually rejected without blocking a valid later op',async()=>{
   const ops=[
    {opId:'delta-unknown-field',table:'clients',rowId:'client-1',op:'DELTA',field:'nom',value:1},
    {opId:'delta-unknown-table',table:'ventes',rowId:'legacy-sale',op:'DELTA',field:'total_ttc',value:1},
    {opId:'delta-fractional',table:'clients',rowId:'client-1',op:'DELTA',field:'solde_credit',value:0.5},
    {opId:'delta-missing-target',table:'clients',rowId:'missing-client',op:'DELTA',field:'solde_credit',value:1},
    {opId:'delta-missing-product',table:'produits',rowId:'missing-product',op:'DELTA',field:'stock_actuel',value:1},
    {opId:'delta-valid-after-rejects',table:'clients',rowId:'client-1',op:'DELTA',field:'solde_fidelite',value:25},
   ]
   const results=(await (await request('/sync2/push',{ops},first)).json()).results
   assert.deepEqual(results.map((result:Record<string,unknown>)=>result.status),['rejected','rejected','rejected','rejected','rejected','applied'])
   assert.deepEqual(results.slice(0,5).map((result:Record<string,unknown>)=>result.code),['DELTA_NOT_ALLOWED','DELTA_NOT_ALLOWED','INVALID_DELTA','DELTA_TARGET_MISSING','DELTA_TARGET_MISSING'])
   assert.equal((await (await request('/sync2/push',{ops:[ops[0]]},first)).json()).results[0].status,'rejected')
   assert.equal((await request('/sync2/push',{ops:[{...ops[0],value:2}]},first)).status,409)
   assert.equal(Number((await pool.query("SELECT payload->>'solde_fidelite' n FROM sync2_records WHERE table_name='clients' AND row_id='client-1'")).rows[0].n),525)
  })
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end()}
})


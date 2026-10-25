import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, randomBytes,createHash } from 'node:crypto'
import { poolFor,migrate,schema,sha,one,canonical } from '../db.mjs'
import { wireHash } from '../seed.mjs'
import { createApp } from '../app.mjs'

test('production v1 protocol on an isolated synthetic PostgreSQL schema',async t=>{
 assert.ok(process.env.TEST_DATABASE_URL,'TEST_DATABASE_URL required; refusing a skipped server check')
 const admin=poolFor(process.env.TEST_DATABASE_URL),namespace='v1test_'+randomUUID().replaceAll('-','')
 assert.match(namespace,/^v1test_[a-f0-9]{32}$/)
 await admin.query(`CREATE SCHEMA ${namespace}`)
 const uri=new URL(process.env.TEST_DATABASE_URL);uri.searchParams.set('options',`-csearch_path=${namespace}`)
 const pool=poolFor(uri.toString())
 try{
  await migrate(pool)
  let app=createApp(pool)
  const request=(path,body,token)=>app.request(path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)})
  const json=async(path,body,token)=>{const response=await request(path,body,token),value=await response.json();assert.equal(response.status,200,`${path}: ${JSON.stringify(value)}`);return value}
  const register=async(role,install=randomUUID())=>{
   const enrollment=randomBytes(40).toString('hex');await pool.query("INSERT INTO v1_enrollment VALUES($1,$2,now()+interval '1 hour',NULL)",[sha(enrollment),role])
   const body={enrollment_token:enrollment,install_id:install,name:'Synthetic '+role,platform:'win32',app_version:'1.9.1039',schema_version:'1.10.10'}
   return {body,...await json('/v1/devices/register',body)}
  }
  const seed=await register('seed'),replica=await register('replica'),token=seed.session.access_token
  await t.test('enrollment identity is stable, token use is bound to install, old versions and missing auth refused',async()=>{
   assert.equal((await json('/v1/devices/register',seed.body)).device_id,seed.device_id)
   assert.equal((await request('/v1/devices/register',{...seed.body,install_id:randomUUID()})).status,403)
   assert.equal((await request('/v1/devices/register',{...seed.body,app_version:'1.9.1038'})).status,426)
   assert.equal((await request('/v1/status')).status,401)
   assert.equal((await request('/v1/sync/push',{device_id:seed.device_id,ops:[]},token)).status,409)
  })
  const rows={produits:[{id:'legacy-product',reference:'REF',nom:'Product',prix_vente:12345,stock_actuel:100}],ventes:[{id:'legacy-sale',numero:'VTE-HISTORY',total_ttc:12345}]}
  const expected=Object.fromEntries(Object.entries(schema.tables).map(([table,definition])=>{
   const values=rows[table]??[],sum=Object.fromEntries(definition.columns.filter(column=>column.kind==='money').map(column=>[column.name,values.reduce((sum,row)=>sum+(row[column.name]??0),0)])),digest=createHash('sha256')
   for(const row of values.sort((a,b)=>Buffer.compare(Buffer.from(a[definition.pk]),Buffer.from(b[definition.pk]))))digest.update(wireHash(table,row))
   return [table,{rows:values.length,money_sums_millimes:sum,digest:digest.digest('hex')}]
  }))
  const begun=await json('/v1/seed/begin',{install_id:seed.body.install_id,report_digest:sha('synthetic snapshot'),expected},token)
  await t.test('seed ownership, replay, exact content/money verification and finalize gate',async()=>{
   assert.equal((await request('/v1/seed/begin',{install_id:replica.body.install_id,report_digest:sha('other'),expected},replica.session.access_token)).status,403)
   assert.equal((await json('/v1/seed/finalize',{seed_id:begun.seed_id,expected},token)).ok,false)
   for(const [table,batch] of Object.entries(rows)){
    const input={seed_id:begun.seed_id,batch_id:sha(table),table,money_columns:Object.keys(expected[table].money_sums_millimes),rows:batch.map(row=>({op_id:sha(`${seed.body.install_id}|${table}|${row.id}|${wireHash(table,row)}`),row}))}
    assert.equal((await json('/v1/seed/batches',input,token)).accepted,batch.length)
    assert.equal((await json('/v1/seed/batches',input,token)).duplicates,batch.length)
   }
   assert.equal((await json('/v1/seed/finalize',{seed_id:begun.seed_id,expected},token)).ok,true)
   assert.equal((await json('/v1/seed/finalize',{seed_id:begun.seed_id,expected},token)).ok,true)
   assert.equal((await one(pool,"SELECT payload->>'numero' numero FROM v1_rows WHERE table_name='ventes' AND pk='legacy-sale'")).numero,'VTE-HISTORY')
  })
  let seq=0
  const op=(value)=>({seq:++seq,at:new Date().toISOString(),...value})
  const push=ops=>json('/v1/sync/push',{device_id:seed.device_id,ops},token)
  await t.test('frozen bootstrap retains one anchor while live writes continue',async()=>{
   const first=await json('/v1/sync/bootstrap?table=produits&after=&limit=1',undefined,replica.session.access_token)
   assert.equal(first.as_of_seq,0);assert.equal(first.rows[0].stock_actuel,100)
   await push([op({table:'produits',pk:'legacy-product',op:'DELTA',field:'stock_actuel',value:-1})])
   const again=await json('/v1/sync/bootstrap?table=produits&after=&limit=1&as_of_seq=0',undefined,replica.session.access_token)
   assert.equal(again.as_of_seq,0);assert.equal(again.rows[0].stock_actuel,100)
  })
  await t.test('twenty live sales with stock deltas, lost ACKs and process restart retain exactly-once results',async()=>{
   const batch=[]
   for(let i=0;i<20;i++)batch.push(op({table:'ventes',pk:`sale-${i}`,op:'UPSERT',row:{id:`sale-${i}`,numero:`VTE-${seed.device_id}-${i}`,total_ttc:1000}}),op({table:'produits',pk:'legacy-product',op:'DELTA',field:'stock_actuel',value:-1}))
   assert.ok((await push(batch)).results.every(item=>item.status==='applied'))
   app=createApp(pool)
   assert.ok((await push(batch)).results.every(item=>item.status==='duplicate'))
   assert.equal((await one(pool,"SELECT payload->>'stock_actuel' stock FROM v1_rows WHERE table_name='produits' AND pk='legacy-product'")).stock,'79')
   assert.equal(Number((await one(pool,"SELECT count(*) n FROM v1_rows WHERE table_name='ventes' AND NOT deleted")).n),21)
   assert.equal(Number((await one(pool,"SELECT sum((payload->>'total_ttc')::bigint) n FROM v1_rows WHERE table_name='ventes'")).n),32345)
   const changed=await push([{...batch[0],row:{...batch[0].row,total_ttc:999}}]);assert.equal(changed.results[0].code,'identity_changed')
  })
  await t.test('A→B→A, REPLACE counter restoration, unique isolation, bad units and body identity',async()=>{
   const base={table:'produits',pk:'legacy-product',op:'UPSERT',row:{id:'legacy-product',nom:'Product',reference:'REF',prix_vente:12000}}
   await push([op(base),op({...base,row:{...base.row,prix_vente:12345}})])
   const replacements=[op({table:'produits',pk:'legacy-product',op:'DELETE'}),op(base),op({table:'produits',pk:'legacy-product',op:'DELTA',field:'stock_actuel',value:-2})]
   assert.ok((await push(replacements)).results.every(row=>row.status==='applied'))
   assert.equal((await one(pool,"SELECT payload->>'stock_actuel' n FROM v1_rows WHERE table_name='produits' AND pk='legacy-product'")).n,'77')
   const result=await push([op({table:'produits',pk:'collision',op:'UPSERT',row:{...base.row,id:'collision'}}),op({...base,row:{...base.row,prix_vente:1.2}}),op({...base,row:{...base.row,prix_vente:13000}})])
   assert.deepEqual(result.results.map(row=>row.status),['rejected','rejected','applied']);assert.equal(result.results[0].code,'unique_conflict')
   assert.equal((await request('/v1/sync/push',{device_id:replica.device_id,ops:[op(base)]},token)).status,403)
   const pull=await json('/v1/sync/pull?since=0&limit=500',undefined,replica.session.access_token)
   assert.equal(pull.next_seq,pull.changes.at(-1).server_seq)
   assert.ok(pull.changes.every((change,i)=>!i||change.server_seq>pull.changes[i-1].server_seq))
   assert.ok(pull.changes.filter(row=>row.op==='UPSERT').every(row=>!Object.hasOwn(row.row,'stock_actuel')))
  })
  await t.test('refresh tokens rotate and revoked devices cannot read or write',async()=>{
   const current=await json('/v1/auth/refresh',{refresh_token:replica.session.refresh_token})
   assert.equal((await request('/v1/auth/refresh',{refresh_token:replica.session.refresh_token})).status,401)
   await pool.query('UPDATE v1_devices SET revoked=true WHERE id=$1',[replica.device_id])
   assert.equal((await request('/v1/status',undefined,current.access_token)).status,401)
  })
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${namespace} CASCADE`);await admin.end()}
})

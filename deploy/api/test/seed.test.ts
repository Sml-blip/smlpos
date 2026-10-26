import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { hash } from '@node-rs/argon2'
import { createPool,migrate } from '../src/db.ts'
import { createApp } from '../src/app.ts'
import { canonical,digest,newId,registry } from '../src/domain.ts'
import { seedContractHash } from '../src/seed.ts'
import type { SeedRow,SeedManifest } from '../src/seed.ts'
import { buildSeedBundle } from '../src/seedConversion.ts'
import type { LegacySnapshot } from '../src/seedConversion.ts'
import legacy from '../schema/legacy-contract.json' with {type:'json'}

function manifestFor(chunks:SeedRow[][]):SeedManifest{
 const counts=Object.fromEntries(Object.keys(registry).map(name=>[name,0]))
 const totals:Record<string,string>={}
 for(const [table,definition] of Object.entries(registry))for(const [column,info] of Object.entries(definition.columns))if(info.type==='money')totals[`${table}.${column}`]='0'
 for(const row of chunks.flat()){
  counts[row.table]++
  for(const [column,value] of Object.entries(row.data))if(`${row.table}.${column}` in totals)totals[`${row.table}.${column}`]=String(BigInt(totals[`${row.table}.${column}`])+BigInt(String(value??0)))
 }
 return {version:1,jobId:newId(),sourceSha256:digest('synthetic-backup'),contractHash:seedContractHash,cutoverAt:'2026-10-24T15:00:00+01:00',expectedCounts:counts,expectedMoneyTotals:totals,chunks:chunks.map((rows,index)=>({index,sha256:digest(canonical(rows)),rowCount:rows.length}))}
}
const row=(table:string,data:Record<string,unknown>,id=newId()):SeedRow=>({table,id,data,sourceCreatedAt:'2026-10-24T14:00:00Z',sourceUpdatedAt:null})

test('seed staging: resumable, isolated, verified and never published',{skip:!process.env.TEST_DATABASE_URL},async t=>{
 const admin=createPool(process.env.TEST_DATABASE_URL!)
 const schema=`test_${newId().replaceAll('-','')}`;assert.match(schema,/^test_[0-9a-f]+$/)
 await admin.query(`CREATE SCHEMA ${schema}`)
 const uri=new URL(process.env.TEST_DATABASE_URL!);uri.searchParams.set('options',`-csearch_path=${schema}`)
 const pool=createPool(uri.toString())
 try{
  await migrate(pool);await migrate(pool)
  const user=newId();const password='synthetic-seed-test-only'
  await pool.query('INSERT INTO app_users(id,username,password_hash,role) VALUES($1,$2,$3,$4)',[user,'seed-fixture',await hash(password),'admin'])
  const key=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}).toString()
  const config={privateKey:key,issuer:'https://seed.invalid',keyId:'fixture',minimumVersion:'1.10.0',liveWrites:false,seedStaging:true,syncUrl:'https://sync.invalid'}
  let app=createApp(pool,config)
  const deviceId=newId()
  const request=(path:string,body?:unknown,token?:string)=>app.request(path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Client-Version':'1.10.0',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)})
  const login=await request('/auth/login',{username:'seed-fixture',password,deviceId,deviceName:'Synthetic source PC',platform:'development'})
  const auth=(await login.json()).accessToken
  const create=(manifest:SeedManifest)=>request('/seed/jobs',manifest,auth)
  const upload=(manifest:SeedManifest,index:number,rows:SeedRow[])=>request(`/seed/jobs/${manifest.jobId}/chunks/${index}`,rows,auth)
  const verify=(manifest:SeedManifest)=>request(`/seed/jobs/${manifest.jobId}/verify`,{},auth)
  const cancel=(manifest:SeedManifest)=>request(`/seed/jobs/${manifest.jobId}/cancel`,{},auth)
  const category=row('categories',{nom:'Seed category'})
  const product=row('produits',{reference:'SEED-1',nom:'Synthetic product',prix_vente:12345,categorie_id:category.id})
  const chunks=[[category],[product]];const manifest=manifestFor(chunks)
  await t.test('authenticated admin and an explicit staging gate are required',async()=>{
   assert.equal((await request('/seed/contract')).status,401)
   const locked=createApp(pool,{...config,seedStaging:false})
   assert.equal((await locked.request('/seed/jobs',{method:'POST',headers:{Authorization:`Bearer ${auth}`,'X-Client-Version':'1.10.0','Content-Type':'application/json'},body:JSON.stringify(manifest)})).status,503)
   await pool.query("UPDATE app_users SET role='cashier' WHERE id=$1",[user])
   assert.equal((await create(manifest)).status,403)
   await pool.query("UPDATE app_users SET role='admin' WHERE id=$1",[user])
  })
  await t.test('manifest coverage, contract and deterministic creation are enforced',async()=>{
   assert.equal((await create({...manifest,contractHash:digest('old-contract')})).status,409)
   assert.equal((await create({...manifest,expectedCounts:{categories:1}})).status,422)
   assert.equal((await create(manifest)).status,200)
   assert.equal((await (await create(manifest)).json()).replayed,true)
   assert.equal((await create({...manifest,sourceSha256:digest('changed-backup')})).status,409)
   assert.equal((await create(manifestFor(chunks))).status,409)
  })
  await t.test('out-of-order and concurrent retries store one copy; changed content fails',async()=>{
   const responses=await Promise.all([upload(manifest,1,chunks[1]),upload(manifest,1,chunks[1])])
   assert.deepEqual(responses.map(r=>r.status),[200,200])
   assert.equal(Number((await pool.query('SELECT count(*) n FROM seed_rows WHERE job_id=$1',[manifest.jobId])).rows[0].n),1)
   assert.equal((await upload(manifest,1,[{...product,data:{...product.data,prix_vente:1}}])).status,409)
   assert.equal((await verify(manifest)).status,409)
   assert.equal(Number((await pool.query('SELECT count(*) n FROM produits')).rows[0].n),0)
  })
  await t.test('a restarted API resumes from durable chunk receipts',async()=>{
   app=createApp(pool,config)
   const status=await (await request(`/seed/jobs/${manifest.jobId}`,undefined,auth)).json()
   assert.equal(status.chunks.length,1);assert.equal(status.chunks[0].chunk_index,1)
   assert.equal((await upload(manifest,0,chunks[0])).status,200)
   const checked=await verify(manifest)
   assert.equal(checked.status,200);assert.equal((await checked.json()).activationEnabled,false)
   assert.equal((await (await verify(manifest)).json()).replayed,true)
   assert.equal((await (await upload(manifest,0,chunks[0])).json()).replayed,true)
   assert.equal(Number((await pool.query('SELECT count(*) n FROM categories')).rows[0].n),0)
   assert.equal(Number((await pool.query('SELECT count(*) n FROM produits')).rows[0].n),0)
   assert.equal((await request(`/seed/jobs/${manifest.jobId}/activate`,{},auth)).status,404)
   assert.equal((await cancel(manifest)).status,200)
  })
  await t.test('server recomputes all money totals, and cancellation preserves staged evidence',async()=>{
   const rows=[[row('produits',{reference:'TOTALS',nom:'Totals',prix_vente:999})]]
   const bad=manifestFor(rows);bad.expectedMoneyTotals['produits.prix_vente']='1000'
   assert.equal((await create(bad)).status,200);assert.equal((await upload(bad,0,rows[0])).status,200)
   const res=await verify(bad);assert.equal(res.status,422);assert.equal((await res.json()).code,'SEED_TOTAL_MISMATCH')
   assert.equal((await cancel(bad)).status,200)
   assert.equal((await cancel(bad)).status,200)
   assert.equal(Number((await pool.query('SELECT count(*) n FROM seed_rows WHERE job_id=$1',[bad.jobId])).rows[0].n),1)
   assert.equal((await upload(bad,0,rows[0])).status,409)
   assert.equal((await create(bad)).status,409)
  })
  await t.test('a duplicate row rolls back the whole chunk and keeps the job resumable',async()=>{
   const duplicate=row('categories',{nom:'Duplicate'})
   const rows=[[duplicate],[row('categories',{nom:'Must rollback'}),duplicate]]
   const bad=manifestFor(rows)
   assert.equal((await create(bad)).status,200);assert.equal((await upload(bad,0,rows[0])).status,200)
   assert.equal((await upload(bad,1,rows[1])).status,422)
   assert.equal(Number((await pool.query('SELECT count(*) n FROM seed_rows WHERE job_id=$1',[bad.jobId])).rows[0].n),1)
   assert.equal(Number((await pool.query('SELECT count(*) n FROM seed_chunks WHERE job_id=$1',[bad.jobId])).rows[0].n),1)
   assert.equal((await cancel(bad)).status,200)
  })
  await t.test('missing references and normalized duplicate serials block verification',async()=>{
   const missing=[[row('produits',{reference:'FK',nom:'Missing FK',categorie_id:newId()})]]
   const first=manifestFor(missing);assert.equal((await create(first)).status,200)
   assert.equal((await upload(first,0,missing[0])).status,200)
   assert.equal((await (await verify(first)).json()).code,'SEED_REFERENCE_MISSING');await cancel(first)
   const p=row('produits',{reference:'SERIAL',nom:'Serial fixture'})
   const serials=[[p,row('serial_numbers',{produit_id:p.id,numero_serie:' Test '}),row('serial_numbers',{produit_id:p.id,numero_serie:'test'})]]
   const second=manifestFor(serials);assert.equal((await create(second)).status,200)
   assert.equal((await upload(second,0,serials[0])).status,200)
   assert.equal((await (await verify(second)).json()).code,'SEED_SERIAL_CONFLICT');await cancel(second)
  })
  await t.test('unknown columns, spoofed actors and fractional money never enter staging',async()=>{
   for(const data of [{reference:'BAD',nom:'Bad',updated_by:user},{reference:'BAD',nom:'Bad',prix_vente:1.1},{reference:'BAD',nom:'Bad',unlisted:'x'}]){
    const rows=[[row('produits',data)]];const bad=manifestFor([[row('produits',{reference:'BAD',nom:'Bad'})]])
    // Construct a declared hash for invalid rows without summing fractional money.
    bad.chunks[0].sha256=digest(canonical(rows[0]))
    assert.equal((await create(bad)).status,200);assert.equal((await upload(bad,0,rows[0])).status,422)
    assert.equal(Number((await pool.query('SELECT count(*) n FROM seed_rows WHERE job_id=$1',[bad.jobId])).rows[0].n),0);await cancel(bad)
   }
  })
  await t.test('a converted legacy snapshot traverses the complete staging flow without publishing balances twice',async()=>{
   const snapshot:LegacySnapshot=Object.fromEntries(legacy.tables.map(table=>[table.name,[]]))
   snapshot.categories=[{id:'legacy-category',nom:'Pipeline category'}]
   snapshot.produits=[{id:'legacy-product',reference:'PIPELINE',nom:'Pipeline product',categorie_id:'legacy-category',prix_vente:12.345,stock_actuel:7}]
   snapshot.clients=[{id:'legacy-customer',nom:'Pipeline customer',solde_credit:12.345}]
   snapshot.credits_clients=[{id:'legacy-credit',client_id:'legacy-customer',client_nom:'Pipeline customer',type:'CREDIT',montant:12.345}]
   const bundle=buildSeedBundle(snapshot,{sourceSha256:digest('pipeline synthetic source'),cutoverAt:'2026-10-24T15:00:00.000Z'})
   assert.equal(bundle.report.canStage,true)
   assert.equal((await create(bundle.manifest)).status,200)
   for(let index=bundle.chunks.length-1;index>=0;index--)assert.equal((await upload(bundle.manifest,index,bundle.chunks[index])).status,200)
   const result=await verify(bundle.manifest);assert.equal(result.status,200,JSON.stringify(await result.json()))
   const opening=(await pool.query("SELECT sum((data->>'amount_millimes')::numeric)::text n FROM seed_rows WHERE job_id=$1 AND table_name='account_movements'",[bundle.manifest.jobId])).rows[0].n
   assert.equal(opening,'12345')
   assert.equal(Number((await pool.query('SELECT count(*) n FROM account_movements')).rows[0].n),0)
   assert.equal(Number((await pool.query('SELECT count(*) n FROM stock_movements')).rows[0].n),0)
   await cancel(bundle.manifest)
  })
  await t.test('existing business data prevents creating a new source seed',async()=>{
   await pool.query('INSERT INTO categories(id,nom,updated_by,device_id) VALUES($1,$2,$3,$4)',[newId(),'Existing business',user,deviceId])
   const rejected=await create(manifestFor([]));assert.equal(rejected.status,409);assert.equal((await rejected.json()).code,'BUSINESS_NOT_EMPTY')
  })
 }finally{
  await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end()
 }
})


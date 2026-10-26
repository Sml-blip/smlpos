import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { hash } from '@node-rs/argon2'
import { createPool,migrate } from '../src/db.ts'
import { createApp } from '../src/app.ts'
import { newId } from '../src/domain.ts'

test('Postgres/API: auth, replay, rollback, permissions, device limits and revocation', {skip:!process.env.TEST_DATABASE_URL}, async t=>{
 const admin=createPool(process.env.TEST_DATABASE_URL!)
 const schema=`test_${newId().replaceAll('-','')}`
 assert.match(schema,/^test_[0-9a-f]+$/)
 await admin.query(`CREATE SCHEMA ${schema}`)
 const uri=new URL(process.env.TEST_DATABASE_URL!);uri.searchParams.set('options',`-csearch_path=${schema}`)
 const pool=createPool(uri.toString())
 try{
  await migrate(pool);await migrate(pool)
  const user=newId();const password='synthetic-test-password-only'
  await pool.query('INSERT INTO app_users(id,username,password_hash,role) VALUES($1,$2,$3,$4)',[user,'fixture',await hash(password),'admin'])
  const key=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}).toString()
  const config={privateKey:key,issuer:'https://fixture.invalid',keyId:'fixture',minimumVersion:'1.10.0',liveWrites:true,syncUrl:'https://sync.fixture.invalid'}
  const app=createApp(pool,config)
  const deviceId=newId()
  const request=(path:string,body?:unknown,token?:string,version='1.10.0')=>app.request(path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Client-Version':version,...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)})
  const login=async(id:string)=>request('/auth/login',{username:'fixture',password,deviceId:id,deviceName:'Synthetic PC',platform:'development'})
  const session=await (await login(deviceId)).json()
  assert.ok(session.accessToken)
  const auth=session.accessToken
  await t.test('health is public; device data requires authentication and current version',async()=>{
   assert.equal((await request('/health')).status,200)
   assert.equal((await request('/devices')).status,401)
   assert.equal((await request('/devices',undefined,auth,'1.0.0')).status,426)
   assert.equal((await request('/devices/heartbeat',{},auth)).status,200)
  })
  const category=newId();const batch={transactionId:newId(),ops:[{op:'PUT',table:'categories',id:category,data:{nom:'Fixture'}}]}
  await t.test('concurrent identical retries apply once, changed replay conflicts',async()=>{
   const results=await Promise.all([request('/sync/upload',batch,auth),request('/sync/upload',batch,auth)])
   assert.deepEqual(results.map(r=>r.status),[200,200])
   assert.equal(Number((await pool.query('SELECT count(*) n FROM categories WHERE id=$1',[category])).rows[0].n),1)
   assert.equal((await request('/sync/upload',{...batch,ops:[{...batch.ops[0],data:{nom:'Different'}}]},auth)).status,409)
   assert.equal((await pool.query('SELECT nom FROM categories WHERE id=$1',[category])).rows[0].nom,'Fixture')
  })
  await t.test('failed batch rolls back prior writes and preserves rejection outside transaction',async()=>{
   const rejected=newId()
   const res=await request('/sync/upload',{transactionId:newId(),ops:[{op:'PUT',table:'categories',id:rejected,data:{nom:'Rollback'}},{op:'PUT',table:'evil_table',id:newId(),data:{}}]},auth)
   assert.equal(res.status,422)
   assert.equal(Number((await pool.query('SELECT count(*) n FROM categories WHERE id=$1',[rejected])).rows[0].n),0)
   assert.ok(Number((await pool.query('SELECT count(*) n FROM sync_rejections')).rows[0].n)>0)
  })
  await t.test('deferred FK rejection rolls back the complete transaction',async()=>{
   const res=await request('/sync/upload',{transactionId:newId(),ops:[{op:'PUT',table:'stock_movements',id:newId(),data:{product_id:newId(),qty_delta:1,reason:'opening',ref_type:'seed',ref_id:newId()}}]},auth)
   assert.equal(res.status,422)
   assert.equal(Number((await pool.query('SELECT count(*) n FROM stock_movements')).rows[0].n),0)
  })
  await t.test('same immutable row in new transaction is replay-safe, changed row is rejected',async()=>{
   const product=newId();const ledger=newId()
   const event={op:'PUT',table:'stock_movements',id:ledger,data:{product_id:product,qty_delta:2,reason:'opening',ref_type:'seed',ref_id:newId()}}
   assert.equal((await request('/sync/upload',{transactionId:newId(),ops:[{op:'PUT',table:'produits',id:product,data:{reference:'FIXTURE',nom:'Synthetic product'}},event]},auth)).status,200)
   assert.equal((await request('/sync/upload',{transactionId:newId(),ops:[event]},auth)).status,200)
   assert.equal((await request('/sync/upload',{transactionId:newId(),ops:[{...event,data:{...event.data,qty_delta:3}}]},auth)).status,422)
   await assert.rejects(pool.query('UPDATE stock_movements SET qty_delta=10 WHERE id=$1',[ledger]))
  })
  await t.test('refresh tokens rotate, stale tokens fail and staging data writes stay locked',async()=>{
   const rotated=await request('/auth/refresh',{refreshToken:session.refreshToken})
   assert.equal(rotated.status,200)
   assert.equal((await request('/auth/refresh',{refreshToken:session.refreshToken})).status,401)
   const locked=createApp(pool,{...config,liveWrites:false})
   assert.equal((await locked.request('/sync/upload',{method:'POST',headers:{Authorization:`Bearer ${auth}`,'X-Client-Version':'1.10.0','Content-Type':'application/json'},body:JSON.stringify(batch)})).status,503)
  })
  await t.test('three-device limit is enforced, revoked device cannot call API or refresh',async()=>{
   const second=newId();assert.equal((await login(second)).status,200)
   assert.equal((await login(newId())).status,200)
   assert.equal((await login(newId())).status,409)
   assert.equal((await request(`/devices/${second}/revoke`,{},auth)).status,200)
   assert.equal((await login(second)).status,403)
  })
 }finally{
  await pool.end()
  // Only this uniquely generated synthetic schema is removed; never public/business data.
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end()
 }
})


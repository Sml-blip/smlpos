import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import type { Pool } from 'pg'
import { createApp } from '../src/app.ts'

const privateKey=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}).toString()
function health(config:{liveWrites:boolean;seedStaging?:boolean;sync2Enabled?:boolean}){
 const pool={query:async()=>({rows:[{ok:1}]})} as unknown as Pool
 const app=createApp(pool,{privateKey,issuer:'https://fixture.invalid',keyId:'fixture',minimumVersion:'1.10.0',syncUrl:'https://sync.fixture.invalid',...config})
 return app.request('/health')
}

test('health reports sync2 and seed staging gates explicitly',async()=>{
 const disabled=await (await health({liveWrites:false})).json() as Record<string,unknown>
 assert.equal(disabled.seedStagingEnabled,false)
 assert.equal(disabled.sync2Enabled,false)
 assert.equal(disabled.liveWritesEnabled,false)

 const staging=await (await health({liveWrites:false,seedStaging:true,sync2Enabled:true})).json() as Record<string,unknown>
 assert.equal(staging.seedStagingEnabled,true)
 assert.equal(staging.sync2Enabled,true)
 assert.equal(staging.liveWritesEnabled,false)
})

test('staging-only API rejects public hosts while retaining loopback health access',async()=>{
 const pool={query:async()=>({rows:[{ok:1}]})} as unknown as Pool
 const app=createApp(pool,{privateKey,issuer:'https://fixture.invalid',keyId:'fixture',minimumVersion:'1.10.0',syncUrl:'https://sync.fixture.invalid',liveWrites:false,stagingOnly:true})
 assert.equal((await app.request('/health',{headers:{host:'127.0.0.1:13001'}})).status,200)
 assert.equal((await app.request('/health',{headers:{host:'127.0.0.1:23001'}})).status,200)
 assert.equal((await app.request('/health',{headers:{host:'api.pos.sml.boutique'}})).status,404)
})

import { readFile } from 'node:fs/promises'
import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { createPool,migrate } from './db.ts'
const database=process.env.DATABASE_URL
if(!database)throw new Error('DATABASE_URL is required')
const pool=createPool(database)
await migrate(pool)
const app=createApp(pool,{
 privateKey:await readFile(process.env.JWT_PRIVATE_KEY_PATH??'/run/secrets/jwt_private.pem','utf8'),
 keyId:process.env.JWT_KEY_ID??'pos-key-1',issuer:process.env.JWT_ISSUER??'https://api.pos.sml.boutique',
 minimumVersion:process.env.MIN_CLIENT_VERSION??'1.10.0',liveWrites:process.env.LIVE_WRITES_ENABLED==='true',
 syncUrl:process.env.SYNC_URL??'https://sync.pos.sml.boutique',
 seedStaging:process.env.SEED_STAGING_ENABLED==='true',
 sync2Enabled:process.env.SYNC2_ENABLED==='true',
 stagingOnly:process.env.STAGING_ONLY==='true',
})
const server=serve({fetch:app.fetch,port:Number(process.env.PORT??3000),hostname:'0.0.0.0'})
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{server.close(()=>{void pool.end().then(()=>process.exit(0))})})


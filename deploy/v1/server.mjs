import { serve } from '@hono/node-server'
import { poolFor,migrate } from './db.mjs'
import { createApp } from './app.mjs'
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required')
const pool=poolFor(process.env.DATABASE_URL)
await migrate(pool)
const server=serve({fetch:createApp(pool).fetch,port:Number(process.env.PORT??3000),hostname:'0.0.0.0'})
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>void pool.end().then(()=>process.exit(0))))

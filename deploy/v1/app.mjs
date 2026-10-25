import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { Fault } from './db.mjs'
import { authRoutes } from './auth.mjs'
import { seedRoutes } from './seed.mjs'
import { syncRoutes } from './sync.mjs'
export function createApp(pool,options={}){
 const app=new Hono()
 app.use('*',bodyLimit({maxSize:1_000_000,onError:c=>c.json({code:'body_too_large',message:'Batch exceeds limit'},413)}))
 app.use('*',async(c,next)=>{c.header('Cache-Control','no-store');c.header('X-Content-Type-Options','nosniff');await next()})
 app.onError((error,c)=>{
  if(error instanceof Fault)return c.json({code:error.code,message:error.message},error.status)
  if(error instanceof SyntaxError)return c.json({code:'invalid_json',message:'Invalid JSON'},422)
  console.error(JSON.stringify({event:'v1_failure',type:error.constructor.name,code:error.code??null}))
  return c.json({code:'server_error',message:'Service temporarily unavailable'},500)
 })
 const health=async c=>{await pool.query('SELECT 1');return c.json({ok:true,contract_version:1,minimum_version:options.minimumVersion??'1.9.1039',schema_version:'1.10.10'})}
 app.get('/health',health)
 app.get('/v1/health',health)
 authRoutes(app,pool,options);seedRoutes(app,pool);syncRoutes(app,pool)
 return app
}

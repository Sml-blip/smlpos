import { randomUUID } from 'node:crypto'
import { Fault,sha,text,transaction,one,issueSession,schema } from './db.mjs'
export function authRoutes(app,pool,{minimumVersion='1.9.1039'}={}){
 const attempts=new Map()
 app.use('/v1/*',async(c,next)=>{
  const now=Date.now(),key=c.req.header('X-Real-IP')??'local',bucket=attempts.get(key)??{until:now+60_000,n:0}
  for(const [ip,value] of attempts)if(value.until<now)attempts.delete(ip)
  if(bucket.until<now){bucket.until=now+60_000;bucket.n=0}
  if(++bucket.n>3000||attempts.size>5000)throw new Fault(429,'rate_limited')
  attempts.set(key,bucket);await next()
 })
 app.post('/v1/devices/register',async c=>{
  const input=await c.req.json();text(input.install_id);text(input.name,60);text(input.platform,30);text(input.app_version,30)
  const version=value=>value.split('.').map(Number)
  const current=version(input.app_version),minimum=version(minimumVersion)
  if(current.length!==3||current.some(n=>!Number.isSafeInteger(n)||n<0)||current.some((n,i)=>n!==minimum[i]&&current.slice(0,i).every((x,j)=>x===minimum[j])&&n<minimum[i]))throw new Fault(426,'client_update_required')
  if(input.schema_version!==schema.schema_version)throw new Fault(409,'schema_mismatch')
  return c.json(await transaction(pool,async db=>{
   const token=await one(db,'SELECT * FROM v1_enrollment WHERE hash=$1 AND expires_at>now()',[sha(text(input.enrollment_token,256))])
   if(!token||token.used_by&&token.used_by!==input.install_id)throw new Fault(403,'bad_token')
   const old=await one(db,'SELECT * FROM v1_devices WHERE install_id=$1',[input.install_id])
   if(old?.revoked||old&&old.role!==token.role)throw new Fault(403,'device_revoked')
   if(token.role==='seed'&&await one(db,"SELECT 1 FROM v1_devices WHERE role='seed' AND install_id<>$1",[input.install_id]))throw new Fault(409,'seed_device_exists')
   const id=old?.id??randomUUID()
   await db.query('INSERT INTO v1_devices(id,install_id,name,platform,app_version,role) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(install_id) DO UPDATE SET name=excluded.name,app_version=excluded.app_version,last_seen_at=now()',[id,input.install_id,input.name,input.platform,input.app_version,token.role])
   await db.query('UPDATE v1_enrollment SET used_by=$2 WHERE hash=$1',[token.hash,input.install_id])
   return {device_id:id,number_code:(await one(db,'SELECT number_code FROM v1_devices WHERE id=$1',[id])).number_code,session:await issueSession(db,id)}
  }))
 })
 app.post('/v1/auth/refresh',async c=>{
  const input=await c.req.json()
  return c.json(await transaction(pool,async db=>{
   const session=await one(db,'SELECT s.device_id FROM v1_sessions s JOIN v1_devices d ON d.id=s.device_id WHERE refresh_hash=$1 AND refresh_until>now() AND NOT d.revoked',[sha(text(input.refresh_token,256))])
   if(!session)throw new Fault(401,'session_expired')
   await db.query('DELETE FROM v1_sessions WHERE refresh_hash=$1',[sha(input.refresh_token)])
   return issueSession(db,session.device_id)
  }))
 })
 app.use('/v1/*',async(c,next)=>{
  const authorization=c.req.header('Authorization')??''
  if(!authorization.startsWith('Bearer '))throw new Fault(401,'unauthorized')
  const device=await one(pool,'SELECT d.* FROM v1_sessions s JOIN v1_devices d ON d.id=s.device_id WHERE s.access_hash=$1 AND s.access_until>now() AND NOT d.revoked',[sha(authorization.slice(7))])
  if(!device)throw new Fault(401,'unauthorized')
  await pool.query('UPDATE v1_devices SET last_seen_at=now() WHERE id=$1',[device.id])
  c.set('device',device);await next()
 })
 app.get('/v1/status',async c=>{
  const seed=await one(pool,'SELECT state,install_id FROM v1_seed WHERE singleton=1')
  const devices=(await pool.query("SELECT id device_id,number_code,name,platform,role,app_version,last_seen_at,(last_seen_at>now()-interval '45 seconds') online FROM v1_devices WHERE NOT revoked ORDER BY name")).rows
  const sequence=Number((await one(pool,'SELECT COALESCE(max(seq),0) n FROM v1_changes')).n)
  return c.json({server_time:new Date().toISOString(),contract_version:1,schema_version:schema.schema_version,min_client_version:minimumVersion,server_seq:sequence,devices,seed:seed??{state:'empty',install_id:null}})
 })
}

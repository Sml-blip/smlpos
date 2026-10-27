import { Hono } from 'hono'
import type { Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { SignJWT, jwtVerify } from 'jose'
import { createPrivateKey, createPublicKey, randomBytes } from 'node:crypto'
import { verify } from '@node-rs/argon2'
import { z } from 'zod'
import { ApiError, canonical, digest, newId, requireVersion, uploadSchema, uuid7, validateOperation } from './domain.ts'
import type { Pool } from './db.ts'
import { registerSeedRoutes } from './seed.ts'
import { registerSync2Routes } from './sync2.ts'

export type Config = { privateKey: string; issuer: string; keyId: string; minimumVersion: string; liveWrites: boolean; syncUrl: string; seedStaging?:boolean; sync2Enabled?:boolean; stagingOnly?:boolean }
type Identity = { userId: string; deviceId: string; role: string }
const loginSchema = z.object({ username: z.string().min(1).max(80), password: z.string().min(1).max(256), deviceId: uuid7, deviceName: z.string().trim().min(1).max(80), platform: z.enum(['windows','android','development']) }).strict()
const identifier = (value: string) => `"${value}"` // Only called after registry whitelist validation.

export function createApp(pool: Pool, config: Config) {
  const app = new Hono<{ Variables: { identity: Identity } }>()
  const privateKey = createPrivateKey(config.privateKey)
  const publicKey = createPublicKey(privateKey)
  const jwk = { ...publicKey.export({format:'jwk'}), kid:config.keyId, alg:'RS256', use:'sig' }
  const attempts = new Map<string,{ count:number; until:number }>()
  async function accessToken(userId:string, deviceId:string, role:string) {
    return new SignJWT({device_id:deviceId,role}).setProtectedHeader({alg:'RS256',kid:config.keyId}).setSubject(userId).setIssuer(config.issuer).setAudience('powersync').setIssuedAt().setExpirationTime('10m').sign(privateKey)
  }
  app.use('*', bodyLimit({maxSize:2*1024*1024,onError:c=>c.json({code:'BODY_TOO_LARGE'},413)}))
  app.use('*', async(c,next)=>{ c.header('Cache-Control','no-store'); c.header('X-Content-Type-Options','nosniff'); await next() })
  app.use('*',async(c,next)=>{
    if(config.stagingOnly){
      const host=(c.req.header('host')??'').toLowerCase()
      if(!['localhost','localhost:3000','localhost:13001','localhost:23001','127.0.0.1','127.0.0.1:3000','127.0.0.1:13001','127.0.0.1:23001','[::1]','[::1]:3000','[::1]:13001','[::1]:23001'].includes(host))return c.json({code:'STAGING_LOCAL_ONLY'},404)
    }
    await next()
  })
  app.onError((error,c)=>{
    if(error instanceof z.ZodError) return c.json({code:'INVALID_PAYLOAD',message:'Données invalides'},422)
    if(error instanceof ApiError) return c.json({code:error.code,message:error.message},error.status as 400)
    console.error(JSON.stringify({event:'api_failure',type:error.constructor.name}))
    return c.json({code:'SERVER_ERROR',message:'Service temporairement indisponible'},500)
  })
  app.get('/health',async c=>{
    await pool.query('SELECT 1')
    return c.json({ok:true,stage:'staging',schemaVersion:1,minClientVersion:config.minimumVersion,liveWritesEnabled:config.liveWrites,seedingEnabled:false,seedStagingEnabled:config.seedStaging===true,sync2Enabled:config.sync2Enabled===true,stagingOnly:config.stagingOnly===true})
  })
  app.get('/.well-known/jwks.json',c=>c.json({keys:[jwk]}))
  app.post('/auth/login',async c=>{
    const version=c.req.header('X-Client-Version')??''; requireVersion(version,config.minimumVersion)
    const data=loginSchema.parse(await c.req.json())
    const ip=c.req.header('X-Real-IP')??'local'
    const bucket=digest(`${ip}:${data.username.toLowerCase()}`)
    const now=Date.now()
    for(const [k,v] of attempts) if(v.until<now) attempts.delete(k)
    if(attempts.size>3000) throw new ApiError(429,'RATE_LIMIT','Réessayez plus tard')
    const entry=attempts.get(bucket)??{count:0,until:now+15*60_000}
    if(entry.count>=8) throw new ApiError(429,'RATE_LIMIT','Réessayez plus tard')
    entry.count++; attempts.set(bucket,entry)
    const user=(await pool.query('SELECT id,password_hash,role FROM app_users WHERE username=$1 AND active=true',[data.username])).rows[0]
    if(!user || !await verify(user.password_hash,data.password)) throw new ApiError(401,'INVALID_LOGIN','Identifiants incorrects')
    const client=await pool.connect(); let refresh=''
    try {
      await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(7311043)')
      const device=(await client.query('SELECT * FROM devices WHERE id=$1 FOR UPDATE',[data.deviceId])).rows[0]
      if(device && (device.user_id!==user.id || device.revoked_at)) throw new ApiError(403,'DEVICE_REVOKED','Appareil non autorisé')
      if(!device) {
        const count=Number((await client.query('SELECT count(*) n FROM devices WHERE revoked_at IS NULL')).rows[0].n)
        if(count>=3) throw new ApiError(409,'DEVICE_LIMIT','Trois appareils sont déjà inscrits')
        await client.query('INSERT INTO devices(id,user_id,name,platform,client_version) VALUES($1,$2,$3,$4,$5)',[data.deviceId,user.id,data.deviceName,data.platform,version])
      } else await client.query('UPDATE devices SET last_seen_at=now(),client_version=$2,name=$3 WHERE id=$1',[data.deviceId,version,data.deviceName])
      await client.query('DELETE FROM refresh_sessions WHERE device_id=$1',[data.deviceId])
      refresh=randomBytes(48).toString('base64url')
      await client.query("INSERT INTO refresh_sessions(token_hash,user_id,device_id,expires_at) VALUES($1,$2,$3,now()+interval '30 days')",[digest(refresh),user.id,data.deviceId])
      await client.query('COMMIT')
    } catch(error) {await client.query('ROLLBACK');throw error} finally{client.release()}
    attempts.delete(bucket)
    return c.json({accessToken:await accessToken(user.id,data.deviceId,user.role),refreshToken:refresh,expiresIn:600,syncUrl:config.syncUrl,role:user.role})
  })
  app.post('/auth/refresh',async c=>{
    requireVersion(c.req.header('X-Client-Version')??'',config.minimumVersion)
    const input=z.object({refreshToken:z.string().min(32).max(256)}).strict().parse(await c.req.json())
    const client=await pool.connect();let session;const refresh=randomBytes(48).toString('base64url')
    try{
      await client.query('BEGIN')
      session=(await client.query(`SELECT s.user_id,s.device_id,u.role FROM refresh_sessions s JOIN app_users u ON u.id=s.user_id JOIN devices d ON d.id=s.device_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true AND d.revoked_at IS NULL FOR UPDATE OF s`,[digest(input.refreshToken)])).rows[0]
      if(!session)throw new ApiError(401,'SESSION_EXPIRED','Reconnectez cet appareil')
      await client.query('DELETE FROM refresh_sessions WHERE token_hash=$1',[digest(input.refreshToken)])
      await client.query("INSERT INTO refresh_sessions(token_hash,user_id,device_id,expires_at) VALUES($1,$2,$3,now()+interval '30 days')",[digest(refresh),session.user_id,session.device_id])
      await client.query('COMMIT')
    }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
    return c.json({accessToken:await accessToken(session.user_id,session.device_id,session.role),refreshToken:refresh,expiresIn:600,syncUrl:config.syncUrl,role:session.role})
  })
  app.use('/devices/*',async(c,next)=>{await authenticate(c);await next()})
  app.use('/devices',async(c,next)=>{await authenticate(c);await next()})
  app.use('/sync/*',async(c,next)=>{await authenticate(c);await next()})
  app.use('/seed/*',async(c,next)=>{await authenticate(c);await next()})
  app.use('/sync2/*',async(c,next)=>{await authenticate(c);await next()})
  async function authenticate(c: Context<{ Variables: { identity: Identity } }>) {
    requireVersion(c.req.header('X-Client-Version')??'',config.minimumVersion)
    let identity:Identity
    try {
      const {payload}=await jwtVerify((c.req.header('Authorization')??'').replace(/^Bearer /,''),publicKey,{algorithms:['RS256'],issuer:config.issuer,audience:'powersync'})
      identity={userId:uuid7.parse(payload.sub),deviceId:uuid7.parse(payload.device_id),role:String(payload.role)}
    }catch{throw new ApiError(401,'AUTH_REQUIRED','Connexion requise')}
    const row=(await pool.query('SELECT d.id,u.role FROM devices d JOIN app_users u ON u.id=d.user_id WHERE d.id=$1 AND d.user_id=$2 AND d.revoked_at IS NULL AND u.active=true',[identity.deviceId,identity.userId])).rows[0]
    if(!row)throw new ApiError(403,'DEVICE_REVOKED','Appareil non autorisé')
    identity.role=row.role;c.set('identity',identity)
  }
  app.get('/devices',async c=>{
    const identity=c.get('identity')
    const rows=(await pool.query(`SELECT id,name,platform,client_version,importer,last_seen_at,revoked_at,(revoked_at IS NULL AND last_seen_at>now()-interval '90 seconds') AS online FROM devices WHERE $1 IN ('admin','manager') OR id=$2 ORDER BY created_at`,[identity.role,identity.deviceId])).rows
    return c.json({devices:rows,currentDeviceId:identity.deviceId})
  })
  app.post('/devices/heartbeat',async c=>{
    const identity=c.get('identity');await pool.query('UPDATE devices SET last_seen_at=now(),client_version=$2 WHERE id=$1',[identity.deviceId,c.req.header('X-Client-Version')])
    return c.json({ok:true,serverTime:new Date().toISOString()})
  })
  app.post('/devices/:id/revoke',async c=>{
    const identity=c.get('identity');if(identity.role!=='admin')throw new ApiError(403,'ROLE_FORBIDDEN','Administrateur requis')
    const id=uuid7.parse(c.req.param('id'))
    await pool.query('UPDATE devices SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1',[id])
    await pool.query('DELETE FROM refresh_sessions WHERE device_id=$1',[id])
    return c.json({ok:true})
  })
  app.get('/sync/status',async c=>{
    const identity=c.get('identity')
    const rejections=(await pool.query('SELECT id,transaction_id,code,message,created_at FROM sync_rejections WHERE device_id=$1 ORDER BY created_at DESC LIMIT 25',[identity.deviceId])).rows
    return c.json({stage:'staging',liveWritesEnabled:config.liveWrites,seedingEnabled:false,rejections,importState:'awaiting_verified_dry_run'})
  })
  app.post('/sync/upload',async c=>{
    if(!config.liveWrites)throw new ApiError(503,'MIGRATION_NOT_APPROVED','Synchronisation des données en attente de validation')
    const identity=c.get('identity');const upload=uploadSchema.parse(await c.req.json());const hash=digest(canonical(upload))
    const client=await pool.connect()
    try{
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${identity.deviceId}:${upload.transactionId}`])
      const previous=(await client.query('SELECT payload_hash FROM upload_transactions WHERE device_id=$1 AND transaction_id=$2',[identity.deviceId,upload.transactionId])).rows[0]
      if(previous){
        if(previous.payload_hash!==hash)throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Identifiant de transaction déjà utilisé')
        await client.query('COMMIT');return c.json({ok:true,replayed:true})
      }
      for(const op of upload.ops){
        const table=validateOperation(op,identity.role);const data={...op.data};const name=identifier(op.table)
        if(op.op==='DELETE'){
          await client.query(`UPDATE ${name} SET deleted_at=now(),updated_at=now(),updated_by=$2,device_id=$3 WHERE id=$1`,[op.id,identity.userId,identity.deviceId]);continue
        }
        const columns=Object.keys(data);const values=columns.map(k=>data[k]);const names=columns.map(identifier)
        if(op.op==='PATCH'){
          if(!columns.length)throw new ApiError(422,'EMPTY_PATCH','Modification vide')
          const result=await client.query(`UPDATE ${name} SET ${names.map((n,i)=>`${n}=$${i+1}`).join(',')},updated_at=now(),updated_by=$${values.length+1},device_id=$${values.length+2} WHERE id=$${values.length+3} AND deleted_at IS NULL`,[...values,identity.userId,identity.deviceId,op.id])
          if(!result.rowCount)throw new ApiError(422,'ROW_MISSING','Enregistrement introuvable')
        }else{
          const allNames=['id',...columns,'updated_by','device_id'];const allValues=[op.id,...values,identity.userId,identity.deviceId]
          const placeholders=allValues.map((_,i)=>`$${i+1}`).join(',')
          const conflict=table.lww?`DO UPDATE SET ${[...names.map(n=>`${n}=excluded.${n}`),'updated_at=now()','updated_by=excluded.updated_by','device_id=excluded.device_id'].join(',')} WHERE ${name}.deleted_at IS NULL`:'DO NOTHING'
          const inserted=await client.query(`INSERT INTO ${name}(${allNames.map(identifier).join(',')}) VALUES(${placeholders}) ON CONFLICT(id) ${conflict} RETURNING id`,allValues)
          if(!inserted.rowCount){
            const same=(await client.query(`SELECT to_jsonb(t) @> $2::jsonb AS same FROM ${name} t WHERE id=$1`,[op.id,JSON.stringify(data)])).rows[0]?.same
            if(!same)throw new ApiError(422,'IMMUTABLE_RECORD','Historique existant différent')
          }
        }
      }
      for(const op of upload.ops.filter(op=>op.table==='documents' && op.op==='PUT')){
        const sums=(await client.query('SELECT count(*)::integer n,COALESCE(sum(total_ttc),0)::text total FROM lignes_document WHERE document_id=$1',[op.id])).rows[0]
        if(!sums.n || BigInt(sums.total)!==BigInt(String(op.data?.total_ttc)))throw new ApiError(422,'INVOICE_TOTAL_MISMATCH','Les lignes et le total doivent correspondre')
      }
      await client.query('INSERT INTO upload_transactions(device_id,transaction_id,payload_hash) VALUES($1,$2,$3)',[identity.deviceId,upload.transactionId,hash])
      await client.query('COMMIT');return c.json({ok:true,replayed:false})
    }catch(error){
      await client.query('ROLLBACK')
      let failure=error
      if(!(error instanceof ApiError)){
        const pgCode=(error as {code?:string}).code??''
        failure=pgCode.startsWith('23')?new ApiError(422,'CONSTRAINT_REJECTED','Contrainte métier non respectée'):new ApiError(503,'RETRY_REQUIRED','Réessayez cette transaction')
      }
      if(failure instanceof ApiError && failure.status>=400 && failure.status<500)await pool.query('INSERT INTO sync_rejections(id,device_id,transaction_id,code,message) VALUES($1,$2,$3,$4,$5)',[newId(),identity.deviceId,upload.transactionId,failure.code,failure.message])
      throw failure
    }finally{client.release()}
  })
  registerSeedRoutes(app,pool,config.seedStaging===true)
  registerSync2Routes(app,pool,config.sync2Enabled===true)
  app.notFound(c=>c.json({code:'NOT_FOUND'},404))
  return app
}


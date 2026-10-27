import { hash } from '@node-rs/argon2'
import { createPool,migrate } from './db.ts'
import { newId } from './domain.ts'
// Provision through stdin or a protected file. Never put passwords in CLI args/logs.
if(process.argv[2]!=='create-user')throw new Error('Usage: admin.ts create-user < protected-user.json')
let input='';for await(const chunk of process.stdin)input+=chunk
const data=JSON.parse(input)
if(typeof data.username!=='string'||!/^[a-zA-Z0-9_.-]{3,80}$/.test(data.username)||typeof data.password!=='string'||data.password.length<12||!['admin','manager','cashier'].includes(data.role))throw new Error('Invalid user input')
const pool=createPool(process.env.DATABASE_URL??'')
try{
 if(process.env.SKIP_STARTUP_MIGRATION==='true') {
  const target=new URL(process.env.DATABASE_URL??'')
  if(process.env.STAGING_ONLY!=='true'||target.protocol!=='postgresql:'||target.hostname!=='postgres'||target.port!=='5432'||target.username!=='pos_api'||target.pathname!=='/smlpos_staging'||target.search||target.hash)throw new Error('Refusing non-staging migration bypass')
 } else await migrate(pool)
 const client=await pool.connect()
 try{
  await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(7311044)')
  if(Number((await client.query('SELECT count(*) n FROM app_users WHERE active=true')).rows[0].n)>=3)throw new Error('Maximum three active users')
  await client.query('INSERT INTO app_users(id,username,password_hash,role) VALUES($1,$2,$3,$4)',[newId(),data.username,await hash(data.password,{memoryCost:65536,timeCost:3,parallelism:1}),data.role])
  await client.query('COMMIT');console.log('User created; credentials were not printed.')
 }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}finally{await pool.end()}


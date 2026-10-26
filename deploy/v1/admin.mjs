import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { poolFor,migrate,sha } from './db.mjs'
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required')
const pool=poolFor(process.env.DATABASE_URL)
try{
 await migrate(pool)
 const [command,arg,output]=process.argv.slice(2)
 if(command==='enroll'&&['seed','replica'].includes(arg)&&output){
  const token=randomBytes(40).toString('base64url')
  await pool.query("INSERT INTO v1_enrollment(hash,role,expires_at) VALUES($1,$2,now()+interval '72 hours')",[sha(token),arg])
  writeFileSync(output,JSON.stringify({url:'https://api.pos.sml.boutique',role:arg,enrollment_token:token,expires_at:new Date(Date.now()+72*3600_000).toISOString()},null,2)+'\n',{mode:0o600,flag:'wx'})
  console.log('Enrollment file created; token is not logged.')
 }else if(command==='revoke'&&/^[a-f0-9-]{36}$/.test(arg??'')){
  await pool.query('UPDATE v1_devices SET revoked=true WHERE id=$1',[arg]);console.log('Device revoked.')
 }else if(command==='status'){
  const seed=(await pool.query('SELECT state,install_id FROM v1_seed')).rows
  console.log(JSON.stringify({seed,devices:(await pool.query('SELECT id,number_code,name,role,revoked,last_seen_at FROM v1_devices')).rows,rows:(await pool.query('SELECT count(*) FROM v1_rows WHERE NOT deleted')).rows[0].count}))
 }else throw new Error('Usage: enroll seed|replica /private/new-file.json; revoke UUID; status')
}finally{await pool.end()}

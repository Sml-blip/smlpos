import { createRequire } from 'node:module'
import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, realpathSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { build } from 'esbuild'
import { createPool, migrate } from '../../deploy/api/src/db.ts'
import { createApp } from '../../deploy/api/src/app.ts'
import { newId } from '../../deploy/api/src/domain.ts'

export async function desktopProof(databaseUrl, { seed } = {}) {
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..')
  const requireApi=createRequire(join(root,'deploy/api/package.json'))
  const {serve}=requireApi('@hono/node-server'),{hash}=requireApi('@node-rs/argon2')
  const admin=createPool(databaseUrl),schema='test_'+newId().replaceAll('-','')
  const tempRoot=realpathSync(tmpdir()),temporary=mkdtempSync(join(tempRoot,'smlpos-http-proof-'))
  let pool,server
  try {
    await admin.query(`CREATE SCHEMA ${schema}`)
    const url=new URL(databaseUrl);url.searchParams.set('options',`-csearch_path=${schema}`)
    pool=createPool(url.toString());await migrate(pool)
    const password=randomUUID()
    await pool.query('INSERT INTO app_users(id,username,password_hash,role) VALUES($1,$2,$3,$4)',[newId(),'desktop-proof',await hash(password),'admin'])
    const privateKey=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}).toString()
    const app=createApp(pool,{privateKey,keyId:'fixture',issuer:'https://fixture.invalid',minimumVersion:'1.9.1039',liveWrites:false,sync2Enabled:true,syncUrl:'https://fixture.invalid'})
    server=serve({fetch:app.fetch,hostname:'127.0.0.1',port:0})
    if(!server.listening)await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)})
    const address=server.address()
    const bundle=join(temporary,'desktop-proof.cjs')
    await build({entryPoints:[join(root,'scripts/e2e-two-pc/desktop-proof.ts')],outfile:bundle,bundle:true,platform:'node',format:'cjs',target:'node20',external:['better-sqlite3'],alias:{electron:join(root,'scripts/seed-test/electron-stub.mjs')},logLevel:'error'})
    const runtime=process.env.SMLPOS_SEED_TEST_RUNTIME||join(root,'node_modules/electron/dist',process.platform==='win32'?'electron.exe':'electron')
    const code=await new Promise((resolve,reject)=>{
      const child=spawn(runtime,[bundle],{cwd:root,windowsHide:true,stdio:'inherit',env:{...process.env,ELECTRON_RUN_AS_NODE:'1',NODE_PATH:join(root,'node_modules'),USERPROFILE:join(temporary,'profile'),APPDATA:join(temporary,'roaming'),LOCALAPPDATA:join(temporary,'local'),SMLSEED_TMP:temporary,SMLPOS_PROOF_URL:`http://127.0.0.1:${address.port}`,SMLPOS_PROOF_PASSWORD:password,...(seed?{SMLPOS_WORKLOAD_SEED:String(seed)}:{})}})
      const timer=setTimeout(()=>{child.kill();reject(new Error('Desktop proof exceeded 120 seconds'))},120000)
      child.once('error',error=>{clearTimeout(timer);reject(error)})
      child.once('exit',code=>{clearTimeout(timer);resolve(code)})
    })
    if(code!==0)throw new Error(`Desktop HTTP proof failed (exit ${code})`)
    if(seed){
      const deviceStocks=JSON.parse(readFileSync(join(temporary,'stock-check.json'),'utf8'))
      const serverStocks=(await pool.query("SELECT row_id AS id, (payload->>'stock_actuel')::numeric AS stock_actuel FROM sync2_records WHERE table_name='produits' AND NOT deleted ORDER BY row_id")).rows
      const normalize=rows=>rows.map(row=>({id:row.id,stock_actuel:row.stock_actuel===null?null:Number(row.stock_actuel)}))
      if(JSON.stringify(normalize(deviceStocks))!==JSON.stringify(normalize(serverStocks)))throw new Error(`Server and client product stock differ for seed ${seed}`)
      console.log(`PASS server/client stock reconciliation seed=${seed} products=${serverStocks.length}`)
    }
    console.log('PASS: two independent desktop databases converge through HTTP + PostgreSQL.')
  } finally {
    if(server){server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve))}
    if(pool)await pool.end()
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end()
    if(dirname(realpathSync(temporary))!==tempRoot||!basename(temporary).startsWith('smlpos-http-proof-'))throw new Error('Unsafe proof cleanup path')
    rmSync(temporary,{recursive:true,force:true})
  }
}

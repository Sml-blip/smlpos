import { readFileSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { build } from 'esbuild'
import { newId } from '../../deploy/api/src/domain.ts'

// This mode requires a freshly deployed, disposable staging project. It never
// performs database cleanup; destroying the entire staging project is the cleanup.
export async function externalProof(baseUrl,password,seed) {
  if(baseUrl!=='http://127.0.0.1:23001')throw new Error('External URL must be exactly http://127.0.0.1:23001')
  const health=await fetch(baseUrl+'/health').then(async r=>{if(!r.ok)throw new Error(`Staging health HTTP ${r.status}`);return r.json()})
  if(health.stage!=='staging'||health.stagingOnly!==true||health.liveWritesEnabled!==true||health.seedStagingEnabled!==true||health.sync2Enabled!==true)
    throw new Error('Refusing endpoint without all required staging-only flags')
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..')
  const tempRoot=realpathSync(tmpdir()),temporary=mkdtempSync(join(tempRoot,'smlpos-external-proof-'))
  try {
    const bundle=join(temporary,'desktop-proof.cjs')
    await build({entryPoints:[join(root,'scripts/e2e-two-pc/desktop-proof.ts')],outfile:bundle,bundle:true,platform:'node',format:'cjs',target:'node20',external:['better-sqlite3'],alias:{electron:join(root,'scripts/seed-test/electron-stub.mjs')},logLevel:'error'})
    const runtime=process.env.SMLPOS_SEED_TEST_RUNTIME||join(root,'node_modules/electron/dist',process.platform==='win32'?'electron.exe':'electron')
    const code=await new Promise((resolve,reject)=>{
      const child=spawn(runtime,[bundle],{cwd:root,windowsHide:true,stdio:'inherit',env:{...process.env,ELECTRON_RUN_AS_NODE:'1',NODE_PATH:join(root,'node_modules'),USERPROFILE:join(temporary,'profile'),APPDATA:join(temporary,'roaming'),LOCALAPPDATA:join(temporary,'local'),SMLSEED_TMP:temporary,SMLPOS_PROOF_URL:baseUrl,SMLPOS_PROOF_PASSWORD:password,SMLPOS_WORKLOAD_SEED:String(seed)}})
      const timer=setTimeout(()=>{child.kill();reject(new Error('Desktop proof exceeded 120 seconds'))},120000)
      child.once('error',error=>{clearTimeout(timer);reject(error)})
      child.once('exit',code=>{clearTimeout(timer);resolve(code)})
    })
    if(code!==0)throw new Error(`Desktop HTTP proof failed (exit ${code})`)
    // Read server events with a separate synthetic third device. Product stock
    // is materialized by the server as the sum of its immutable stock movements.
    const version='1.9.1039'
    const login=await fetch(baseUrl+'/auth/login',{method:'POST',headers:{'content-type':'application/json','X-Client-Version':version},body:JSON.stringify({username:'desktop-proof',password,deviceId:newId(),deviceName:'Proof verifier',platform:'development'})})
    if(!login.ok)throw new Error(`Verifier login HTTP ${login.status}`)
    const {accessToken}=await login.json()
    const headers={authorization:`Bearer ${accessToken}`,'X-Client-Version':version}
    const products=new Map(),movements=new Map();let since='0'
    do {
      const response=await fetch(baseUrl+`/sync2/pull?since=${since}&limit=500`,{headers})
      if(!response.ok)throw new Error(`Verifier pull HTTP ${response.status}`)
      const page=await response.json()
      for(const row of page.rows){
        if(row.table_name==='produits'){
          if(row.deleted)products.delete(row.row_id);else products.set(row.row_id,true)
        }else if(row.table_name==='stock_movements'){
          if(row.deleted)movements.delete(row.row_id);else movements.set(row.row_id,row.payload)
        }
      }
      since=page.nextSeq
      if(!page.hasMore)break
    }while(true)
    const stock=new Map([...products.keys()].map(id=>[id,0]))
    for(const movement of movements.values())if(stock.has(movement.produit_id))stock.set(movement.produit_id,stock.get(movement.produit_id)+Number(movement.delta))
    const actual=JSON.parse(readFileSync(join(temporary,'stock-check.json'),'utf8'))
    if(actual.length!==stock.size||actual.some(row=>!stock.has(row.id)||Number(row.stock_actuel??0)!==stock.get(row.id)))
      throw new Error('Server movement totals and device stocks differ')
    console.log(`PASS remote event/client stock reconciliation seed=${seed} products=${actual.length}`)
  } finally {
    if(dirname(realpathSync(temporary))!==tempRoot||!basename(temporary).startsWith('smlpos-external-proof-'))throw new Error('Unsafe proof cleanup path')
    rmSync(temporary,{recursive:true,force:true})
  }
}

import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
await build({entryPoints:['scripts/seed-test/export-contract.ts'],bundle:true,platform:'node',format:'cjs',target:'node20',outfile:'out/export-contract.cjs',external:['better-sqlite3'],alias:{electron:fileURLToPath(new URL('./electron-stub.mjs',import.meta.url))},logLevel:'error'})
mkdirSync('deploy/v1',{recursive:true})
const root=realpathSync(tmpdir()),tmp=mkdtempSync(join(root,'smlpos-contract-'))
try {
 const result=spawnSync(process.env.SMLPOS_SEED_TEST_RUNTIME||process.execPath,['out/export-contract.cjs',resolve('deploy/v1/schema.json')],{stdio:'inherit',windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:'1',SMLSEED_TMP:tmp,APPDATA:tmp,LOCALAPPDATA:tmp}})
 if(result.error)throw result.error
 if(result.status!==0)throw new Error('Contract export failed')
} finally {
 if(dirname(realpathSync(tmp))!==root||!basename(tmp).startsWith('smlpos-contract-'))throw new Error('Unsafe cleanup')
 rmSync(tmp,{recursive:true,force:true})
}

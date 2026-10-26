import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const apiDir = resolve(repoRoot, 'deploy/api')
const rawUrl = process.env.SMLPOS_E2E_TEST_DATABASE_URL
const allowedName = process.env.SMLPOS_E2E_ALLOW_SCRATCH_DB

if (!rawUrl || !allowedName) {
  console.error('Two-PC e2e requires SMLPOS_E2E_TEST_DATABASE_URL and an exact SMLPOS_E2E_ALLOW_SCRATCH_DB name.')
  process.exit(2)
}

let databaseUrl
try { databaseUrl = new URL(rawUrl) }
catch { console.error('SMLPOS_E2E_TEST_DATABASE_URL must be a PostgreSQL URL.'); process.exit(2) }

const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1))
if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol) || !databaseName || databaseName !== allowedName ||
    !/(?:^|[-_])(test|scratch|e2e)(?:$|[-_])/i.test(databaseName) || /(?:^|[-_])(prod|production|live)(?:$|[-_])/i.test(databaseName)) {
  console.error('Refusing to run: database must be an explicitly named scratch/test/e2e PostgreSQL database. URL was not printed.')
  process.exit(2)
}

console.log(`Running synthetic two-device API integration against scratch database "${databaseName}".`)
console.log('The API test creates a random schema and drops it on completion; no production URL is read.')
const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', 'test/sync2.test.ts'], {
  cwd: apiDir,
  stdio: 'inherit',
  windowsHide: true,
  env: { ...process.env, TEST_DATABASE_URL: databaseUrl.toString() },
})
if (result.error) console.error(result.error.message)
if(result.status!==0)process.exit(result.status??1)
const {desktopProof}=await import('./proof.mjs')
await desktopProof(databaseUrl.toString())

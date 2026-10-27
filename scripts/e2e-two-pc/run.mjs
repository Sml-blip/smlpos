import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const apiDir = resolve(repoRoot, 'deploy/api')
let seeds = 20
let seedsSpecified = false
let baseUrl
for (let index=2; index<process.argv.length; index++) {
  if (process.argv[index] === '--seeds') { seeds = Number(process.argv[++index]); seedsSpecified = true }
  else if (process.argv[index] === '--base-url') {
    baseUrl = process.argv[++index]
    if (!baseUrl) { console.error('--base-url requires a value.'); process.exit(2) }
  }
  else { console.error(`Unknown option: ${process.argv[index]}`); process.exit(2) }
}
if (!Number.isSafeInteger(seeds) || seeds < 1 || seeds > 1000) {
  console.error('--seeds must be an integer between 1 and 1000.'); process.exit(2)
}
if (baseUrl !== undefined) {
  if(baseUrl!=='http://127.0.0.1:23001') { console.error('Refusing external URL: only http://127.0.0.1:23001 is allowed.'); process.exit(2) }
  if(!seedsSpecified) seeds=1
  if(seeds!==1) { console.error('External mode requires one seed per disposable staging project; teardown is the cleanup.'); process.exit(2) }
  let credentials
  try { credentials=JSON.parse(readFileSync(0,'utf8')) } catch { console.error('External mode requires synthetic admin JSON on stdin.'); process.exit(2) }
  if(credentials.username!=='desktop-proof'||typeof credentials.password!=='string'||credentials.password.length<12) {
    console.error('Invalid synthetic admin input.'); process.exit(2)
  }
  try {
    const {externalProof}=await import('./external-proof.mjs')
    await externalProof(baseUrl,credentials.password,1)
    console.log('RESULT external seeds_requested=1 passed=1 failed=0')
  } catch(error) {
    console.error('FAIL external seed=1:',error.message)
    console.error('RESULT external seeds_requested=1 passed=0 failed=1')
    process.exitCode=1
  }
  process.exit()
}
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
    !['127.0.0.1','localhost','[::1]'].includes(databaseUrl.hostname) ||
    !/(?:^|[-_])(test|scratch|e2e)(?:$|[-_])/i.test(databaseName) || /(?:^|[-_])(prod|production|live)(?:$|[-_])/i.test(databaseName)) {
  console.error('Refusing to run: database must be an explicitly named scratch/test/e2e PostgreSQL database. URL was not printed.')
  process.exit(2)
}

console.log(`Running synthetic two-device API integration against scratch database "${databaseName}".`)
console.log('The API test creates a random schema and drops it on completion; no production URL is read.')
const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', 'test/sync2.test.ts', 'test/integration.test.ts'], {
  cwd: apiDir,
  stdio: 'inherit',
  windowsHide: true,
  env: { ...process.env, TEST_DATABASE_URL: databaseUrl.toString() },
})
if (result.error) console.error(result.error.message)
if(result.status!==0)process.exit(result.status??1)
const {desktopProof}=await import('./proof.mjs')
let passed=0
for(let seed=1;seed<=seeds;seed++) {
  console.log(`RUN random seed=${seed} operations=200`)
  try { await desktopProof(databaseUrl.toString(),{seed}); passed++ }
  catch(error) {
    console.error(`FAIL random seed=${seed}:`,error)
    console.error(`RESULT seeds_requested=${seeds} passed=${passed} failed=1`)
    process.exitCode=1
    break
  }
}
if(passed===seeds)console.log(`RESULT seeds_requested=${seeds} passed=${passed} failed=0`)

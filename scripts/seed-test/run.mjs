import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdirSync, mkdtempSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'
const tempRoot = realpathSync(tmpdir())
const isolated = mkdtempSync(join(tempRoot, 'smlpos-seed-tests-'))
const bundleDir = join(isolated, 'bundle')
mkdirSync(bundleDir)
await build({
  entryPoints: ['src/main/seed/__tests__/seed.test.ts', 'src/main/seed/__tests__/outbox.test.ts', 'src/main/seed/__tests__/ordering.test.ts', 'src/main/seed/__tests__/drainer.test.ts', 'src/main/seed/__tests__/pull.test.ts', 'src/main/seed/__tests__/monitor.test.ts'],
  bundle: true, platform: 'node', format: 'cjs', target: 'node20',
  outdir: bundleDir, outExtension: { '.js': '.cjs' },
  external: ['better-sqlite3', 'typescript'],
  alias: { electron: fileURLToPath(new URL('./electron-stub.mjs', import.meta.url)) },
  logLevel: 'error',
})
let status = 1
try {
  const r = spawnSync(process.env.SMLPOS_SEED_TEST_RUNTIME || process.execPath,
    ['--test', '--test-reporter=spec', ...['seed', 'outbox', 'ordering', 'drainer', 'pull', 'monitor'].map(name => join(bundleDir, `${name}.test.cjs`))],
    { stdio: 'inherit', windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: join(process.cwd(), 'node_modules'),
      APPDATA: join(isolated, 'roaming'), LOCALAPPDATA: join(isolated, 'local'), SMLSEED_TMP: isolated } })
  if (r.error) console.error(r.error.message)
  status = r.status ?? 1
} finally {
  if (dirname(realpathSync(isolated)) !== tempRoot || !basename(isolated).startsWith('smlpos-seed-tests-')) throw new Error('Unsafe fixture cleanup path')
  rmSync(isolated, { recursive: true, force: true })
}
process.exit(status)

import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
await build({
  entryPoints: ['src/main/seed/__tests__/seed.test.ts'],
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  outfile: 'out/seed-test/seed.test.mjs',
  external: ['better-sqlite3'],
  alias: { electron: new URL('./electron-stub.mjs', import.meta.url).pathname },
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  logLevel: 'error',
})
const r = spawnSync('node', ['--test', '--test-reporter=spec', 'out/seed-test/seed.test.mjs'], { stdio: 'inherit' })
process.exit(r.status ?? 1)

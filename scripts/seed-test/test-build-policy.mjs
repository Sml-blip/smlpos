import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'

const compiled = await build({
  entryPoints: ['src/main/seed/client.ts'], bundle: true, platform: 'node', format: 'cjs',
  external: ['better-sqlite3'], define: { __SML_TEST_BUILD__: 'true' }, write: false,
})
const require = createRequire(join(process.cwd(), 'package.json'))
const module = { exports: {} }
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(require, module, module.exports)
const { BackendClient, validateBaseUrl } = module.exports
const base = { appVersion: '1.9.1039', loadSession: () => null, saveSession: () => {}, maxAttempts: 1 }

test('test build rejects production, alternate ports and credentialed URLs before requests', () => {
  for (const url of ['https://api.pos.sml.boutique', 'http://127.0.0.1:13000', 'http://user@127.0.0.1:23001']) {
    assert.throws(() => validateBaseUrl(url), /Test build requires/)
    assert.throws(() => new BackendClient({ ...base, baseUrl: url }), /Test build requires/)
  }
  assert.equal(validateBaseUrl('http://127.0.0.1:23001'), 'http://127.0.0.1:23001')
})

test('test-build loopback request refuses redirects', async () => {
  let observed
  const client = new BackendClient({ ...base, baseUrl: 'http://127.0.0.1:23001', fetchImpl: async (url, options) => {
    observed = { url, redirect: options.redirect }
    throw new Error('synthetic request; no network')
  } })
  await assert.rejects(client.register('test', 'synthetic-password', 'test-device', { name: 'test', platform: 'windows' }))
  assert.deepEqual(observed, { url: 'http://127.0.0.1:23001/auth/login', redirect: 'error' })
})

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const sourcePath = new URL('../src/main/printer/PrinterService.ts', import.meta.url)
const compiled = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
})
assert.equal(compiled.diagnostics?.length ?? 0, 0, 'PrinterService must transpile')

// No Electron instance, filesystem writes, timers, or printer drivers are used.
function harness(behavior = {}) {
  const windows = []
  const files = new Map()
  const timers = new Map()
  let uuid = 0
  let nextTimer = 0
  let unlinkCount = 0
  class MockWindow extends EventEmitter {
    constructor() {
      super()
      if (behavior.constructorThrow) throw new Error('window unavailable')
      this.destroyed = false
      this.destroyCount = 0
      this.printCalls = []
      this.webContents = new EventEmitter()
      this.webContents.executeJavaScript = () => behavior.readiness ?? Promise.resolve()
      this.webContents.print = (options, callback) => {
        this.printCalls.push({ options, callback })
        if (behavior.printThrow) throw new Error('driver threw')
      }
      windows.push(this)
    }
    loadFile(filePath) {
      this.filePath = filePath
      if (behavior.loadThrow) throw new Error('load threw')
      return behavior.loadReject ? Promise.reject(new Error('load rejected')) : Promise.resolve()
    }
    isDestroyed() { return this.destroyed }
    destroy() {
      this.destroyCount += 1
      if (this.destroyed) return
      this.destroyed = true
      this.webContents.emit('destroyed')
      this.emit('closed')
    }
  }
  const exports = {}
  const mocks = {
    child_process: {},
    crypto: { randomUUID: () => `uuid-${++uuid}` },
    fs: {
      existsSync: () => false,
      writeFileSync: (filePath, content) => {
        if (behavior.writeThrow) throw new Error('disk full')
        files.set(filePath, content)
      },
      unlinkSync: (filePath) => { unlinkCount += 1; files.delete(filePath) },
    },
    path,
    os: { tmpdir: () => 'mock-temp' },
    electron: { BrowserWindow: MockWindow, ipcMain: {} },
    'label-printer': { labels: {}, printers: {} },
    './LabelTemplate': { Label40x20: {} },
  }
  vm.runInNewContext(compiled.outputText, {
    exports,
    module: { exports },
    require: (id) => {
      assert.ok(Object.hasOwn(mocks, id), `Unexpected dependency: ${id}`)
      return mocks[id]
    },
    Buffer,
    setTimeout: (callback, delay) => {
      const id = ++nextTimer
      timers.set(id, { callback, delay })
      return id
    },
    clearTimeout: (id) => timers.delete(id),
  }, { filename: sourcePath.pathname })
  return {
    service: exports.PrinterService,
    windows,
    files,
    timers,
    get unlinkCount() { return unlinkCount },
    expire: () => {
      for (const [id, timer] of [...timers]) {
        timers.delete(id)
        timer.callback()
      }
    },
  }
}

const flush = () => new Promise(setImmediate)
async function ready(window) {
  window.webContents.emit('did-finish-load')
  await flush()
}
function clean(h, window) {
  assert.equal(h.files.size, 0)
  assert.equal(h.timers.size, 0)
  assert.equal(window.destroyCount, 1)
  assert.equal(h.unlinkCount, 1)
}

test('concurrent invoices use separate files and preserve standard print options', async () => {
  const h = harness()
  const first = h.service.printHtmlInHiddenWindow('<html>first</html>', { printerName: 'Office', silent: true })
  const second = h.service.printHtmlInHiddenWindow('<html>second</html>')
  const [a, b] = h.windows
  assert.notEqual(a.filePath, b.filePath)
  assert.equal(h.files.get(a.filePath), '<html>first</html>')
  assert.equal(h.files.get(b.filePath), '<html>second</html>')
  assert.equal(h.timers.size, 0, 'normal printing does not gain a watchdog')
  await Promise.all([ready(a), ready(b)])
  assert.equal(a.printCalls[0].options.deviceName, 'Office')
  assert.equal(a.printCalls[0].options.silent, true)
  assert.equal(a.printCalls[0].options.pageSize, 'A4')
  a.printCalls[0].callback(true)
  assert.equal((await first).success, true)
  assert.equal(h.files.has(b.filePath), true)
  b.printCalls[0].callback(true)
  assert.equal((await second).success, true)
  assert.equal(h.files.size, 0)
  assert.equal(a.destroyCount, 1)
  assert.equal(b.destroyCount, 1)
})

for (const failure of ['writeThrow', 'loadThrow', 'loadReject']) {
  test(`${failure} settles as a definite pre-submission failure`, async () => {
    const h = harness({ [failure]: true })
    const result = await h.service.printHtmlInHiddenWindow('invoice', { timeoutMs: 90_000 })
    assert.equal(result.success, false)
    assert.equal(result.uncertain, undefined)
    clean(h, h.windows[0])
  })
}

test('window construction failure returns an error result', async () => {
  const h = harness({ constructorThrow: true })
  const result = await h.service.printHtmlInHiddenWindow('invoice')
  assert.equal(result.success, false)
  assert.match(result.error, /window unavailable/)
})

test('watchdog before loading prevents late print submission', async () => {
  const h = harness()
  const pending = h.service.printHtmlInHiddenWindow('invoice', { timeoutMs: 90_000 })
  const window = h.windows[0]
  assert.equal([...h.timers.values()][0].delay, 90_000)
  h.expire()
  const result = await pending
  assert.equal(result.success, false)
  assert.equal(result.uncertain, undefined)
  await ready(window)
  assert.equal(window.printCalls.length, 0)
  clean(h, window)
})

test('watchdog during readiness prevents printing after readiness resumes', async () => {
  let resume
  const readiness = new Promise(resolve => { resume = resolve })
  const h = harness({ readiness })
  const pending = h.service.printHtmlInHiddenWindow('invoice', { timeoutMs: 90_000 })
  const window = h.windows[0]
  window.webContents.emit('did-finish-load')
  h.expire()
  assert.equal((await pending).uncertain, undefined)
  resume()
  await flush()
  assert.equal(window.printCalls.length, 0)
  clean(h, window)
})

test('post-submission timeout is uncertain; late callbacks cannot change the result', async () => {
  const h = harness()
  const pending = h.service.printHtmlInHiddenWindow('invoice', { timeoutMs: 90_000 })
  const window = h.windows[0]
  await ready(window)
  h.expire()
  const result = await pending
  assert.equal(result.success, false)
  assert.equal(result.uncertain, true)
  window.printCalls[0].callback(true)
  assert.equal(await pending, result)
  clean(h, window)
})

test('synchronous driver exception settles conservatively as uncertain', async () => {
  const h = harness({ printThrow: true })
  const pending = h.service.printHtmlInHiddenWindow('invoice', { timeoutMs: 90_000 })
  const window = h.windows[0]
  await ready(window)
  const result = await pending
  assert.equal(result.success, false)
  assert.equal(result.uncertain, true)
  assert.match(result.error, /driver threw/)
  clean(h, window)
})

for (const event of ['closed', 'render-process-gone', 'destroyed']) {
  for (const submitted of [false, true]) {
    test(`${event} ${submitted ? 'after' : 'before'} submission settles with correct uncertainty`, async () => {
      const h = harness()
      const pending = h.service.printHtmlInHiddenWindow('invoice', { timeoutMs: 90_000 })
      const window = h.windows[0]
      if (submitted) await ready(window)
      const target = event === 'closed' ? window : window.webContents
      target.emit(event)
      const result = await pending
      assert.equal(result.success, false)
      assert.equal(result.uncertain, submitted ? true : undefined)
      clean(h, window)
    })
  }
}

test('subframe load failure does not abort the invoice; explicit driver failure is preserved', async () => {
  const h = harness()
  const pending = h.service.printHtmlInHiddenWindow('invoice', { timeoutMs: 90_000 })
  const window = h.windows[0]
  window.webContents.emit('did-fail-load', {}, -1, 'subframe failed', 'frame', false)
  assert.equal(window.destroyed, false)
  await ready(window)
  window.printCalls[0].callback(false, 'invalid printer')
  const result = await pending
  assert.equal(result.success, false)
  assert.equal(result.error, 'invalid printer')
  assert.equal(result.uncertain, undefined)
  clean(h, window)
})

test('main-frame load failure cleans up without submitting', async () => {
  const h = harness()
  const pending = h.service.printHtmlInHiddenWindow('invoice', { timeoutMs: 90_000 })
  const window = h.windows[0]
  window.webContents.emit('did-fail-load', {}, -1, 'load failed', 'invoice', true)
  const result = await pending
  assert.equal(result.success, false)
  assert.equal(result.uncertain, undefined)
  assert.equal(window.printCalls.length, 0)
  clean(h, window)
})

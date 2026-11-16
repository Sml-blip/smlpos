import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'

const source = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
const handlerCode = source.slice(source.indexOf("  ipcMain.handle('produits:update'"), source.indexOf("  ipcMain.handle('produits:getSourceTags'"))
const serialCode = source.slice(source.indexOf('  function replaceAvailableSerials('), source.indexOf("  ipcMain.handle('serialNumbers:markSold'"))
const readCode = source.slice(source.indexOf("  ipcMain.handle('serialNumbers:getByProduit'"), source.indexOf('  function replaceAvailableSerials('))
const fields = [...new Set([...handlerCode.matchAll(/\b(\w+)=@\w+/g)].map(match => match[1]))].filter(field => field !== 'id')

function setup() {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE produits (id TEXT PRIMARY KEY, ${fields.join(', ')});
    CREATE TABLE serial_numbers (id TEXT PRIMARY KEY, produit_id TEXT, numero_serie TEXT, statut TEXT, vente_id TEXT, created_at TEXT, updated_at TEXT);`)
  db.exec(`INSERT INTO produits (id,has_serial_number,numero_serie,stock_actuel,prix_vente) VALUES ('p',1,'LEGACY',8,10);
    INSERT INTO serial_numbers VALUES ('a','p','AVAILABLE','EN_STOCK',NULL,'old','old'), ('s','p','SOLD','VENDU','sale','old','old'), ('r','p','RESERVED','RESERVE_AVANCE',NULL,'old','old');`)
  db.transaction = fn => () => {
    if (db.isTransaction) return fn()
    db.exec('BEGIN')
    try { const result = fn(); db.exec('COMMIT'); return result }
    catch (error) { db.exec('ROLLBACK'); throw error }
  }
  const handlers = {}
  const data = { ...Object.fromEntries(fields.map(field => [field, null])), prix_vente: 20, stock_actuel: 4, has_serial_number: 0 }
  const { outputText } = ts.transpileModule(handlerCode + readCode + serialCode, { compilerOptions: { target: ts.ScriptTarget.ES2022 } })
  runInNewContext(outputText, {
    db, randomUUID, ipcMain: { handle: (name, callback) => handlers[name] = callback },
    addActivityLog() {}, enqueueProductSnapshot() {}, console: {warn() {}},
    recoverProductSerialsFromPurchases() { throw Error('legacy purchase unavailable') },
  })
  return {
    update: extra => handlers['produits:update'](null, 'p', { ...data, ...extra }),
    product: () => db.prepare("SELECT * FROM produits WHERE id='p'").get(),
    rows: () => db.prepare('SELECT * FROM serial_numbers ORDER BY id').all(),
    read: () => handlers['serialNumbers:getByProduit'](null, 'p'),
    snapshot: ['["a","AVAILABLE","EN_STOCK"]', '["r","RESERVED","RESERVE_AVANCE"]', '["s","SOLD","VENDU"]'],
  }
}

test('price update preserves serial flag, legacy field, current stock, and every serial row', () => {
  const app = setup()
  const original = app.rows()
  app.update({ preserve_serial_tracking: true, preserve_stock: true })
  assert.equal(app.product().prix_vente, 20)
  assert.equal(app.product().has_serial_number, 1)
  assert.equal(app.product().numero_serie, 'LEGACY')
  assert.equal(app.product().stock_actuel, 8)
  assert.deepEqual(app.rows(), original)
})

test('persisted serial numbers remain visible despite recovery failure', () => {
  assert.equal(setup().read().length, 3)
})

test('stale serial edits leave price, stock and serials unchanged', () => {
  const app = setup()
  const original = app.rows()
  assert.throws(() => app.update({ serial_numbers_edit: ['AVAILABLE'], serial_numbers_snapshot: [] }), /ont changé/)
  assert.equal(app.product().prix_vente, 10)
  assert.deepEqual(app.rows(), original)
})

test('explicit add retains original serial identities and locked history', () => {
  const app = setup()
  const original = app.rows()
  app.update({ has_serial_number: 1, serial_numbers_edit: ['AVAILABLE','NEW'], serial_numbers_snapshot: app.snapshot })
  const updated = app.rows()
  assert.equal(updated.length, 4)
  for (const row of original) assert.deepEqual(updated.find(item => item.id === row.id), row)
})

test('invalid replacement rolls back the product edit atomically', () => {
  const app = setup()
  const original = app.rows()
  assert.throws(() => app.update({ has_serial_number: 1, serial_numbers_edit: ['RESERVED'], serial_numbers_snapshot: app.snapshot }), /non modifiable/)
  assert.equal(app.product().prix_vente, 10)
  assert.deepEqual(app.rows(), original)
})

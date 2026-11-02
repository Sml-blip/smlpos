import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import ts from 'typescript'

const index = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
const start = index.indexOf("  ipcMain.handle('documents:listAll'")
const end = index.indexOf('  // Fiscal sales export:', start)
assert.ok(start >= 0 && end > start)
const { outputText } = ts.transpileModule(index.slice(start, end), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } })
const db = new DatabaseSync(':memory:')
db.exec(`
  CREATE TABLE documents (id TEXT PRIMARY KEY,numero TEXT,type_document TEXT,statut TEXT,avoir_id TEXT,created_at TEXT);
  CREATE TABLE fournisseurs (id TEXT PRIMARY KEY,nom TEXT);
  CREATE TABLE factures_fournisseurs (
    id TEXT PRIMARY KEY,numero_facture TEXT,type TEXT,statut_reception TEXT,statut_paiement TEXT,fournisseur_id TEXT,
    montant_ht REAL,montant_tva REAL,montant_ttc REAL,montant_paye REAL,exo TEXT,timbre REAL,ht_7 REAL,tva_7 REAL,
    ht_19 REAL,tva_19 REAL,total_remise REAL,created_at TEXT
  );
`)
let handler
runInNewContext(outputText, { db, ipcMain: { handle: (name, fn) => { assert.equal(name, 'documents:listAll'); handler = fn } } })
const insert = db.prepare(`INSERT INTO documents VALUES (?,?,?,'ACTIF',NULL,?)`)
for (let i = 0; i < 650; i++) insert.run(`sale-${i}`, `FAC-${i}`, i % 2 ? 'FACTURE_JOURNALIERE_F' : 'FACTURE_VENTE', '2026-11-02T12:00:00.000Z')
db.exec(`INSERT INTO factures_fournisseurs (id,numero_facture,type,statut_paiement,created_at) VALUES ('purchase','FA-1','FACTURE_ACHAT','PAYE','2026-11-02 12:00:00')`)
insert.run('outside', 'FAC-OUTSIDE', 'FACTURE_VENTE', '2026-10-28T12:00:00Z')
insert.run('midnight', 'FAC-BOUNDARY', 'FACTURE_VENTE', '2026-11-01T23:30:00Z')
const boundaryDate = db.prepare("SELECT date(?,'localtime') AS day").get('2026-11-01T23:30:00Z').day
const range = { bulkPrint: true, dateFrom: '2026-11-02', dateTo: '2026-11-02' }

test('bulk query returns every matching sales and purchase invoice beyond 300/500 caps', () => {
  const rows = handler(null, range)
  assert.equal(rows.length, 651 + (boundaryDate === '2026-11-02' ? 1 : 0))
  assert.ok(rows.some(row => row._source === 'ff'))
  assert.ok(!rows.some(row => row.id === 'outside'))
})

test('normal table request retains its existing bounded result size', () => {
  assert.ok(handler(null, { dateFrom: range.dateFrom, dateTo: range.dateTo }).length <= 500)
})

test('bulk query respects selected document type and inclusive local-day boundaries', () => {
  const rows = handler(null, { ...range, type_document: 'FACTURE_JOURNALIERE_F' })
  assert.equal(rows.length, 325)
  assert.ok(rows.every(row => row.type_document === 'FACTURE_JOURNALIERE_F'))
  const boundary = handler(null, { bulkPrint: true, dateFrom: boundaryDate, dateTo: boundaryDate })
  assert.ok(boundary.some(row => row.id === 'midnight'))
})

test('bulk requests reject absent, malformed or reversed date ranges', () => {
  for (const filters of [{ bulkPrint: true }, { ...range, dateFrom: 'invalid' }, { ...range, dateFrom: '2026-11-03' }]) {
    assert.throws(() => handler(null, filters), /plage de dates valide/)
  }
})

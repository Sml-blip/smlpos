import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'

const source = readFileSync(new URL('../src/main/invoiceDeliveryCopy.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } })
const { createInvoiceDeliveryCopy } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
function fixture() {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE documents (id TEXT PRIMARY KEY, numero TEXT UNIQUE, type_document TEXT, statut TEXT, vente_id TEXT, shift_id TEXT, client_nom TEXT, total_ttc REAL, timbre REAL, layout_snapshot TEXT, contenu_json TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE lignes_document (id TEXT PRIMARY KEY, document_id TEXT, produit_id TEXT, designation TEXT, quantite REAL, prix_unitaire REAL, numero_serie TEXT);
    CREATE TABLE produits (id TEXT,stock_actuel REAL);
    INSERT INTO produits VALUES ('product',3);
    INSERT INTO documents VALUES ('invoice','FAC-1','FACTURE_VENTE','ACTIF','sale','shift','Client',119,1,'{"theme":"saved"}',NULL,'old','old');
    INSERT INTO lignes_document VALUES ('line','invoice','product','Device',2,59.5,'SN1, SN2');`)
  db.transaction = fn => () => {
    db.exec('BEGIN')
    try { const result = fn(); db.exec('COMMIT'); return result }
    catch (error) { db.exec('ROLLBACK'); throw error }
  }
  return db
}
test('copies full invoice lines, serials and layout without changing invoice or inventory', () => {
  const db = fixture()
  const original = db.prepare("SELECT * FROM documents WHERE id='invoice'").get()
  const result = createInvoiceDeliveryCopy(db,'invoice','now',randomUUID)
  assert.equal(result.document.type_document,'BON_LIVRAISON')
  assert.equal(result.document.timbre,0)
  assert.equal(result.document.vente_id,null)
  assert.equal(result.document.shift_id,null)
  assert.equal(result.document.total_ttc,119)
  assert.equal(result.document.layout_snapshot,original.layout_snapshot)
  assert.equal(result.lines[0].numero_serie,'SN1, SN2')
  assert.equal(result.lines[0].quantite,2)
  assert.deepEqual(db.prepare("SELECT * FROM documents WHERE id='invoice'").get(),original)
  assert.equal(db.prepare('SELECT stock_actuel FROM produits').get().stock_actuel,3)
})
test('repeated request reuses the original BL', () => {
  const db = fixture()
  const first = createInvoiceDeliveryCopy(db,'invoice','now',randomUUID)
  const second = createInvoiceDeliveryCopy(db,'invoice','later',randomUUID)
  assert.equal(second.alreadyExists,true)
  assert.equal(second.document.id,first.document.id)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM documents').get().n,2)
})
test('rejects cancelled and empty invoices without leaving partial documents', () => {
  for (const cancelled of [true,false]) {
    const db = fixture()
    db.exec(cancelled ? "UPDATE documents SET statut='ANNULE'" : 'DELETE FROM lignes_document')
    assert.throws(() => createInvoiceDeliveryCopy(db,'invoice','now',randomUUID))
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM documents').get().n,1)
  }
})

import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/renderer/src/lib/bulkPrint.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } })
const { bulkPrintDate, selectBulkPrintDocuments, runBulkPrintQueue } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)

const row = (id, type_document = 'FACTURE_VENTE', statut = 'ACTIF', _source = 'documents') => ({ id, numero: id, type_document, statut, _source, created_at: '2026-11-02T10:00:00.000Z' })

test('all invoices include sale, daily and purchase; exclude BL, quotes and cancelled/drafts', () => {
  const rows = [row('vente'), row('daily', 'FACTURE_JOURNALIERE_F'), row('achat', 'FACTURE_ACHAT', 'ACTIF', 'ff'), row('quote', 'DEVIS'), row('bl', 'BON_LIVRAISON'), row('cancelled', 'FACTURE_VENTE', 'ANNULE'), row('revoked', 'FACTURE_VENTE', 'REVOQUE'), row('draft', 'FACTURE_ACHAT', 'BROUILLON')]
  assert.deepEqual(selectBulkPrintDocuments(rows, 'TOUS').map(item => item.id).sort(), ['achat', 'daily', 'vente'])
})

test('specific document tab respects the selected type and deduplicates only within the source', () => {
  const rows = [row('1', 'DEVIS'), row('1', 'DEVIS'), row('1', 'DEVIS', 'ACTIF', 'ff'), row('2')]
  assert.equal(selectBulkPrintDocuments(rows, 'DEVIS').length, 2)
  assert.equal(selectBulkPrintDocuments(rows, 'RAPPORT_CAISSE').length, 0)
})

test('more than 500 invoices are selected without truncation and sorted chronologically', () => {
  const rows = Array.from({ length: 650 }, (_, i) => ({ ...row(String(i)), created_at: `2026-11-${String(i % 28 + 1).padStart(2, '0')}T10:00:00Z` }))
  const selected = selectBulkPrintDocuments(rows, 'TOUS')
  assert.equal(selected.length, 650)
  assert.ok(selected[0].created_at <= selected[649].created_at)
})

test('legacy SQLite UTC and ISO dates have consistent local days and ordering', () => {
  assert.equal(bulkPrintDate('2026-11-01 23:30:00').toISOString(), '2026-11-01T23:30:00.000Z')
  assert.equal(bulkPrintDate('2026-11-01 23:30:00').toLocaleDateString('en-CA', { timeZone: 'Africa/Tunis' }), '2026-11-02')
  const selected = selectBulkPrintDocuments([
    { ...row('late'), created_at: '2026-11-02 23:00:00' },
    { ...row('early'), created_at: '2026-11-02T08:00:00Z' },
  ], 'TOUS')
  assert.deepEqual(selected.map(item => item.id), ['early', 'late'])
})

test('submission is sequential and sends the complete prepared markup for each invoice', async () => {
  let active = 0; let peak = 0
  const statuses = []; const received = []
  await runBulkPrintQueue({
    items: ['one', 'two', 'three'], prepare: async item => `<article>${item}: full invoice</article>`, shouldStop: () => false,
    submit: async (html, item) => { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 2)); received.push([item, html]); active--; return { success: true } },
    onStatus: (item, status) => statuses.push([item, status]),
  })
  assert.equal(peak, 1)
  assert.deepEqual(received.map(([item]) => item), ['one', 'two', 'three'])
  assert.equal(statuses.filter(([, status]) => status === 'queued').length, 3)
})

test('a preparation failure does not print bad data and does not block remaining invoices', async () => {
  const sent = []; const statuses = []
  await runBulkPrintQueue({ items: ['bad', 'good'], prepare: async item => { if (item === 'bad') throw new Error('missing'); return '<html>full</html>' }, submit: async (_, item) => { sent.push(item); return { success: true } }, shouldStop: () => false, onStatus: (item, status) => statuses.push([item, status]) })
  assert.deepEqual(sent, ['good'])
  assert.ok(statuses.some(([item, status]) => item === 'bad' && status === 'failed'))
})

test('known driver rejection is failed and later documents continue', async () => {
  const statuses = []
  await runBulkPrintQueue({ items: ['bad', 'good'], prepare: async () => '<html/>', submit: async (_, item) => ({ success: item === 'good', error: 'offline' }), shouldStop: () => false, onStatus: (item, status) => statuses.push([item, status]) })
  assert.ok(statuses.some(([item, status]) => item === 'bad' && status === 'failed'))
  assert.ok(statuses.some(([item, status]) => item === 'good' && status === 'queued'))
})

test('stop before submission cancels all unsent documents', async () => {
  const statuses = []
  await runBulkPrintQueue({ items: ['one', 'two'], prepare: async () => { throw new Error('must not prepare') }, submit: async () => { throw new Error('must not submit') }, shouldStop: () => true, onStatus: (item, status) => statuses.push([item, status]) })
  assert.deepEqual(statuses, [['one', 'cancelled'], ['two', 'cancelled']])
})

test('stop during preparation never submits the current invoice', async () => {
  let stop = false; let submitted = false
  await runBulkPrintQueue({ items: ['one'], prepare: async () => { stop = true; return '<html/>' }, submit: async () => { submitted = true; return { success: true } }, shouldStop: () => stop, onStatus: () => {} })
  assert.equal(submitted, false)
})

test('uncertain response or lost IPC reply stops the batch without retry', async () => {
  for (const shouldThrow of [false, true]) {
    let calls = 0; const statuses = []
    await runBulkPrintQueue({ items: ['one', 'two'], prepare: async () => '<html/>', submit: async () => { calls++; if (shouldThrow) throw new Error('IPC lost'); return { success: false, uncertain: true } }, shouldStop: () => false, onStatus: (item, status) => statuses.push([item, status]) })
    assert.equal(calls, 1)
    assert.ok(statuses.some(([item, status]) => item === 'one' && status === 'uncertain'))
    assert.ok(statuses.some(([item, status]) => item === 'two' && status === 'cancelled'))
  }
})

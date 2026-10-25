import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { installOutbox } from '../outbox'
import { liveIssues, liveStatus, retryPush } from '../monitor'
import { setCaptureState } from '../gate'
import { LegacySyncGate } from '../runtime'
import { reserveNumber, newCashId } from '../numbering'

test('monitor works before preparation; retries preserve identities, payloads and acknowledged rows', () => {
  const db = new Database(':memory:')
  try {
    assert.equal(liveStatus(db).prepared, false)
    assert.deepEqual(liveIssues(db), [])
    assert.throws(() => retryPush(db))
    db.exec('CREATE TABLE produits(id TEXT PRIMARY KEY,nom TEXT,stock_actuel INTEGER)')
    installOutbox(db)
    db.exec("INSERT INTO produits VALUES('p','P',0); UPDATE produits SET nom='Q' WHERE id='p'; UPDATE outbox SET sent_at='ack' WHERE seq=1; UPDATE outbox SET last_error='rejected:unique_conflict' WHERE seq=2")
    db.prepare('INSERT INTO pull_rejects VALUES(?,?,?,?,?,?)').run(9, 'produits', 'q', 'UNIQUE', '{}', 'now')
    setCaptureState(db, 'pull_cursor', '8'); setCaptureState(db, 'server_seq', '10')
    const before = db.prepare('SELECT seq,row_json FROM outbox').all()
    assert.equal(liveStatus(db).pending, 0)
    assert.equal(liveStatus(db).rejected, 1)
    assert.equal(liveStatus(db).pullRejected, 1)
    assert.equal(liveStatus(db).lag, 2)
    assert.equal(liveIssues(db).length, 2)
    retryPush(db)
    assert.equal(liveStatus(db).pending, 1)
    assert.deepEqual(db.prepare('SELECT seq,row_json FROM outbox').all(), before)
    assert.equal((db.prepare('SELECT sent_at FROM outbox WHERE seq=1').get() as {sent_at:string}).sent_at, 'ack')
    assert.equal(liveIssues(db).length, 1)
  } finally { db.close() }
})

test('number reservations survive reopen, preserve historical numbers and refuse missing identity', () => {
  const db = new Database(':memory:')
  try {
    db.exec("CREATE TABLE ventes(id TEXT PRIMARY KEY, numero TEXT UNIQUE); INSERT INTO ventes VALUES('old','VTE-20200101-0001')")
    assert.equal(reserveNumber(db, 'ventes', 'VTE-20261025-0001'), 'VTE-20261025-0001')
    installOutbox(db); setCaptureState(db, 'sync_backend', 'vps')
    assert.throws(() => reserveNumber(db, 'ventes', 'VTE-20261025-0001'), /Register/)
    setCaptureState(db, 'device_id', '10000000-0000-4000-8000-000000000001')
    const first = reserveNumber(db, 'ventes', 'VTE-20261025-0001')
    assert.match(first, /10000000-0000-4000-8000-000000000001-000001$/)
    assert.match(reserveNumber(db, 'ventes', 'VTE-20261025-0001'), /-000002$/)
    assert.equal((db.prepare("SELECT numero FROM ventes WHERE id='old'").get() as {numero:string}).numero, 'VTE-20200101-0001')
    assert.equal(newCashId(db, '2026-10-25'), 'caisse:2026-10-25')
    assert.throws(() => reserveNumber(db, 'outbox', 'bad'))
  } finally { db.close() }
})

test('switch closes legacy admission and waits for in-flight requests; persisted VPS refuses after restart', async () => {
  const db = new Database(':memory:')
  try {
    const gate = new LegacySyncGate(() => db), lease = gate.begin()
    assert.ok(lease)
    let finished = false
    const closing = gate.quiesce().then(() => { finished = true })
    assert.equal(gate.begin(), null)
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(finished, false)
    gate.end(lease)
    await closing
    assert.equal(finished, true)
    db.exec('CREATE TABLE produits(id TEXT PRIMARY KEY)'); installOutbox(db)
    setCaptureState(db, 'sync_backend', 'vps')
    assert.equal(new LegacySyncGate(() => db).begin(), null)
  } finally { db.close() }
})

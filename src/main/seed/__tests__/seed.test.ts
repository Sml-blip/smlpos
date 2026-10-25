import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createHash } from 'crypto'
import Database from 'better-sqlite3'

const TMP = mkdtempSync(join(tmpdir(), 'smlseed-'))
process.env.APPDATA = TMP
process.env.SMLSEED_TMP = TMP

import { connectDatabase, initDatabase, getDb, closeDatabase } from '../../db'
import { SeedLedger } from '../ledger'
import { SeedService, type SecretBox } from '../service'
import { MockBackend } from './mockBackend'
import { buildReport, describeColumns } from '../dryRun'
import { createVerifiedBackup, listUserTables } from '../snapshot'
import { EXCLUDED_TABLES, toMillimes } from '../tables'

const secrets: SecretBox = { seal: s => Buffer.from(s).toString('base64'), open: s => Buffer.from(s, 'base64').toString() }

function liveFingerprint(db: Database.Database): string {
  const h = createHash('sha256')
  for (const t of listUserTables(db)) {
    for (const r of db.prepare(`SELECT * FROM "${t}"`).iterate()) h.update(JSON.stringify([t, r]))
  }
  return h.digest('hex')
}

function serverTablesFrom(db: Database.Database) {
  const out: Record<string, { columns: string[]; pk: string }> = {}
  for (const t of listUserTables(db)) {
    if (EXCLUDED_TABLES.has(t)) continue
    out[t] = { columns: describeColumns(db, t).map(c => c.name), pk: t === 'app_settings' ? 'key' : 'id' }
  }
  return out
}

let n = 0
const openedLedgers: SeedLedger[] = []
function newService(backend: MockBackend, name = `t${++n}`, fetchImpl: typeof fetch = backend.fetch) {
  const ledger = new SeedLedger(join(TMP, `${name}.ledger.db`))
  openedLedgers.push(ledger)
  const svc = new SeedService({
    liveDb: getDb, ledger, archiveDir: join(TMP, `archive-${name}`), secrets, appVersion: '1.9.1001',
    platform: 'win32', legacyQueue: () => ({ pending: 3, failed: 1 }), fetchImpl, sleep: async () => {},
  })
  return { svc, ledger }
}

before(() => {
  connectDatabase()
  initDatabase()
  const db = getDb()
  const now = new Date().toISOString()
  db.prepare(`INSERT INTO fournisseurs (id, nom, solde_du) VALUES ('f1','Fournisseur A', 1234.5)`).run()
  for (let i = 1; i <= 120; i++) {
    db.prepare(`INSERT INTO produits (id, reference, nom, prix_achat, prix_vente, stock_actuel, tva_taux) VALUES (?,?,?,?,?,?,19)`)
      .run(`p${i}`, `REF${i}`, `Produit ${i}`, 10.1 + i / 1000, 12.345000000000001 + i, 5)
  }
  db.prepare(`INSERT INTO shifts (id, operateur_nom, fond_de_caisse, started_at) VALUES ('s1','Hamdi', 100, ?)`).run(now)
  db.prepare(`INSERT INTO ventes (id, numero, shift_id, total_ttc, montant_recu, mode_paiement) VALUES ('v1','T-0001','s1', 36.8, 40, 'ESPECES')`).run()
  db.prepare(`INSERT INTO lignes_vente (id, vente_id, produit_id, designation, quantite, prix_unitaire, total_ligne) VALUES ('l1','v1','p1','Produit 1',2,18.4,36.8)`).run()
  // orphan line (deleted parent) — real-world noise, must be a warning not a blocker
  db.pragma('foreign_keys = OFF')
  db.prepare(`INSERT INTO lignes_vente (id, vente_id, produit_id, designation, quantite, prix_unitaire, total_ligne) VALUES ('l-orphan','v-gone','p2','x',1,1,1)`).run()
  db.pragma('foreign_keys = ON')
  // credentials that must NEVER leave the machine
  db.prepare(`INSERT OR REPLACE INTO app_settings (key, value) VALUES ('r2_secret_access_key','SUPERSECRET')`).run()
  db.prepare(`INSERT OR REPLACE INTO app_settings (key, value) VALUES ('admin_pin','1234')`).run()
  db.prepare(`INSERT OR REPLACE INTO app_settings (key, value) VALUES ('company_name','SML')`).run()
})

after(() => {
  for (const ledger of openedLedgers) ledger.close()
  closeDatabase()
  rmSync(TMP, { recursive: true, force: true })
})

test('money conversion: float noise is exact, real sub-millime drift is flagged', () => {
  const a = toMillimes(12.345000000000001)
  assert.ok(a.ok && a.millimes === 12345 && a.drift < 1e-6)
  const b = toMillimes(12.3456)
  assert.ok(b.ok && b.millimes === 12346 && b.drift > 0.1)
  assert.ok(!toMillimes('abc').ok)
  assert.ok(!toMillimes(Infinity).ok)
  const c = toMillimes(-0.0005)
  assert.ok(c.ok && c.millimes === -1)
})

test('backup is verified and the live database is not modified', async () => {
  const live = getDb()
  const before = liveFingerprint(live)
  const b = await createVerifiedBackup(live, join(TMP, 'bk'))
  assert.equal(b.ok, true, b.problems.join(','))
  assert.equal(b.integrity[0], 'ok')
  assert.equal(b.tables.produits.backup, b.tables.produits.live)
  assert.equal(liveFingerprint(live), before)
})

test('dry run: passes, converts money, keeps credentials out, warns on orphans', async () => {
  const b = await createVerifiedBackup(getDb(), join(TMP, 'bk2'))
  const bdb = new Database(b.path, { readonly: true })
  try {
    const r = buildReport(bdb, { backupPath: b.path, backupSha256: b.sha256, integrityOk: true })
    assert.equal(r.status, 'passed', JSON.stringify(r.blockers))
    const prod = r.tables.find(t => t.name === 'produits')!
    assert.equal(prod.seedable, 120 + (prod.rows - 120)) // every row seedable
    const expectedSum = Array.from({ length: 120 }, (_, i) => Math.round((12.345 + (i + 1)) * 1000)).reduce((a, c) => a + c, 0)
    assert.equal(prod.moneySumsMillimes.prix_vente >= expectedSum, true)
    assert.ok(r.excludedSettingKeys.includes('r2_secret_access_key'))
    assert.ok(r.excludedSettingKeys.includes('admin_pin'))
    assert.ok(!r.warnings.some(w => w.code === 'money_sub_millime' && w.table === 'produits' && w.column === 'prix_vente'))
    assert.ok(r.warnings.some(w => w.code === 'orphan_ref' && w.table === 'lignes_vente'))
    assert.ok(r.excludedTables.includes('sync_queue'))
  } finally { bdb.close() }
})

test('dry run blocks on an unclassified REAL column and on sub-contract server columns', async () => {
  const live = getDb()
  live.exec(`ALTER TABLE produits ADD COLUMN mystery_ratio REAL`)
  const b = await createVerifiedBackup(live, join(TMP, 'bk3'))
  const bdb = new Database(b.path, { readonly: true })
  try {
    const r = buildReport(bdb, { backupPath: b.path, backupSha256: b.sha256, integrityOk: true }, {
      produits: { columns: ['id'] },
    })
    assert.equal(r.status, 'blocked')
    assert.ok(r.blockers.some(x => x.code === 'real_unclassified' && x.column === 'mystery_ratio'))
    assert.ok(r.blockers.some(x => x.code === 'column_unknown_to_server'))
  } finally {
    bdb.close()
    live.exec(`ALTER TABLE produits DROP COLUMN mystery_ratio`)
  }
})

test('NOTHING is uploaded before explicit approval; wrong phrase is refused', async () => {
  const be = new MockBackend({ tables: serverTablesFrom(getDb()) })
  const { svc, ledger } = newService(be)
  await svc.registerDevice('https://sync.example.com', 'good-token', 'PC Principal')
  const report = await svc.backupAndCheck()
  assert.equal(report.status, 'passed')
  assert.equal(ledger.state(), 'checked')
  assert.equal(be.calls.filter(c => c.path === '/v1/seed/batches' || c.path === '/v1/seed/begin').length, 0)
  await assert.rejects(svc.approve('seed please'), /Type SEED/)
  await assert.rejects(svc.run(), /not approved/)
  assert.equal(be.batchesReceived, 0)
  assert.equal(ledger.state(), 'checked')
})

test('full seed: server totals match, credentials absent, state done, idempotent', async () => {
  const be = new MockBackend({ tables: serverTablesFrom(getDb()) })
  const { svc, ledger } = newService(be)
  await svc.registerDevice('https://sync.example.com', 'good-token', 'PC Principal')
  const report = await svc.backupAndCheck()
  await svc.approve('SEED')
  await svc.run()
  assert.equal(ledger.state(), 'done', ledger.get('message') ?? '')
  for (const t of report.tables) assert.equal(be.count(t.name), t.seedable, t.name)
  const settings = [...(be.rows.get('app_settings')?.keys() ?? [])]
  assert.ok(settings.includes('company_name'))
  assert.ok(!settings.includes('r2_secret_access_key') && !settings.includes('admin_pin'))
  // money arrived as integer millimes
  assert.equal(be.rows.get('produits')!.get('p1')!.prix_vente, 13345)
  assert.equal(be.rows.get('ventes')!.get('v1')!.total_ttc, 36800)
  const st = await svc.status(true)
  assert.equal(st.connection, 'online')
  assert.equal(st.server!.devices.length, 1)
  assert.equal(st.legacyQueue.pending, 3)
  assert.equal(st.seed.rejectedCount, 0)
})

test('crash/outage mid-upload is resumable with no duplicates and no loss', async () => {
  const be = new MockBackend({ tables: serverTablesFrom(getDb()) })
  const { svc, ledger } = newService(be)
  await svc.registerDevice('https://sync.example.com', 'good-token', 'PC Principal')
  const report = await svc.backupAndCheck()
  await svc.approve('SEED')
  be.failBatchesAfter = 3
  await assert.rejects(svc.run())
  assert.equal(ledger.state(), 'paused')
  const partial = ledger.ackedCount()
  assert.ok(partial > 0 && partial < report.tables.reduce((a, t) => a + t.seedable, 0))
  assert.equal(svc.canRun(), true)
  be.failBatchesAfter = null
  await svc.run()
  assert.equal(ledger.state(), 'done', ledger.get('message') ?? '')
  for (const t of report.tables) assert.equal(be.count(t.name), t.seedable, t.name)
})

test('a restart while running never resumes by itself', async () => {
  const be = new MockBackend({ tables: serverTablesFrom(getDb()) })
  const ledger = new SeedLedger(join(TMP, 'restart.ledger.db'))
  openedLedgers.push(ledger)
  ledger.setState('running')
  const svc = new SeedService({
    liveDb: getDb, ledger, archiveDir: join(TMP, 'a-r'), secrets, appVersion: '1', platform: 'win32',
    legacyQueue: () => ({ pending: 0, failed: 0 }), fetchImpl: be.fetch, sleep: async () => {},
  })
  assert.equal(ledger.state(), 'paused')
  assert.equal(be.calls.length, 0)
  void svc
})

test('rejected operations are listed, not acked, and retried on the next run', async () => {
  const be = new MockBackend({ tables: serverTablesFrom(getDb()) })
  be.rejectPks.add('p7')
  const { svc, ledger } = newService(be)
  await svc.registerDevice('https://sync.example.com', 'good-token', 'PC Principal')
  await svc.backupAndCheck()
  await svc.approve('SEED')
  await svc.run()
  assert.equal(ledger.state(), 'needs_review')
  assert.equal(ledger.rejectedCount(), 1)
  assert.equal(svc.rejected()[0].pk, 'p7')
  be.rejectPks.clear()
  await svc.run()
  assert.equal(ledger.rejectedCount(), 0)
  assert.ok(be.rows.get('produits')!.has('p7'))
  assert.equal(ledger.state(), 'done', ledger.get('message') ?? '')
})

test('delta pass after live edits uploads only the changed rows', async () => {
  const be = new MockBackend({ tables: serverTablesFrom(getDb()) })
  const { svc } = newService(be)
  await svc.registerDevice('https://sync.example.com', 'good-token', 'PC Principal')
  await svc.backupAndCheck()
  await svc.approve('SEED')
  await svc.run()
  const sent = be.seenOps.size
  getDb().prepare(`UPDATE produits SET prix_vente = 99.999 WHERE id = 'p3'`).run()
  svc.resetForNewPass()
  await svc.backupAndCheck()
  await svc.approve('SEED')
  await svc.run()
  assert.equal(be.seenOps.size, sent + 1)
  assert.equal(be.rows.get('produits')!.get('p3')!.prix_vente, 99999)
})

test('refuses to seed into a backend that holds another installation\'s data', async () => {
  const be = new MockBackend({ tables: serverTablesFrom(getDb()), serverState: 'seeded', installId: 'someone-else' })
  const { svc, ledger } = newService(be)
  await svc.registerDevice('https://sync.example.com', 'good-token', 'PC Principal')
  await svc.backupAndCheck()
  await assert.rejects(svc.approve('SEED'), /different installation/)
  assert.notEqual(ledger.state(), 'approved')
})

test('approval is void if the backup file is tampered with', async () => {
  const be = new MockBackend({ tables: serverTablesFrom(getDb()) })
  const { svc, ledger } = newService(be)
  await svc.registerDevice('https://sync.example.com', 'good-token', 'PC Principal')
  await svc.backupAndCheck()
  await svc.approve('SEED')
  const backup = JSON.parse(ledger.get('backup')!)
  const t = new Database(backup.path)
  t.pragma('journal_mode = DELETE')
  t.prepare(`UPDATE produits SET nom = 'TAMPERED' WHERE id = 'p1'`).run()
  t.close()
  await assert.rejects(svc.run(), /changed after approval/)
  assert.equal(be.batchesReceived, 0)
})

test('token refresh rotates; bad enrollment token and non-https URL are refused', async () => {
  const be = new MockBackend({ tables: serverTablesFrom(getDb()) })
  be.accessTokenTtlMs = 1_000 // expires inside the 30 s refresh window → every call refreshes
  const { svc } = newService(be)
  await svc.registerDevice('https://sync.example.com', 'good-token', 'PC Principal')
  await svc.status(true)
  assert.ok(be.refreshCount >= 1)
  await assert.rejects(svc.registerDevice('https://sync.example.com', 'wrong', 'X'), /Invalid enrollment token/)
  await assert.rejects(svc.registerDevice('http://evil.example.com', 'good-token', 'X'), /https/)
})

test('failed registration on a new server sends no old bearer and preserves the working server config', async () => {
  const be = new MockBackend({ tables: serverTablesFrom(getDb()) })
  let newServerAuthorization: string | null = 'not-called'
  const routedFetch: typeof fetch = async (input, init) => {
    if (new URL(String(input)).hostname === 'new.example.com') {
      newServerAuthorization = new Headers(init?.headers).get('authorization')
    }
    return be.fetch(input, init)
  }
  const { svc, ledger } = newService(be, `registration-${++n}`, routedFetch)
  await svc.registerDevice('https://sync.example.com', 'good-token', 'PC Principal')
  const savedSession = ledger.get('session_sealed')
  await assert.rejects(svc.registerDevice('https://new.example.com', 'wrong', 'PC Test'), /Invalid enrollment token/)
  assert.equal(newServerAuthorization, null)
  assert.equal(ledger.get('base_url'), 'https://sync.example.com')
  assert.equal(ledger.get('session_sealed'), savedSession)
})

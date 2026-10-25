import Database from 'better-sqlite3'
import { BackendClient, BackendError, validateBaseUrl, type ServerStatus, type Session, type Preflight } from './client'
import { buildReport, pendingRows, type PendingRow, type SeedReport } from './dryRun'
import { SeedLedger, type RejectedOp, type SeedState } from './ledger'
import { createVerifiedBackup, hashFile, verifyBackupFile, type BackupVerification } from './snapshot'
import { CONTRACT_VERSION, moneyColumnsOf } from './tables'
import { installOutbox } from './outbox'
import { canDrainOutbox, captureState, closeSeedGate, openVerifiedGate, setCaptureState } from './gate'

export const CONFIRM_PHRASE = 'SEED'

export interface SecretBox {
  /** Returns null when the OS cannot encrypt (then secrets stay in memory only). */
  seal(plain: string): string | null
  open(sealed: string): string | null
}

export interface SeedDeps {
  liveDb: () => Database.Database
  ledger: SeedLedger
  archiveDir: string
  secrets: SecretBox
  appVersion: string
  platform: string
  /** Existing Supabase queue (untouched by this feature) — shown for context only. */
  legacyQueue: () => { pending: number; failed: number }
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

export interface SeedProgress {
  table: string | null
  tableIndex: number
  tableCount: number
  sent: number
  total: number
  startedAt: string | null
}

export interface PanelStatus {
  connection: 'unconfigured' | 'unregistered' | 'online' | 'offline' | 'auth_failed'
  connectionError: string | null
  baseUrl: string | null
  deviceId: string | null
  deviceName: string | null
  sessionPersisted: boolean
  server: ServerStatus | null
  seed: {
    state: SeedState
    message: string | null
    report: SeedReport | null
    backup: Pick<BackupVerification, 'path' | 'bytes' | 'sha256' | 'ok' | 'problems'> | null
    progress: SeedProgress
    ackedRows: number
    totalRows: number
    rejectedCount: number
    canApprove: boolean
    canRun: boolean
  }
  legacyQueue: { pending: number; failed: number }
}

const EMPTY_PROGRESS: SeedProgress = { table: null, tableIndex: 0, tableCount: 0, sent: 0, total: 0, startedAt: null }

export class SeedService {
  private running = false
  private cancel = false
  private progress: SeedProgress = { ...EMPTY_PROGRESS }
  private serverCache: { at: number; value: ServerStatus | null; error: string | null; kind: PanelStatus['connection'] } | null = null
  private memorySession: Session | null = null
  private client: BackendClient | null = null
  private checking = false

  constructor(private readonly d: SeedDeps) {
    // A crash while running must never resume by itself.
    if (d.ledger.state() === 'running' || d.ledger.state() === 'finalizing') {
      const report = d.ledger.getJson<SeedReport>('report')
      const verified = canDrainOutbox(d.liveDb()) && captureState(d.liveDb(), 'verified_digest') === report?.digest
      d.ledger.setState(verified ? 'done' : 'paused')
      d.ledger.set('message', verified ? 'Seed verification was already committed.' : 'Interrupted (app closed). Review and resume manually.')
    }
  }

  // ───────────────────────── backend / device ─────────────────────────

  private loadSession = (): Session | null => {
    if (this.memorySession) return this.memorySession
    const sealed = this.d.ledger.get('session_sealed')
    if (!sealed) return null
    const plain = this.d.secrets.open(sealed)
    if (!plain) return null
    try { return JSON.parse(plain) as Session } catch { return null }
  }

  private saveSession = (s: Session | null): void => {
    this.memorySession = s
    if (!s) { this.d.ledger.set('session_sealed', null); return }
    const sealed = this.d.secrets.seal(JSON.stringify(s))
    this.d.ledger.set('session_sealed', sealed) // null → not persisted
  }

  private getClient(): BackendClient | null {
    const baseUrl = this.d.ledger.get('base_url')
    if (!baseUrl) return null
    if (!this.client) {
      this.client = new BackendClient({
        baseUrl, loadSession: this.loadSession, saveSession: this.saveSession,
        fetchImpl: this.d.fetchImpl, sleep: this.d.sleep,
      })
    }
    return this.client
  }

  async registerDevice(baseUrlRaw: string, enrollmentToken: string, deviceName: string): Promise<void> {
    const existingInstall = captureState(this.d.liveDb(), 'install_id')
    if (existingInstall) this.d.ledger.set('install_id', existingInstall)
    const baseUrl = validateBaseUrl(baseUrlRaw)
    if (!enrollmentToken.trim()) throw new Error('Enrollment token is required')
    if (!deviceName.trim()) throw new Error('Device name is required')
    this.d.ledger.set('base_url', baseUrl)
    this.client = null
    const res = await this.getClient()!.register(enrollmentToken.trim(), {
      install_id: this.d.ledger.installId(),
      name: deviceName.trim().slice(0, 60),
      platform: this.d.platform,
      app_version: this.d.appVersion,
      schema_version: this.schemaVersionLive(),
    })
    this.saveSession(res.session)
    this.d.ledger.set('device_id', res.device_id)
    this.d.ledger.set('device_name', deviceName.trim().slice(0, 60))
    this.d.ledger.event('device_registered', res.device_id)
    this.serverCache = null
  }

  private schemaVersionLive(): string | null {
    try {
      const r = this.d.liveDb().prepare(`SELECT value FROM app_settings WHERE key='schema_version'`).get() as { value?: string } | undefined
      return r?.value ?? null
    } catch { return null }
  }

  // ───────────────────────── step 1+2: backup + checks ─────────────────────────

  /** Verified migration backup -> capture installation -> consistent seed copy.
   * Business data is never normalized or rewritten in the live database. */
  async backupAndCheck(): Promise<SeedReport> {
    this.assertIdle()
    this.checking = true
    const L = this.d.ledger
    const live = this.d.liveDb()
    L.set('approval', null)
    L.set('message', null)
    closeSeedGate(live)
    try {
    const protection = await createVerifiedBackup(live, this.d.archiveDir)
    L.setJson('migration_backup', protection)
    if (!protection.ok) throw new Error(`Pre-migration backup failed: ${protection.problems.join(', ')}`)
    installOutbox(live)
    closeSeedGate(live)
    const installId = captureState(live, 'install_id') || L.installId()
    L.set('install_id', installId)
    setCaptureState(live, 'install_id', installId)
    if (L.get('device_id')) setCaptureState(live, 'device_id', L.get('device_id')!)
    const backup = await createVerifiedBackup(live, this.d.archiveDir)
    L.setJson('backup', backup)
    if (!backup.ok) {
      L.setState('blocked')
      L.set('message', `Backup verification failed: ${backup.problems.join(', ')}`)
      throw new Error(L.get('message')!)
    }
    const copy = new Database(backup.path, { readonly: true, fileMustExist: true })
    let fence: number
    try { fence = (copy.prepare('SELECT COALESCE(MAX(seq),0) n FROM outbox').get() as { n: number }).n }
    finally { copy.close() }
    if (!Number.isSafeInteger(fence)) throw new Error('Snapshot boundary is out of range')
    live.transaction(() => {
      setCaptureState(live, 'snapshot_fence', String(fence))
      setCaptureState(live, 'snapshot_hash', backup.sha256)
    })()
    L.setState('backup_ok')
    return await this.runChecks(backup.path, backup.sha256, true)
    } catch (error) {
      closeSeedGate(live)
      L.setState('blocked')
      throw error
    } finally { this.checking = false }
  }

  /** Re-run the checks on the already verified backup (e.g. after the backend changed). */
  async recheck(): Promise<SeedReport> {
    this.assertIdle()
    const backup = this.d.ledger.getJson<BackupVerification>('backup')
    if (!backup) throw new Error('No verified backup yet — run the backup first')
    const v = await verifyBackupFile(backup.path, null)
    if (!v.ok || v.sha256 !== backup.sha256) {
      this.d.ledger.setState('blocked')
      throw new Error('The backup file changed or is damaged — run a new backup')
    }
    return this.runChecks(backup.path, backup.sha256, v.integrity.length === 1 && v.integrity[0] === 'ok')
  }

  private async runChecks(path: string, sha256: string, integrityOk: boolean): Promise<SeedReport> {
    const L = this.d.ledger
    let serverTables: Record<string, { columns: string[] }> | null = null
    let preflight: Preflight | null = null
    const client = this.loadSession() ? this.getClient() : null
    if (client) {
      try {
        preflight = await client.preflight()
        if (preflight.contract_version !== CONTRACT_VERSION) {
          throw new Error(`Backend speaks contract v${preflight.contract_version}, this app speaks v${CONTRACT_VERSION}`)
        }
        serverTables = preflight.tables
      } catch (e) {
        L.set('message', `Backend contract not verified: ${String(e instanceof Error ? e.message : e).slice(0, 200)}`)
      }
    }
    const bdb = new Database(path, { readonly: true, fileMustExist: true })
    let report: SeedReport
    try {
      report = buildReport(bdb, { backupPath: path, backupSha256: sha256, integrityOk }, serverTables)
    } finally {
      bdb.close()
    }
    if (!serverTables) report.notes.push('Backend contract NOT checked yet (offline or not registered). Approval requires this check.')
    L.setJson('report', report)
    L.setState(report.status === 'passed' ? 'checked' : 'blocked')
    L.event('checked', `${report.status} digest=${report.digest.slice(0, 12)}`)
    return report
  }

  // ───────────────────────── step 3: explicit approval ─────────────────────────

  canApprove(): boolean {
    const r = this.d.ledger.getJson<SeedReport>('report')
    return this.d.ledger.state() === 'checked' && r?.status === 'passed' && !!this.loadSession()
  }

  /** The only way into an uploadable state. Nothing uploads before this succeeds. */
  async approve(phrase: string): Promise<void> {
    this.assertIdle()
    const L = this.d.ledger
    if (phrase.trim() !== CONFIRM_PHRASE) throw new Error(`Type ${CONFIRM_PHRASE} to confirm`)
    if (L.state() !== 'checked') throw new Error('Run the backup and checks first')
    const shown = L.getJson<SeedReport>('report')
    if (!shown || shown.status !== 'passed') throw new Error('The checks did not pass')
    if (!this.loadSession()) throw new Error('This device is not registered with the backend')

    // Re-verify against the server NOW, on the same backup, and require the same data digest.
    const fresh = await this.recheck()
    if (fresh.status !== 'passed') throw new Error('Checks no longer pass against the backend — see blockers')
    if (fresh.digest !== shown.digest) throw new Error('Data changed since the summary was shown — review again')
    if (fresh.notes.some(n => n.includes('NOT checked'))) throw new Error('Backend contract could not be verified')

    const pre = await this.getClient()!.preflight()
    const mine = L.installId()
    if (pre.state !== 'empty' && pre.install_id !== mine) {
      throw new Error('The backend already holds seed data from a different installation. Refusing to mix datasets.')
    }
    L.setJson('approval', { at: new Date().toISOString(), digest: fresh.digest, backupSha256: fresh.backupSha256 })
    L.setState('approved')
  }

  // ───────────────────────── step 4: upload (resumable) ─────────────────────────

  canRun(): boolean {
    const s = this.d.ledger.state()
    return ['approved', 'paused', 'failed', 'needs_review'].includes(s) && !!this.d.ledger.getJson('approval') && !this.running && !this.checking
  }

  pause(): void { if (this.running) this.cancel = true }

  async run(): Promise<void> {
    const L = this.d.ledger
    if (this.running) throw new Error('Seed already running')
    if (!this.canRun()) throw new Error('Seed is not approved')
    const report = L.getJson<SeedReport>('report')
    const approval = L.getJson<{ digest: string; backupSha256: string }>('approval')
    const client = this.getClient()
    if (!report || !approval || !client || report.status !== 'passed' || approval.digest !== report.digest) {
      throw new Error('Approval does not match the current report')
    }

    this.running = true
    this.cancel = false
    closeSeedGate(this.d.liveDb())
    try {
      // The backup must be byte-identical to what was checked and approved.
      const sha = await hashFile(report.backupPath)
      if (sha !== approval.backupSha256) throw new Error('Backup file changed after approval — start over')

      const pre = await client.preflight()
      const installId = L.installId()
      if (pre.state !== 'empty' && pre.install_id !== installId) throw new Error('Backend belongs to a different installation')

      const expected = Object.fromEntries(report.tables.map(t => [t.name, { rows: t.seedable, money_sums_millimes: t.moneySumsMillimes, digest: t.digest }]))
      let seedId = L.get('seed_id')
      if (!seedId || L.get('seed_digest') !== report.digest) {
        const b = await client.seedBegin({ install_id: installId, report_digest: report.digest, expected })
        seedId = b.seed_id
        L.set('seed_id', seedId)
        L.set('seed_digest', report.digest)
      }

      L.setState('running')
      L.set('message', null)
      const bdb = new Database(report.backupPath, { readonly: true, fileMustExist: true })
      try {
        const tables = report.tables.filter(t => t.seedable > 0)
        this.progress = { table: null, tableIndex: 0, tableCount: tables.length, sent: 0, total: 0, startedAt: new Date().toISOString() }
        let stalled = 0
        for (let i = 0; i < tables.length; i++) {
          const t = tables[i]
          this.progress = { ...this.progress, table: t.name, tableIndex: i + 1, sent: 0, total: t.seedable }
          const gen = pendingRows(bdb, t.name, installId, L.isAcked)
          let batch: PendingRow[] = []
          let bytes = 0
          const flush = async (): Promise<void> => {
            if (!batch.length) return
            const rows = batch
            batch = []; bytes = 0
            const batchId = `${seedId}:${t.name}:${rows[0].opId.slice(0, 16)}:${rows.length}`
            const res = await client.seedBatch({
              seed_id: seedId!, batch_id: batchId, table: t.name, money_columns: [...moneyColumnsOf(t.name)],
              rows: rows.map(r => ({ op_id: r.opId, row: r.row })),
            })
            const rejectedIds = new Set(res.rejected.map(r => r.op_id))
            L.ackMany(rows.filter(r => !rejectedIds.has(r.opId)).map(r => ({ table: r.table, pk: r.pk, hash: r.hash })))
            if (res.rejected.length) {
              const byOp = new Map(rows.map(r => [r.opId, r]))
              L.addRejected(res.rejected.map(r => ({ op_id: r.op_id, table_name: t.name, pk: byOp.get(r.op_id)?.pk ?? r.pk, code: r.code, message: r.message })))
            }
            L.resolveRejected(rows.filter(r => !rejectedIds.has(r.opId)).map(r => r.opId))
            this.progress = { ...this.progress, sent: this.progress.sent + rows.length }
            stalled = res.rejected.length === rows.length ? stalled + 1 : 0
            if (stalled >= 3) throw new Error(`Backend rejected 3 consecutive full batches on ${t.name} — stopping (see rejected operations)`)
          }
          for (const row of gen) {
            batch.push(row)
            bytes += JSON.stringify(row.row).length
            if (batch.length >= Math.min(pre.max_batch_rows, 500) || bytes >= Math.min(pre.max_batch_bytes, 900_000)) {
              await flush()
              if (this.cancel) { L.setState('paused'); L.set('message', 'Paused by user.'); return }
            }
          }
          await flush()
          if (this.cancel) { L.setState('paused'); L.set('message', 'Paused by user.'); return }
        }
      } finally {
        bdb.close()
      }

      L.setState('finalizing')
      if (await hashFile(report.backupPath) !== approval.backupSha256) throw new Error('Backup file changed during upload')
      const fin = await client.seedFinalize({ seed_id: seedId, expected })
      const rejected = L.rejectedCount()
      if (fin.ok === true && Array.isArray(fin.diffs) && fin.diffs.length === 0 && rejected === 0) {
        openVerifiedGate(this.d.liveDb(), report.digest, report.backupSha256)
        L.setState('done')
        L.set('message', 'Seed complete. Server totals match this PC.')
        L.setJson('last_seed', { at: new Date().toISOString(), digest: report.digest })
      } else {
        L.setState('needs_review')
        L.setJson('finalize_diffs', fin.diffs)
        L.set('message', `Seed finished but needs review: ${rejected} rejected, ${fin.diffs.length} total mismatch(es).`)
      }
    } catch (e) {
      closeSeedGate(this.d.liveDb())
      const msg = e instanceof Error ? e.message : String(e)
      const permanent = e instanceof BackendError && !e.retryable
      L.setState(permanent ? 'failed' : 'paused')
      L.set('message', `${permanent ? 'Stopped' : 'Paused'}: ${msg.slice(0, 300)}`)
      L.event('run_error', msg.slice(0, 500))
      throw e
    } finally {
      this.running = false
      this.progress = { ...this.progress, table: null }
    }
  }

  /** After 'done'/'needs_review': start a fresh backup+check; only changed rows will upload (ledger skips the rest). */
  resetForNewPass(): void {
    this.assertIdle()
    closeSeedGate(this.d.liveDb())
    this.d.ledger.set('approval', null)
    this.d.ledger.set('seed_id', null)
    this.d.ledger.set('seed_digest', null)
    this.d.ledger.setState('idle')
  }

  // ───────────────────────── panel status ─────────────────────────

  private assertIdle(): void {
    if (this.running || this.checking) throw new Error('A seed operation is running — wait or pause it first')
  }

  rejected(): RejectedOp[] { return this.d.ledger.rejected() }

  async status(force = false): Promise<PanelStatus> {
    const L = this.d.ledger
    const baseUrl = L.get('base_url')
    const session = this.loadSession()
    let connection: PanelStatus['connection'] = !baseUrl ? 'unconfigured' : !session ? 'unregistered' : 'offline'
    let server: ServerStatus | null = null
    let connectionError: string | null = null

    if (baseUrl && session) {
      const c = this.serverCache
      if (!force && c && Date.now() - c.at < 4_000) {
        server = c.value; connectionError = c.error; connection = c.kind
      } else {
        try {
          server = await this.getClient()!.status()
          connection = 'online'
        } catch (e) {
          connection = e instanceof BackendError && (e.status === 401 || e.status === 403) ? 'auth_failed' : 'offline'
          connectionError = (e instanceof Error ? e.message : String(e)).slice(0, 200)
        }
        this.serverCache = { at: Date.now(), value: server, error: connectionError, kind: connection }
      }
    }

    const report = L.getJson<SeedReport>('report')
    const backup = L.getJson<BackupVerification>('backup')
    return {
      connection, connectionError, baseUrl,
      deviceId: L.get('device_id'), deviceName: L.get('device_name'),
      sessionPersisted: !!L.get('session_sealed'),
      server,
      seed: {
        state: L.state(),
        message: L.get('message'),
        report,
        backup: backup ? { path: backup.path, bytes: backup.bytes, sha256: backup.sha256, ok: backup.ok, problems: backup.problems } : null,
        progress: this.progress,
        ackedRows: L.ackedCount(),
        totalRows: report ? report.tables.reduce((n, t) => n + t.seedable, 0) : 0,
        rejectedCount: L.rejectedCount(),
        canApprove: this.canApprove(),
        canRun: this.canRun(),
      },
      legacyQueue: this.d.legacyQueue(),
    }
  }
}

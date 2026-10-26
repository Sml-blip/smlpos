import { createHash } from 'node:crypto'
import Database from 'better-sqlite3'
import { convertRow, describeColumns, iterateSeedRows } from './dryRun'
import { primaryKeyOf } from './tables'
import type {
  BackendError, BatchResult, BootstrapPage, ClientOptions, FinalizeResult, LiveChange,
  LiveOp, PullPage, PushResult, Preflight, ServerStatus, Session,
} from './client'

type Sync2Contract = { schemaVersion: number; tables: Record<string, { pk: string; columns: Record<string, string> }> }
type SeedSnapshot = { path: string; tables: string[]; snapshotHash: string }
type ManifestStats = { count: number; checksum: string; contentChecksum: string; moneyTotals: Record<string, string> }
type Sync2Manifest = { snapshotHash: string; expected: Record<string, ManifestStats> }
type Sync2OpResult = { opId: string; status: 'applied' | 'duplicate' | 'rejected'; version?: string; code?: string; reason?: string }

const canon = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canon(item)}`).join(',')}}`
  return JSON.stringify(value)
}
const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const mod = 1n << 256n
const addHash = (old: string, next: string) => ((BigInt(`0x${old}`) + BigInt(`0x${next}`)) % mod).toString(16).padStart(64, '0')
const emptyStats = (table: Sync2Contract['tables'][string]): ManifestStats => ({
  count: 0, checksum: '0'.repeat(64), contentChecksum: '0'.repeat(64),
  moneyTotals: Object.fromEntries(Object.entries(table.columns).filter(([, kind]) => kind === 'money').map(([name]) => [name, '0'])),
})

/** Build the exact sync2 snapshot stats from the same verified backup used by the seed uploader. */
function buildManifest(db: Database.Database, snapshotHash: string, tables: string[], contract: Sync2Contract): Sync2Manifest {
  const expected = Object.fromEntries(Object.entries(contract.tables).map(([name, schema]) => [name, emptyStats(schema)]))
  for (const table of tables) {
    if (!Object.hasOwn(contract.tables, table)) throw new Error(`Seed table is missing from sync2 contract: ${table}`)
    const cols = describeColumns(db, table)
    const stats = expected[table]
    for (const { raw, skipped } of iterateSeedRows(db, table)) {
      if (skipped) continue
      const converted = convertRow(table, raw, cols, null)
      if (!converted) continue
      stats.count++
      stats.checksum = addHash(stats.checksum, sha(converted.pk))
      stats.contentChecksum = addHash(stats.contentChecksum, sha(canon(converted.row)))
      for (const column of Object.keys(stats.moneyTotals)) {
        stats.moneyTotals[column] = String(BigInt(stats.moneyTotals[column]) + BigInt(String(converted.row[column] ?? 0)))
      }
    }
  }
  return { snapshotHash, expected }
}

function assertReportMatchesManifest(manifest: Sync2Manifest, reportExpected: Record<string, unknown>): void {
  for (const [table, raw] of Object.entries(reportExpected)) {
    const expected = raw as { rows?: number; money_sums_millimes?: Record<string, number> }
    const actual = manifest.expected[table]
    if (!actual || actual.count !== expected.rows) throw new Error(`Approved seed row count changed for ${table}`)
    for (const [field, total] of Object.entries(expected.money_sums_millimes ?? {})) {
      if (actual.moneyTotals[field] !== String(total)) throw new Error(`Approved seed money total changed for ${table}.${field}`)
    }
  }
}

/** HTTP/protocol adapter. Tokens only pass through injected main-process session callbacks. */
export class ServerAdapter {
  private refreshing: Promise<Session> | null = null
  private manifestHash: string | null = null
  private contract: Sync2Contract | null = null
  private readonly f: typeof fetch
  private readonly timeoutMs: number
  private readonly maxAttempts: number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly o: ClientOptions & { appVersion: string }) {
    this.f = o.fetchImpl ?? fetch
    this.timeoutMs = o.timeoutMs ?? 30_000
    this.maxAttempts = o.maxAttempts ?? 4
    this.sleep = o.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  }

  private async raw(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs)
    try {
      return await this.f(this.o.baseUrl + path, {
        method, headers: { accept: 'application/json', 'content-type': 'application/json', 'X-Client-Version': this.o.appVersion, ...headers },
        body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal,
      })
    } finally { clearTimeout(timer) }
  }

  private async error(res: Response): Promise<BackendError> {
    const { BackendError } = await import('./client')
    let code = `http_${res.status}`, message = res.statusText || 'request failed'
    try { const body = await res.json() as { code?: string; message?: string }; code = body.code ?? code; message = body.message ?? message } catch { /* non-JSON error */ }
    return new BackendError(res.status, code, message, res.status === 429 || res.status >= 500)
  }

  private async request<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
    let refreshedOnce = false
    let last: unknown
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const session = auth ? this.o.loadSession() : null
        if (auth && !session) {
          const { BackendError } = await import('./client')
          throw new BackendError(401, 'no_session', 'Device is not registered', false)
        }
        const headers: Record<string, string> = auth && session ? { authorization: `Bearer ${session.access_token}` } : {}
        const res = await this.raw(method, path, body, headers)
        if (res.status === 401 && auth && !refreshedOnce) { refreshedOnce = true; await this.refresh(); attempt--; continue }
        if (!res.ok) throw await this.error(res)
        return (res.status === 204 ? undefined : await res.json()) as T
      } catch (error) {
        last = error
        const retryable = (error as { retryable?: boolean }).retryable ?? true
        if (!retryable || attempt === this.maxAttempts) break
        await this.sleep(Math.min(8000, 500 * 2 ** (attempt - 1)))
      }
    }
    throw last
  }

  private sessionFrom(data: { accessToken: string; refreshToken: string; expiresIn: number }): Session {
    if (!data?.accessToken || !data.refreshToken || !Number.isFinite(data.expiresIn)) throw new Error('Invalid login/refresh response')
    return { access_token: data.accessToken, refresh_token: data.refreshToken, expires_at: new Date(Date.now() + data.expiresIn * 1000).toISOString() }
  }

  private refresh(): Promise<Session> {
    if (this.refreshing) return this.refreshing
    this.refreshing = (async () => {
      const current = this.o.loadSession()
      if (!current) throw new Error('Device is not registered')
      try {
        const data = await this.request<{ accessToken: string; refreshToken: string; expiresIn: number }>('POST', '/auth/refresh', { refreshToken: current.refresh_token }, false)
        const next = this.sessionFrom(data)
        this.o.saveSession(next)
        return next
      } catch (error) {
        if ((error as { status?: number }).status === 401 || (error as { status?: number }).status === 403) this.o.saveSession(null)
        throw error
      }
    })().finally(() => { this.refreshing = null })
    return this.refreshing
  }

  private async authorized<T>(method: string, path: string, body?: unknown): Promise<T> {
    const session = this.o.loadSession()
    if (session && Date.parse(session.expires_at) - Date.now() < 30_000) await this.refresh()
    return this.request<T>(method, path, body, true)
  }

  async login(username: string, password: string, deviceId: string, deviceName: string, platform: string) {
    const normalizedPlatform = platform === 'win32' || platform === 'windows' ? 'windows' : platform === 'android' ? 'android' : 'development'
    const data = await this.request<{ accessToken: string; refreshToken: string; expiresIn: number; role: string }>('POST', '/auth/login', {
      username, password, deviceId, deviceName, platform: normalizedPlatform,
    }, false)
    const session = this.sessionFrom(data)
    this.o.saveSession(session)
    return { device_id: deviceId, session, role: data.role }
  }

  async status(): Promise<ServerStatus> {
    const [devices, sync] = await Promise.all([
      this.authorized<{ devices: Array<Record<string, unknown>>; currentDeviceId: string }>('GET', '/devices'),
      this.authorized<Record<string, unknown>>('GET', '/sync/status'),
    ])
    const active = await this.seedIsActive()
    const mappedDevices = devices.devices.map(device => ({
      device_id: String(device.id ?? ''), name: String(device.name ?? ''), platform: String(device.platform ?? 'unknown'),
      role: String(device.id ?? '') === devices.currentDeviceId ? 'current' : 'device',
      app_version: String(device.client_version ?? ''), last_seen_at: typeof device.last_seen_at === 'string' ? device.last_seen_at : null,
      online: Boolean(device.online),
    }))
    return {
      server_time: new Date().toISOString(), contract_version: 1, devices: mappedDevices,
      seed: { state: active ? 'seeded' : 'empty' }, rejected_count: Array.isArray(sync.rejections) ? sync.rejections.length : 0,
    }
  }

  private async loadContract(): Promise<Sync2Contract> {
    if (!this.contract) this.contract = await this.authorized<Sync2Contract>('GET', '/sync2/contract')
    if (!this.contract || this.contract.schemaVersion !== 2 || !this.contract.tables) throw new Error('Unsupported sync2 contract response')
    return this.contract
  }

  private async seedIsActive(): Promise<boolean> {
    try { await this.authorized('GET', '/sync2/pull?since=0&limit=1'); return true }
    catch (error) { if ((error as { code?: string }).code === 'SEED_REQUIRED') return false; throw error }
  }

  async preflight(): Promise<Preflight> {
    const [contract, seeded] = await Promise.all([this.loadContract(), this.seedIsActive()])
    return {
      contract_version: 1, state: seeded ? 'seeded' : 'empty',
      tables: Object.fromEntries(Object.entries(contract.tables).map(([name, table]) => [name, { columns: Object.keys(table.columns), pk: table.pk }])),
      max_batch_rows: 500, max_batch_bytes: 900_000,
    }
  }

  async seedBegin(body: { install_id: string; report_digest: string; expected: Record<string, unknown> }, snapshot: SeedSnapshot) {
    if (snapshot.snapshotHash !== body.report_digest) throw new Error('Seed snapshot hash differs from the approved report')
    const contract = await this.loadContract()
    const db = new Database(snapshot.path, { readonly: true, fileMustExist: true })
    let manifest: Sync2Manifest
    try { manifest = buildManifest(db, snapshot.snapshotHash, snapshot.tables, contract) } finally { db.close() }
    assertReportMatchesManifest(manifest, body.expected)
    this.manifestHash = sha(canon(manifest))
    const result = await this.authorized<{ seedId: string; status: string }>('POST', '/sync2/seed/start', manifest)
    return { seed_id: result.seedId }
  }

  async seedBatch(body: { seed_id: string; batch_id: string; table: string; money_columns: string[]; rows: { op_id: string; row: Record<string, unknown> }[] }): Promise<BatchResult> {
    const rows = body.rows.map(item => item.row)
    const validation = await this.authorized<{ blocking: Array<{ id: string; reason: string }>; count: number; writes: number }>('POST', '/sync2/seed/validate', { table: body.table, rows })
    const pk = primaryKeyOf(body.table)
    const rejected = validation.blocking.map(item => ({
      op_id: body.rows.find(row => String(row.row[pk] ?? '') === item.id)?.op_id ?? '',
      pk: item.id, code: 'INVALID_ROW', message: item.reason,
    }))
    if (rejected.some(item => !item.op_id)) throw new Error('Seed validation returned a row identity outside the submitted batch')
    const rejectedIds = new Set(rejected.map(item => item.op_id))
    const acceptedRows = body.rows.filter(item => !rejectedIds.has(item.op_id)).map(item => item.row)
    if (!acceptedRows.length) return { accepted: 0, duplicates: 0, rejected }
    const batchId = sha(canon({ seedId: body.seed_id, table: body.table, rows: acceptedRows }))
    const result = await this.authorized<{ accepted: number; duplicate: number }>('POST', '/sync2/seed/batch', {
      seedId: body.seed_id, batchId, table: body.table, rows: acceptedRows,
    })
    return { accepted: result.accepted, duplicates: result.duplicate, rejected }
  }

  async seedFinalize(body: { seed_id: string; expected: Record<string, unknown> }, snapshot: SeedSnapshot): Promise<FinalizeResult> {
    const contract = await this.loadContract()
    const db = new Database(snapshot.path, { readonly: true, fileMustExist: true })
    let manifest: Sync2Manifest
    try { manifest = buildManifest(db, snapshot.snapshotHash, snapshot.tables, contract) }
    finally { db.close() }
    assertReportMatchesManifest(manifest, body.expected)
    const manifestHash = this.manifestHash ?? sha(canon(manifest))
    const verified = await this.authorized<{ ok: boolean; actual: Record<string, ManifestStats>; mismatches: string[]; status: string }>('POST', '/sync2/seed/verify', { seedId: body.seed_id })
    if (!verified.ok) return {
      ok: false, diffs: verified.mismatches.map(table => ({ table, field: 'manifest', expected: 'approved snapshot', actual: 'server mismatch' })),
    }
    await this.authorized('POST', '/sync2/seed/activate', { seedId: body.seed_id, reviewedManifestHash: manifestHash })
    return { ok: true, diffs: [] }
  }

  async pushLive(deviceId: string, ops: LiveOp[]): Promise<PushResult> {
    if (!ops.length) return { results: [], server_seq: 0 }
    const unsupported = ops.filter(op => op.op === 'DELTA')
    const unsafeProductWrites = ops.filter(op => op.op === 'UPSERT' && op.table === 'produits')
    const supported = ops.filter(op => op.op !== 'DELTA' && !(op.op === 'UPSERT' && op.table === 'produits'))
    const resultMap = new Map<number, PushResult['results'][number]>()
    // Later server work must allowlist each table/field, atomically add its delta
    // to the aggregate (and append its server-owned audit movement where needed),
    // create stock_movements for stock, then publish the DELTA to the pull log.
    // Never replace a counter with an absolute snapshot from an offline device.
    for (const op of unsupported) resultMap.set(op.seq, {
      seq: op.seq, status: 'rejected', code: 'UNSUPPORTED_DELTA',
      message: `Counter delta ${op.table}.${op.op === 'DELTA' ? op.field : ''} is not supported by the current sync2 server`,
    })
    // sync2 recalculates stock_actuel from stock_movements on every product
    // write. The active capture path does not maintain that ledger, so sending
    // even a non-stock product edit could replace server stock with an incomplete sum.
    for (const op of unsafeProductWrites) resultMap.set(op.seq, {
      seq: op.seq, status: 'rejected', code: 'UNSUPPORTED_COUNTER_LEDGER',
      message: 'Product writes are paused until the server stock_movements ledger is maintained',
    })
    let serverSeq = 0
    if (supported.length) {
      const payloadOps = supported.map(op => {
        const primaryKey = primaryKeyOf(op.table)
        const row = op.op === 'UPSERT' ? op.row : { [primaryKey]: op.pk }
        return {
          opId: sha(`${deviceId}:${op.seq}`), table: op.table, rowId: op.pk,
          op: op.op === 'DELETE' ? 'DELETE' : 'INSERT', payload: row,
        }
      })
      const originalById = new Map(payloadOps.map((payload, index) => [payload.opId, supported[index]]))
      const response = await this.authorized<{ results: Sync2OpResult[] }>('POST', '/sync2/push', { ops: payloadOps })
      for (const item of response.results) {
        const original = originalById.get(item.opId)
        if (!original) throw new Error('sync2 push returned an unknown operation ID')
        if (item.version && /^\d+$/.test(item.version)) serverSeq = Math.max(serverSeq, Number(item.version))
        resultMap.set(original.seq, {
          seq: original.seq, status: item.status === 'duplicate' ? 'duplicate' : item.status,
          ...(item.code ? { code: item.code } : {}), ...(item.reason ? { message: item.reason } : {}),
        })
      }
    }
    return { results: ops.map(op => resultMap.get(op.seq)!).filter(Boolean), server_seq: serverSeq }
  }

  async pullLive(since: number): Promise<PullPage> {
    const page = await this.authorized<{ rows: Array<{ seq: string; table_name: string; row_id: string; payload: Record<string, unknown>; deleted: boolean }>; nextSeq: string; hasMore: boolean }>(
      'GET', `/sync2/pull?since=${since}&limit=500`,
    )
    const changes: LiveChange[] = page.rows.map(row => ({
      server_seq: Number(row.seq), origin_device: String(row.payload?.device_id ?? 'server'),
      table: row.table_name, pk: row.row_id, op: row.deleted ? 'DELETE' : 'UPSERT',
      ...(!row.deleted ? { row: row.payload } : {}),
    }))
    return { changes, next_seq: Number(page.nextSeq), has_more: page.hasMore }
  }

  /** Compatibility helper; new replica bootstrap uses pullLive from sequence zero. */
  async bootstrapPage(table: string, after: string, asOf: number | null): Promise<BootstrapPage> {
    const page = await this.pullLive(asOf ?? 0)
    const rows = page.changes.filter(change => change.table === table && change.op === 'UPSERT' && change.pk > after).map(change => change.row!)
    return { rows, as_of_seq: page.next_seq, has_more: page.has_more }
  }
}

/** HTTP client for the seed/sync backend. See docs/SEED_CONTRACT.md for every endpoint. */

export interface Session {
  access_token: string
  refresh_token: string
  /** ISO time the access token expires. */
  expires_at: string
}

export interface DeviceInfo {
  device_id: string
  name: string
  platform: string
  role?: string
  app_version?: string
  last_seen_at: string | null
  online?: boolean
}

export interface ServerStatus {
  server_time: string
  contract_version: number
  devices: DeviceInfo[]
  seed: { state: 'empty' | 'seeding' | 'seeded'; install_id?: string | null; rows?: number }
  rejected_count?: number
}

export interface Preflight {
  contract_version: number
  state: 'empty' | 'seeding' | 'seeded'
  install_id?: string | null
  tables: Record<string, { columns: string[]; pk: string }>
  max_batch_rows: number
  max_batch_bytes: number
}

export interface BatchResult {
  accepted: number
  duplicates: number
  rejected: { op_id: string; pk: string; code: string; message: string }[]
}

export interface FinalizeResult {
  ok: boolean
  diffs: { table: string; field: string; expected: number | string; actual: number | string }[]
}

export class BackendError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly retryable: boolean) {
    super(message)
  }
}

export interface ClientOptions {
  baseUrl: string
  loadSession: () => Session | null
  saveSession: (s: Session | null) => void
  fetchImpl?: typeof fetch
  timeoutMs?: number
  maxAttempts?: number
  sleep?: (ms: number) => Promise<void>
}

export function validateBaseUrl(raw: string): string {
  let u: URL
  try { u = new URL(raw.trim()) } catch { throw new Error('Invalid backend URL') }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) {
    throw new Error('The backend URL must use https:// (http:// is only accepted for localhost)')
  }
  return u.origin
}

export class BackendClient {
  private readonly f: typeof fetch
  private readonly timeoutMs: number
  private readonly maxAttempts: number
  private readonly sleep: (ms: number) => Promise<void>
  private refreshing: Promise<Session> | null = null

  constructor(private readonly o: ClientOptions) {
    this.f = o.fetchImpl ?? fetch
    this.timeoutMs = o.timeoutMs ?? 30_000
    this.maxAttempts = o.maxAttempts ?? 4
    this.sleep = o.sleep ?? (ms => new Promise(r => setTimeout(r, ms)))
  }

  private async raw(method: string, path: string, body: unknown, headers: Record<string, string>): Promise<Response> {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), this.timeoutMs)
    try {
      return await this.f(this.o.baseUrl + path, {
        method,
        headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctl.signal,
      })
    } finally {
      clearTimeout(t)
    }
  }

  private async parseError(res: Response): Promise<BackendError> {
    let code = `http_${res.status}`
    let message = res.statusText || 'request failed'
    try {
      const j = await res.json() as { code?: string; message?: string }
      if (j.code) code = j.code
      if (j.message) message = j.message
    } catch { /* body not json */ }
    const retryable = res.status === 429 || res.status >= 500
    return new BackendError(res.status, code, message, retryable)
  }

  /** Single-flight refresh. The refresh token ROTATES, so the new pair is saved before it is used. */
  private refresh(): Promise<Session> {
    if (this.refreshing) return this.refreshing
    this.refreshing = (async () => {
      const cur = this.o.loadSession()
      if (!cur) throw new BackendError(401, 'no_session', 'Device is not registered', false)
      const res = await this.raw('POST', '/v1/auth/refresh', { refresh_token: cur.refresh_token }, {})
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) this.o.saveSession(null)
        throw await this.parseError(res)
      }
      const next = await res.json() as Session
      this.o.saveSession(next)
      return next
    })().finally(() => { this.refreshing = null })
    return this.refreshing
  }

  private async bearer(): Promise<string> {
    let s = this.o.loadSession()
    if (!s) throw new BackendError(401, 'no_session', 'Device is not registered', false)
    if (Date.parse(s.expires_at) - Date.now() < 30_000) s = await this.refresh()
    return s.access_token
  }

  async request<T>(method: string, path: string, body?: unknown, opts: { auth?: boolean; idempotencyKey?: string } = {}): Promise<T> {
    const auth = opts.auth !== false
    let lastErr: unknown
    let refreshedOnce = false
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const headers: Record<string, string> = {}
        if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey
        if (auth) headers.authorization = `Bearer ${await this.bearer()}`
        const res = await this.raw(method, path, body, headers)
        if (res.status === 401 && auth && !refreshedOnce) {
          refreshedOnce = true
          await this.refresh()
          attempt--
          continue
        }
        if (!res.ok) throw await this.parseError(res)
        return (res.status === 204 ? undefined : await res.json()) as T
      } catch (e) {
        lastErr = e
        const retryable = e instanceof BackendError ? e.retryable : true // network error / abort
        if (!retryable || attempt === this.maxAttempts) break
        await this.sleep(Math.min(8000, 500 * 2 ** (attempt - 1)))
      }
    }
    throw lastErr
  }

  register(enrollmentToken: string, device: { install_id: string; name: string; platform: string; app_version: string; schema_version: string | null }) {
    return this.request<{ device_id: string; session: Session }>(
      'POST', '/v1/devices/register', { enrollment_token: enrollmentToken, ...device }, { auth: false },
    )
  }
  status() { return this.request<ServerStatus>('GET', '/v1/status') }
  preflight() { return this.request<Preflight>('GET', '/v1/seed/preflight') }
  seedBegin(body: { install_id: string; report_digest: string; expected: Record<string, unknown> }) {
    return this.request<{ seed_id: string }>('POST', '/v1/seed/begin', body, { idempotencyKey: `begin:${body.report_digest}` })
  }
  seedBatch(body: {
    seed_id: string; batch_id: string; table: string; money_columns: string[]
    rows: { op_id: string; row: Record<string, unknown> }[]
  }) {
    return this.request<BatchResult>('POST', '/v1/seed/batches', body, { idempotencyKey: body.batch_id })
  }
  seedFinalize(body: { seed_id: string; expected: Record<string, unknown> }) {
    return this.request<FinalizeResult>('POST', '/v1/seed/finalize', body, { idempotencyKey: `finalize:${body.seed_id}` })
  }
}

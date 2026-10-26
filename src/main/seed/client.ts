/** Public seed/sync API kept stable for the rest of the app; protocol details live in serverAdapter. */
import { ServerAdapter } from './serverAdapter'

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
  server_seq?: number
  min_client_version?: string
  schema_version?: string
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
export type LiveOp = { seq:number;table:string;pk:string;at:string } &
  ({op:'UPSERT';row:Record<string,unknown>} | {op:'DELETE'} | {op:'DELTA';field:string;value:number})
export interface PushResult { results:{seq:number;status:'applied'|'duplicate'|'rejected';code?:string;message?:string}[];server_seq:number }
export type LiveChange = Omit<LiveOp,'seq'|'at'> & { server_seq:number;origin_device:string;table:string;pk:string;op:'UPSERT'|'DELETE'|'DELTA';row?:Record<string,unknown>;field?:string;value?:number }
export interface PullPage { changes:LiveChange[];next_seq:number;has_more:boolean }
export interface BootstrapPage { rows:Record<string,unknown>[];as_of_seq:number;has_more:boolean }

export class BackendError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly retryable: boolean) {
    super(message)
  }
}

export interface ClientOptions {
  baseUrl: string
  appVersion?: string
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
  private readonly adapter: ServerAdapter
  constructor(private readonly o: ClientOptions) { this.adapter = new ServerAdapter({ ...o, appVersion: o.appVersion ?? '0.0.0' }) }
  register(username: string, password: string, deviceId: string, device: { name: string; platform: string }) {
    return this.adapter.login(username, password, deviceId, device.name, device.platform)
  }
  status() { return this.adapter.status() }
  preflight() { return this.adapter.preflight() }
  seedBegin(body: { install_id: string; report_digest: string; expected: Record<string, unknown> }, snapshot: { path: string; installId: string; tables: string[]; snapshotHash: string }) {
    return this.adapter.seedBegin(body, snapshot)
  }
  seedBatch(body: { seed_id: string; batch_id: string; table: string; money_columns: string[]; rows: { op_id: string; row: Record<string, unknown> }[] }) {
    return this.adapter.seedBatch(body)
  }
  seedFinalize(body: { seed_id: string; expected: Record<string, unknown> }, snapshot: { path: string; installId: string; tables: string[]; snapshotHash: string }) {
    return this.adapter.seedFinalize(body, snapshot)
  }
  pushLive(deviceId: string, ops: LiveOp[]) { return this.adapter.pushLive(deviceId, ops) }
  pullLive(since: number) { return this.adapter.pullLive(since) }
  bootstrapPage(table: string, after: string, asOf: number | null) { return this.adapter.bootstrapPage(table, after, asOf) }
}

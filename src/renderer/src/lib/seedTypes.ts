/** Renderer-side mirror of the main-process seed panel types (src/main/seed). */
export type SeedResult<T> = { ok: true; data: T } | { ok: false; error: string }

export interface SeedIssue { table: string; code: string; column?: string; count: number; samples: string[] }

export interface SeedTableReport {
  name: string
  rows: number
  seedable: number
  skipped: number
  moneyColumns: string[]
  moneySumsMillimes: Record<string, number>
}

export interface SeedReportView {
  status: 'passed' | 'blocked'
  createdAt: string
  backupPath: string
  backupSha256: string
  schemaVersion: string | null
  tables: SeedTableReport[]
  blockers: SeedIssue[]
  warnings: SeedIssue[]
  notes: string[]
  excludedTables: string[]
  excludedSettingKeys: string[]
  digest: string
}

export interface SeedServerDevice {
  device_id: string
  name: string
  platform: string
  role?: string
  app_version?: string
  last_seen_at: string | null
  online?: boolean
}

export type SeedStateName =
  | 'idle' | 'backup_ok' | 'checked' | 'blocked' | 'approved' | 'running'
  | 'paused' | 'finalizing' | 'done' | 'needs_review' | 'failed'

export interface SeedPanelStatus {
  live: {
    prepared: boolean; enabled: boolean; backend: 'legacy' | 'vps'; pending: number; rejected: number; pullRejected: number
    cursor: number; serverSeq: number | null; lag: number | null; lastPush: string | null; lastPull: string | null
    pushError: string | null; pullError: string | null; retryAt: number
  }
  connection: 'unconfigured' | 'unregistered' | 'online' | 'offline' | 'auth_failed'
  connectionError: string | null
  baseUrl: string | null
  deviceId: string | null
  deviceName: string | null
  sessionPersisted: boolean
  server: { server_time: string; devices: SeedServerDevice[]; seed: { state: string } } | null
  seed: {
    state: SeedStateName
    message: string | null
    report: SeedReportView | null
    backup: { path: string; bytes: number; sha256: string; ok: boolean; problems: string[] } | null
    progress: { table: string | null; tableIndex: number; tableCount: number; sent: number; total: number; startedAt: string | null }
    ackedRows: number
    totalRows: number
    rejectedCount: number
    canApprove: boolean
    canRun: boolean
  }
  legacyQueue: { pending: number; failed: number }
}

export interface SeedRejectedOp { op_id: string; table_name: string; pk: string; code: string; message: string; at: string }

export interface SeedApi {
  sync2Issues: () => Promise<SeedResult<{ source: 'push' | 'pull'; seq: number; table: string; pk: string; reason: string; at: string }[]>>
  sync2Retry: () => Promise<SeedResult<void>>
  sync2Export: () => Promise<SeedResult<string | null>>
  seedStatus: (force?: boolean) => Promise<SeedResult<SeedPanelStatus>>
  seedRegister: (baseUrl: string, token: string, name: string) => Promise<SeedResult<void>>
  seedBackupAndCheck: () => Promise<SeedResult<SeedReportView>>
  seedRecheck: () => Promise<SeedResult<SeedReportView>>
  seedApprove: (phrase: string) => Promise<SeedResult<void>>
  seedRun: () => Promise<SeedResult<void>>
  seedPause: () => Promise<SeedResult<void>>
  seedNewPass: () => Promise<SeedResult<void>>
  seedRejected: () => Promise<SeedResult<SeedRejectedOp[]>>
  seedExportReport: () => Promise<SeedResult<string | null>>
}

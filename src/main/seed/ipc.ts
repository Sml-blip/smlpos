import { app, dialog, ipcMain, safeStorage } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { getArchiveDir } from '../dataPaths'
import { getDb } from '../db'
import { SeedLedger } from './ledger'
import { SeedService, type SecretBox } from './service'
import type { SeedReport } from './dryRun'
import { liveIssues, liveStatus, retryPush } from './monitor'
import { LegacySyncGate, startLiveRuntime } from './runtime'
import { reserveNumber } from './numbering'

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

const secretBox: SecretBox = {
  seal(plain) {
    try {
      return safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(plain).toString('base64') : null
    } catch { return null }
  },
  open(sealed) {
    try { return safeStorage.decryptString(Buffer.from(sealed, 'base64')) } catch { return null }
  },
}

let service: SeedService | null = null
export const legacySyncGate = new LegacySyncGate(getDb)

/** Created on first use: merely installing/launching the update creates no ledger and contacts no server. */
function getService(legacyQueue: () => { pending: number; failed: number }): SeedService {
  if (service) return service
  const ledger = new SeedLedger(join(app.getPath('userData'), 'seed-state.db'))
  service = new SeedService({
    liveDb: getDb,
    ledger,
    archiveDir: getArchiveDir(),
    secrets: secretBox,
    appVersion: app.getVersion(),
    platform: process.platform,
    legacyQueue,
    quiesceLegacy: () => legacySyncGate.quiesce(),
  })
  return service
}

async function wrap<T>(fn: () => Promise<T> | T): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function registerSeedIpc(legacyQueue: () => { pending: number; failed: number }): void {
  const svc = () => getService(legacyQueue)
  ipcMain.handle('sync2:prepareReplica', (_e, phrase: string) => wrap(() => svc().prepareReplica(phrase)))
  ipcMain.handle('sync2:joinReplica', () => wrap(async () => {
    void svc().bootstrapReplica().catch(() => { /* pull errors are persisted below */ })
  }))
  ipcMain.handle('sync2:reserveNumber', (_e, table: string, proposed: string) => reserveNumber(getDb(), table, proposed))
  ipcMain.handle('sync2:legacyBegin', () => legacySyncGate.begin())
  ipcMain.handle('sync2:legacyEnd', (_e, token: string) => legacySyncGate.end(String(token)))
  startLiveRuntime(getDb, { drain: () => svc().drainLiveChanges(), pull: () => svc().pullLiveChanges() })
  ipcMain.handle('sync2:issues', () => wrap(() => liveIssues(getDb())))
  ipcMain.handle('sync2:retry', () => wrap(() => retryPush(getDb())))
  ipcMain.handle('sync2:export', () => wrap(async () => {
    const result = await dialog.showSaveDialog({ defaultPath: 'smlpos-sync-diagnostics.json', filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (result.canceled || !result.filePath) return null
    // Export metadata only: no row payloads, credentials or customer records.
    writeFileSync(result.filePath, JSON.stringify({ status: liveStatus(getDb()), issues: liveIssues(getDb()) }, null, 2), 'utf8')
    return result.filePath
  }))

  ipcMain.handle('seed:status', (_e, force?: boolean) => wrap(() => svc().status(!!force)))
  ipcMain.handle('seed:register', (_e, baseUrl: string, token: string, name: string) =>
    wrap(() => svc().registerDevice(String(baseUrl), String(token), String(name))))
  ipcMain.handle('seed:backupAndCheck', () => wrap(() => svc().backupAndCheck()))
  ipcMain.handle('seed:recheck', () => wrap(() => svc().recheck()))
  ipcMain.handle('seed:approve', (_e, phrase: string) => wrap(() => svc().approve(String(phrase))))
  // Upload runs in the background; progress and errors are read through seed:status.
  ipcMain.handle('seed:run', () => wrap(async () => {
    const s = svc()
    if (!s.canRun()) throw new Error('Seed is not approved')
    s.run().catch(() => { /* state + message are persisted by run() */ })
  }))
  ipcMain.handle('seed:pause', () => wrap(() => svc().pause()))
  ipcMain.handle('seed:newPass', () => wrap(() => svc().resetForNewPass()))
  ipcMain.handle('seed:rejected', () => wrap(() => svc().rejected()))
  ipcMain.handle('seed:exportReport', () => wrap(async () => {
    const st = await svc().status()
    const report = st.seed.report as SeedReport | null
    if (!report) throw new Error('No report yet')
    const r = await dialog.showSaveDialog({
      defaultPath: `smlpos-seed-report-${report.createdAt.slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (r.canceled || !r.filePath) return null
    writeFileSync(r.filePath, JSON.stringify(report, null, 2), 'utf8')
    return r.filePath
  }))
}

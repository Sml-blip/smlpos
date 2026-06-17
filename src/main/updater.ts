import { app, BrowserWindow, ipcMain } from 'electron'
import updaterPkg from 'electron-updater'
import type { ProgressInfo, UpdateInfo } from 'electron-updater'

const { autoUpdater } = updaterPkg

/** Errors when no GitHub release exists yet — don't block the POS on startup. */
function isBenignUpdateError(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('no published versions') ||
    m.includes('cannot find latest.yml') ||
    m.includes('404') ||
    m.includes('net::err') ||
    m.includes('updates are disabled')
  )
}

let manualCheckActive = false

export type UpdateStatusPayload =
  | { state: 'checking' }
  | { state: 'available'; version: string; releaseNotes?: string }
  | { state: 'not-available'; version: string }
  | { state: 'downloading'; percent: number; transferred: number; total: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }

function formatReleaseNotes(notes: UpdateInfo['releaseNotes']): string | undefined {
  if (!notes) return undefined
  if (typeof notes === 'string') return notes
  if (Array.isArray(notes)) {
    return notes.map(n => (typeof n === 'string' ? n : n.note)).filter(Boolean).join('\n')
  }
  return undefined
}

export function setupAutoUpdater(getMainWindow: () => BrowserWindow | null): void {
  if (!app.isPackaged) {
    console.log('[updater] Disabled in development (packaged app only)')
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowDowngrade = false

  const send = (payload: UpdateStatusPayload) => {
    getMainWindow()?.webContents.send('update:status', payload)
  }

  autoUpdater.on('checking-for-update', () => {
    if (manualCheckActive) send({ state: 'checking' })
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    send({
      state: 'available',
      version: info.version,
      releaseNotes: formatReleaseNotes(info.releaseNotes),
    })
  })

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    send({ state: 'not-available', version: info.version })
  })

  autoUpdater.on('download-progress', (p: ProgressInfo) => {
    send({
      state: 'downloading',
      percent: p.percent,
      transferred: p.transferred,
      total: p.total,
    })
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    send({ state: 'downloaded', version: info.version })
  })

  autoUpdater.on('error', (err: Error) => {
    console.warn('[updater]', err.message)
    if (!manualCheckActive && isBenignUpdateError(err.message)) {
      console.warn('[updater] No GitHub release yet — skipping (app continues normally)')
      return
    }
    send({ state: 'error', message: err.message })
  })

  ipcMain.handle('update:check', async (_e, options?: { manual?: boolean }) => {
    if (!app.isPackaged) return { ok: false, reason: 'dev' }
    manualCheckActive = options?.manual === true
    try {
      await autoUpdater.checkForUpdates()
      return { ok: true }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (!manualCheckActive && isBenignUpdateError(message)) {
        return { ok: true, reason: 'no-release' }
      }
      send({ state: 'error', message })
      return { ok: false, reason: message }
    } finally {
      setTimeout(() => { manualCheckActive = false }, 5000)
    }
  })

  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall(false, true)
  })

  // Delay so the UI is ready before a blocking update modal
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(err => {
      console.warn('[updater] Startup check failed:', err)
    })
  }, 8000)
}

import { BrowserWindow } from 'electron'
import { writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { resolveElectronPageSize, type ElectronPageSize } from './printPageSize'

export interface PrintWindowOptions {
  printerName?: string
  silent?: boolean
  pageSize?: string | ElectronPageSize
  printBackground?: boolean
  color?: boolean
  copies?: number
}

/** Load HTML from a temp file (reliable for large invoices) and invoke OS print dialog. */
export function printHtmlInHiddenWindow(
  html: string,
  options: PrintWindowOptions = {},
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    })
    const tmpPath = join(tmpdir(), `smlpos-print-${Date.now()}.html`)
    let cleaned = false
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      try { unlinkSync(tmpPath) } catch { /* ignore */ }
      try { win.destroy() } catch { /* ignore */ }
    }

    try {
      writeFileSync(tmpPath, html, 'utf8')
    } catch (e) {
      cleanup()
      resolve({ success: false, error: String(e) })
      return
    }

    win.webContents.once('did-fail-load', () => {
      cleanup()
      resolve({ success: false, error: 'Échec chargement HTML impression' })
    })

    win.webContents.once('did-finish-load', () => {
      win.webContents.print({
        deviceName: options.printerName || undefined,
        silent: options.silent === true,
        printBackground: options.printBackground !== false,
        color: options.color !== false,
        copies: typeof options.copies === 'number' ? options.copies : 1,
        pageSize: resolveElectronPageSize(options.pageSize),
      }, (success, failureReason) => {
        cleanup()
        resolve({ success, error: success ? undefined : failureReason })
      })
    })

    win.loadFile(tmpPath).catch(err => {
      cleanup()
      resolve({ success: false, error: String(err) })
    })
  })
}

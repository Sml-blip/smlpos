import { wrapPrintHtml } from './printHtml'
import { runAction } from './apiCall'
import { showToast } from './toast'

const api = window.api

export type NativePrintPageSize = 'A4' | '58mm' | '80mm'
export type NativePrintSettingsKey = 'impression_printer_a4' | 'impression_printer_ticket'

export interface NativePrintOptions {
  pageSize?: NativePrintPageSize
  settingsKey?: NativePrintSettingsKey
  copies?: number
  silent?: boolean
}

async function resolvePrinter(settingsKey: NativePrintSettingsKey): Promise<string> {
  try {
    const settings = (await api.settingsGetAll()) as Record<string, string>
    return settings[settingsKey] ?? ''
  } catch {
    return ''
  }
}

/** Print inner HTML (wrapped for A4/thermal) via native Electron IPC. */
export async function printHtmlNow(innerHtml: string, options: NativePrintOptions = {}): Promise<boolean> {
  if (!api.printContent) {
    showToast('error', 'Impression native indisponible')
    return false
  }
  const trimmed = innerHtml.trim()
  if (!trimmed) {
    showToast('error', 'Rien à imprimer (contenu vide)')
    return false
  }
  const pageSize = options.pageSize ?? 'A4'
  const settingsKey = options.settingsKey ?? (pageSize === 'A4' ? 'impression_printer_a4' : 'impression_printer_ticket')
  const printerName = await resolvePrinter(settingsKey)
  const html = wrapPrintHtml(trimmed, pageSize)
  return runAction('Impression', async () => {
    const res = await api.printContent(html, printerName, {
      silent: options.silent ?? false,
      pageSize: pageSize === 'A4' ? 'A4' : pageSize,
      color: true,
      printBackground: true,
      copies: options.copies ?? 1,
    }) as { success?: boolean; error?: string }
    if (res && res.success === false) throw new Error(res.error ?? 'Impression échouée')
    if (printerName) await api.settingsSet(settingsKey, printerName)
  }, { successMessage: 'Document envoyé à l\'imprimante' }).then(Boolean)
}

/** Print a complete HTML document string (already has DOCTYPE). */
export async function printFullHtmlDocument(html: string, options: NativePrintOptions = {}): Promise<boolean> {
  if (!api.printContent) {
    showToast('error', 'Impression native indisponible')
    return false
  }
  const settingsKey = options.settingsKey ?? 'impression_printer_a4'
  const printerName = await resolvePrinter(settingsKey)
  return runAction('Impression', async () => {
    const res = await api.printContent(html, printerName, {
      silent: options.silent ?? false,
      pageSize: options.pageSize ?? 'A4',
      color: true,
      printBackground: true,
      copies: options.copies ?? 1,
    }) as { success?: boolean; error?: string }
    if (res && res.success === false) throw new Error(res.error ?? 'Impression échouée')
  }, { successMessage: 'Document envoyé à l\'imprimante' }).then(Boolean)
}

/** Legacy alias — replaces api.printLabel(html). */
export async function printLabelHtml(html: string, pageSize: NativePrintPageSize = 'A4'): Promise<boolean> {
  if (html.includes('<!DOCTYPE') || html.includes('<html')) {
    return printFullHtmlDocument(html, { pageSize })
  }
  return printHtmlNow(html, { pageSize })
}

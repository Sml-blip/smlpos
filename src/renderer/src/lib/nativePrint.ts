import { wrapPrintHtml } from './printHtml'
import { openPrintManager } from './printManager'
import { showToast } from './toast'
import type { NativePageSize } from '../components/PrintManagerModal'

export type NativePrintPageSize = 'A4' | '58mm' | '80mm' | '40x20mm' | 'label'
export type NativePrintSettingsKey = 'impression_printer_a4' | 'impression_printer_ticket'

export interface NativePrintOptions {
  pageSize?: NativePrintPageSize
  settingsKey?: NativePrintSettingsKey
  copies?: number
  silent?: boolean
}

function toNativePageSize(pageSize: NativePrintPageSize): NativePageSize {
  if (pageSize === 'label') return '40x20mm'
  return pageSize
}

function defaultSettingsKey(pageSize: NativePageSize): NativePrintSettingsKey {
  return pageSize === 'A4' ? 'impression_printer_a4' : 'impression_printer_ticket'
}

/** Open print manager with inner HTML (wrapped for A4/thermal). */
export async function printHtmlNow(innerHtml: string, options: NativePrintOptions = {}): Promise<boolean> {
  const trimmed = innerHtml.trim()
  if (!trimmed) {
    showToast('error', 'Rien à imprimer (contenu vide)')
    return false
  }
  const pageSize = toNativePageSize(options.pageSize ?? 'A4')
  const settingsKey = options.settingsKey ?? defaultSettingsKey(pageSize)
  const html = wrapPrintHtml(trimmed, pageSize)
  const ok = openPrintManager({ html, defaultPageSize: pageSize, settingsKey })
  if (!ok) showToast('error', 'Impression indisponible')
  return ok
}

/** Open print manager with a complete HTML document string. */
export async function printFullHtmlDocument(html: string, options: NativePrintOptions = {}): Promise<boolean> {
  const trimmed = html.trim()
  if (!trimmed) {
    showToast('error', 'Rien à imprimer (contenu vide)')
    return false
  }
  const pageSize = toNativePageSize(options.pageSize ?? 'A4')
  const settingsKey = options.settingsKey ?? defaultSettingsKey(pageSize)
  const ok = openPrintManager({ html: trimmed, defaultPageSize: pageSize, settingsKey })
  if (!ok) showToast('error', 'Impression indisponible')
  return ok
}

/** Legacy alias — opens print manager instead of direct IPC. */
export async function printLabelHtml(html: string, pageSize: NativePrintPageSize = 'A4'): Promise<boolean> {
  if (html.includes('<!DOCTYPE') || html.includes('<html')) {
    return printFullHtmlDocument(html, { pageSize })
  }
  return printHtmlNow(html, { pageSize })
}

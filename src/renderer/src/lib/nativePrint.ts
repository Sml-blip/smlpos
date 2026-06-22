import { wrapPrintHtml } from './printHtml'
import { openPrintManager, inferPrintKind, defaultSettingsKey, type PrintKind } from './printManager'
import { showToast } from './toast'
import type { NativePageSize } from '../components/PrintManagerModal'

export type NativePrintPageSize = 'A4' | '58mm' | '80mm' | '40x20mm' | 'label'
export type NativePrintSettingsKey = 'impression_printer_a4' | 'impression_printer_ticket' | 'impression_printer_label'

export interface NativePrintOptions {
  pageSize?: NativePrintPageSize
  settingsKey?: NativePrintSettingsKey
  printKind?: PrintKind
  copies?: number
  silent?: boolean
}

function toNativePageSize(pageSize: NativePrintPageSize): NativePageSize {
  if (pageSize === 'label') return '40x20mm'
  return pageSize
}

function inferKind(pageSize: NativePageSize, explicit?: PrintKind): PrintKind {
  if (explicit) return explicit
  return inferPrintKind({ defaultPageSize: pageSize })
}

/** Open print manager with inner HTML (wrapped for A4/thermal). */
export async function printHtmlNow(innerHtml: string, options: NativePrintOptions = {}): Promise<boolean> {
  const trimmed = innerHtml.trim()
  if (!trimmed) {
    showToast('error', 'Rien à imprimer (contenu vide)')
    return false
  }
  const pageSize = toNativePageSize(options.pageSize ?? 'A4')
  const kind = inferKind(pageSize, options.printKind)
  const settingsKey = options.settingsKey ?? defaultSettingsKey(kind)
  const html = kind === 'document' ? wrapPrintHtml(trimmed, pageSize) : trimmed
  const ok = openPrintManager({ html, printKind: kind, defaultPageSize: pageSize, settingsKey })
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
  const kind = inferKind(pageSize, options.printKind ?? (pageSize === '58mm' || pageSize === '80mm' ? 'ticket' : undefined))
  const settingsKey = options.settingsKey ?? defaultSettingsKey(kind)
  const ok = openPrintManager({ html: trimmed, printKind: kind, defaultPageSize: pageSize, settingsKey })
  if (!ok) showToast('error', 'Impression indisponible')
  return ok
}

/** Legacy alias — opens print manager instead of direct IPC. */
export async function printLabelHtml(html: string, pageSize: NativePrintPageSize = 'A4'): Promise<boolean> {
  if (html.includes('<!DOCTYPE') || html.includes('<html')) {
    const kind = pageSize === 'label' || pageSize === '40x20mm' ? 'label' : pageSize === 'A4' ? 'document' : 'ticket'
    return printFullHtmlDocument(html, { pageSize, printKind: kind })
  }
  return printHtmlNow(html, { pageSize })
}

import { useEffect, useRef, type ReactNode } from 'react'
import { usePrintManager } from './PrintManagerProvider'
import { openPrintManager } from '../lib/printManager'
import { wrapPrintHtml } from '../lib/printHtml'
import { showToast } from '../lib/toast'
import type { NativePageSize } from './PrintManagerModal'

export interface PrintDialogProps {
  title?: string
  subtitle?: string
  getPrintHtml?: () => string
  documentHtml?: string
  preview?: ReactNode
  pageSize?: NativePageSize
  settingsKey?: 'impression_printer_a4' | 'impression_printer_ticket'
  copies?: number
  onClose: () => void
  onPrinted?: () => void
}

/** Opens PrintManagerModal with HTML from preview or a pre-built document. */
export default function PrintDialog({
  getPrintHtml,
  documentHtml,
  preview,
  pageSize = 'A4',
  settingsKey = 'impression_printer_a4',
  onClose,
  onPrinted,
}: PrintDialogProps) {
  const openPrint = usePrintManager()
  const hiddenRef = useRef<HTMLDivElement>(null)
  const openedRef = useRef(false)

  useEffect(() => {
    if (openedRef.current) return

    let attempts = 0
    const tryOpen = () => {
      if (openedRef.current) return
      const html = documentHtml ?? getPrintHtml?.() ?? hiddenRef.current?.innerHTML ?? ''
      if (!html.trim() && preview && attempts < 8) {
        attempts += 1
        requestAnimationFrame(tryOpen)
        return
      }
      openedRef.current = true
      if (html.trim()) {
        openPrint({ html, defaultPageSize: pageSize, settingsKey })
        onPrinted?.()
      } else {
        showToast('error', 'Rien à imprimer (contenu vide)')
      }
      onClose()
    }

    requestAnimationFrame(tryOpen)
  }, [documentHtml, getPrintHtml, preview, pageSize, settingsKey, openPrint, onClose, onPrinted])

  if (documentHtml) return null

  return (
    <div className="fixed -left-[9999px] top-0 opacity-0 pointer-events-none" aria-hidden>
      <div ref={hiddenRef}>{preview}</div>
    </div>
  )
}

/** Test page for Settings → Impression */
export function printTestPage(_printerName: string, pageSize: 'A4' | '58mm' = 'A4'): boolean {
  const html = wrapPrintHtml(
    `<div style="padding:24px;font-family:Arial,sans-serif;text-align:center">
      <h2 style="margin:0 0 8px">SMLPOS — Test d'impression</h2>
      <p style="color:#666">${new Date().toLocaleString('fr-FR')}</p>
    </div>`,
    pageSize,
  )
  const ok = openPrintManager({
    html,
    defaultPageSize: pageSize,
    settingsKey: pageSize === 'A4' ? 'impression_printer_a4' : 'impression_printer_ticket',
  })
  if (!ok) showToast('error', 'Impression indisponible')
  return ok
}

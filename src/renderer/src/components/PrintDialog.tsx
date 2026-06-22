import { useEffect, useRef, type ReactNode } from 'react'
import { usePrintManager } from './PrintManagerProvider'
import { openPrintManager, type PrintKind } from '../lib/printManager'
import { wrapPrintHtml } from '../lib/printHtml'
import { buildSampleLabelHtml } from '../lib/barcodeLabel'
import { showToast } from '../lib/toast'
import type { NativePageSize } from './PrintManagerModal'

function printKindForPageSize(pageSize: NativePageSize): PrintKind {
  if (pageSize === '40x20mm') return 'label'
  if (pageSize === '58mm' || pageSize === '80mm') return 'ticket'
  return 'document'
}

export interface PrintDialogProps {
  title?: string
  subtitle?: string
  getPrintHtml?: () => string
  documentHtml?: string
  preview?: ReactNode
  pageSize?: NativePageSize
  settingsKey?: 'impression_printer_a4' | 'impression_printer_ticket' | 'impression_printer_label'
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
  const onCloseRef = useRef(onClose)
  const onPrintedRef = useRef(onPrinted)
  const getPrintHtmlRef = useRef(getPrintHtml)

  onCloseRef.current = onClose
  onPrintedRef.current = onPrinted
  getPrintHtmlRef.current = getPrintHtml

  useEffect(() => {
    if (openedRef.current) return

    let cancelled = false
    let attempts = 0

    const finish = (html: string) => {
      if (cancelled || openedRef.current) return
      openedRef.current = true
      if (html.trim()) {
        openPrint({
          html,
          defaultPageSize: pageSize,
          settingsKey,
          printKind: printKindForPageSize(pageSize),
        })
        onPrintedRef.current?.()
      } else {
        showToast('error', 'Rien à imprimer (contenu vide)')
      }
      window.setTimeout(() => onCloseRef.current(), 0)
    }

    const tryOpen = () => {
      if (cancelled || openedRef.current) return
      const html = documentHtml ?? getPrintHtmlRef.current?.() ?? hiddenRef.current?.innerHTML ?? ''
      if (!html.trim() && preview && attempts < 12) {
        attempts += 1
        window.requestAnimationFrame(tryOpen)
        return
      }
      finish(html)
    }

    if (documentHtml?.trim()) {
      finish(documentHtml)
      return () => { cancelled = true }
    }

    window.requestAnimationFrame(tryOpen)
    return () => { cancelled = true }
  }, [documentHtml, pageSize, settingsKey, openPrint, preview])

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
    printKind: pageSize === 'A4' ? 'document' : 'ticket',
    settingsKey: pageSize === 'A4' ? 'impression_printer_a4' : 'impression_printer_ticket',
  })
  if (!ok) showToast('error', 'Impression indisponible')
  return ok
}

/** Test label for Settings → Impression */
export function printLabelTestPage(): boolean {
  const ok = openPrintManager({
    html: buildSampleLabelHtml(),
    printKind: 'label',
    settingsKey: 'impression_printer_label',
    defaultPageSize: '40x20mm',
    labelSource: { code: '1234567890123', nom: 'Produit test', prix: 12.5, productRef: 'REF-TEST' },
  })
  if (!ok) showToast('error', 'Impression indisponible')
  return ok
}

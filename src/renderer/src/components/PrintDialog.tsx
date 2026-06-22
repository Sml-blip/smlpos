import { useState, useEffect, useRef, ReactNode } from 'react'
import { X, Printer, RefreshCw } from 'lucide-react'
import { cn } from '../lib/utils'
import { runAction } from '../lib/apiCall'
import { wrapPrintHtml, type PrinterInfo } from '../lib/printHtml'
import { showToast } from '../lib/toast'

const api = window.api

export interface PrintDialogProps {
  title: string
  subtitle?: string
  /** Inner HTML to print (from preview ref) */
  getPrintHtml?: () => string
  /** Complete HTML document (barcode labels) — bypasses wrapPrintHtml */
  documentHtml?: string
  /** Optional live preview (A4/invoice) */
  preview?: ReactNode
  pageSize?: 'A4' | '58mm' | '80mm' | '40x20mm'
  settingsKey?: 'impression_printer_a4' | 'impression_printer_ticket'
  copies?: number
  onClose: () => void
  onPrinted?: () => void
}

export default function PrintDialog({
  title,
  subtitle,
  getPrintHtml,
  documentHtml,
  preview,
  pageSize = 'A4',
  settingsKey = 'impression_printer_a4',
  copies = 1,
  onClose,
  onPrinted,
}: PrintDialogProps) {
  const [printers, setPrinters] = useState<PrinterInfo[]>([])
  const [printerName, setPrinterName] = useState('')
  const [loadingPrinters, setLoadingPrinters] = useState(true)
  const [printing, setPrinting] = useState(false)
  const previewWrapRef = useRef<HTMLDivElement>(null)
  const printSourceRef = useRef<HTMLDivElement>(null)
  const [previewScale, setPreviewScale] = useState(0.72)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoadingPrinters(true)
      try {
        const list = (await api.getPrinters?.()) as PrinterInfo[] | undefined
        if (cancelled) return
        setPrinters(list ?? [])
        const settings = (await api.settingsGetAll()) as Record<string, string>
        const saved = settings[settingsKey] ?? ''
        const def = list?.find(p => p.isDefault)?.name ?? ''
        setPrinterName(saved || def || '')
      } catch {
        if (!cancelled) setPrinters([])
      } finally {
        if (!cancelled) setLoadingPrinters(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [settingsKey])

  useEffect(() => {
    const el = previewWrapRef.current
    if (!el || documentHtml) return
    const ro = new ResizeObserver(() => {
      const h = el.scrollHeight
      if (h > 0) setPreviewScale(Math.min(1, 700 / h))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [preview, documentHtml])

  const handlePrint = async () => {
    if (documentHtml) {
      const ok = await runAction('Impression', async () => {
        const res = await api.printContent(documentHtml, printerName, {
          silent: false,
          pageSize: pageSize ?? '40x20mm',
          color: true,
          printBackground: true,
          copies,
        }) as { success?: boolean; error?: string }
        if (res && res.success === false) throw new Error(res.error ?? 'Impression échouée')
        if (printerName) await api.settingsSet(settingsKey, printerName)
        onPrinted?.()
      }, { setLoading: setPrinting, successMessage: 'Étiquette envoyée à l\'imprimante' })
      if (ok) onClose()
      return
    }

    const inner = (printSourceRef.current?.innerHTML || getPrintHtml?.() || '').trim()
    if (!inner) {
      showToast('error', 'Contenu d\'impression vide — réessayez')
      return
    }
    const html = wrapPrintHtml(inner, pageSize)
    const ok = await runAction('Impression', async () => {
      const res = await api.printContent(html, printerName, {
        silent: false,
        pageSize: pageSize === 'A4' ? 'A4' : pageSize,
        color: true,
        printBackground: true,
        copies,
      }) as { success?: boolean; error?: string }
      if (res && res.success === false) throw new Error(res.error ?? 'Impression échouée')
      if (printerName) await api.settingsSet(settingsKey, printerName)
      onPrinted?.()
    }, { setLoading: setPrinting, successMessage: 'Document envoyé à l\'imprimante' })
    if (ok) onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[140] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col animate-slide-in">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <Printer size={16} className="text-accent-500" />
            <div>
              <h2 className="font-bold text-sm">{title}</h2>
              {subtitle && <p className="text-xs text-text-muted">{subtitle}</p>}
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary p-1 rounded-lg hover:bg-muted">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4 bg-gray-50 min-h-0 flex flex-col items-center justify-start">
          {documentHtml && (
            <div className="py-6 flex flex-col items-center gap-3">
              <p className="text-xs text-text-muted">Aperçu étiquette 40 × 20 mm</p>
              <div
                className="rounded-lg border-2 border-dashed border-border bg-white p-3 shadow-sm"
                style={{ width: 220, height: 130 }}
              >
                <iframe
                  title="Aperçu étiquette"
                  srcDoc={documentHtml}
                  className="border-0 bg-white"
                  style={{
                    width: 151,
                    height: 76,
                    transform: 'scale(1.35)',
                    transformOrigin: 'top left',
                  }}
                />
              </div>
            </div>
          )}
          {preview && !documentHtml && (
            <div
              ref={previewWrapRef}
              className="mx-auto origin-top"
              style={{ transform: `scale(${previewScale})`, transformOrigin: 'top center' }}
            >
              <div ref={printSourceRef}>{preview}</div>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-border flex flex-wrap items-end gap-3 flex-shrink-0">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-semibold text-text-secondary mb-1">Imprimante</label>
            <div className="flex gap-2">
              <select
                value={printerName}
                onChange={e => setPrinterName(e.target.value)}
                disabled={loadingPrinters}
                className="flex-1 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-accent-500 bg-white"
              >
                <option value="">Imprimante par défaut (Windows)</option>
                {printers.map(p => (
                  <option key={p.name} value={p.name}>
                    {p.name}{p.isDefault ? ' (défaut)' : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={async () => {
                  setLoadingPrinters(true)
                  const list = (await api.getPrinters?.()) as PrinterInfo[] | undefined
                  setPrinters(list ?? [])
                  setLoadingPrinters(false)
                }}
                className="p-2 border border-border rounded-xl hover:bg-muted"
                title="Actualiser"
              >
                <RefreshCw size={14} className={loadingPrinters ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>
          <button type="button" onClick={onClose} className="px-4 py-2.5 bg-muted hover:bg-border rounded-xl text-sm font-semibold">
            Annuler
          </button>
          <button
            type="button"
            onClick={handlePrint}
            disabled={printing}
            className={cn(
              'flex items-center gap-2 px-5 py-2.5 bg-accent-500 hover:bg-accent-600 disabled:bg-gray-200 rounded-xl text-sm font-bold',
            )}
          >
            <Printer size={14} />
            {printing ? 'Impression...' : 'Imprimer'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** One-line test page for Settings → Impression */
export async function printTestPage(printerName: string, pageSize: 'A4' | '58mm' = 'A4'): Promise<boolean> {
  const html = wrapPrintHtml(
    `<div style="padding:24px;font-family:Arial,sans-serif;text-align:center">
      <h2 style="margin:0 0 8px">SMLPOS — Test d'impression</h2>
      <p style="color:#666">${new Date().toLocaleString('fr-FR')}</p>
    </div>`,
    pageSize,
  )
  return runAction('Test impression', async () => {
    const res = await api.printContent(html, printerName, { silent: false, pageSize, color: true, printBackground: true }) as { success?: boolean; error?: string }
    if (res && res.success === false) throw new Error(res.error ?? 'Échec')
  }, { successMessage: 'Page test envoyée' }).then(Boolean)
}

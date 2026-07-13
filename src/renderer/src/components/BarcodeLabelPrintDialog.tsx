import { useEffect, useState } from 'react'
import { showToast } from '../lib/toast'
import { Printer, X, AlertCircle } from 'lucide-react'
import { buildBarcodeLabelHtml } from '../lib/barcodeLabel'
import { loadLabelPrintConfig, mergeLabelConfig } from '../lib/labelSettings'
import type { LabelPrintConfig } from '../lib/printManager'

interface Props {
  code: string
  nom: string
  prix: number
  productRef?: string
  onClose: () => void
}

export default function BarcodeLabelPrintDialog({
  code,
  nom,
  prix,
  productRef = '',
  onClose,
}: Props) {
  const [preview, setPreview] = useState('')
  const [copies, setCopies] = useState(1)
  const [printing, setPrinting] = useState(false)
  const [error, setError] = useState('')
  const [printers, setPrinters] = useState<string[]>([])
  const [selectedPrinter, setSelectedPrinter] = useState('')
  const [labelCfg, setLabelCfg] = useState<LabelPrintConfig>(() => mergeLabelConfig())

  useEffect(() => {
    let cancelled = false

    async function load() {
      setError('')
      try {
        const [cfg, printerList, settings] = await Promise.all([
          loadLabelPrintConfig(),
          window.api.getPrinters?.() ?? Promise.resolve([]),
          window.api.settingsGetAll?.() ?? Promise.resolve({} as Record<string, string>),
        ])
        if (cancelled) return

        const merged = mergeLabelConfig(cfg)
        const names = printerList.map((p) => p.name).filter(Boolean)
        const savedPrinter = String((settings as Record<string, string>).impression_printer_label ?? '')

        setLabelCfg(merged)
        setCopies(merged.defaultCopies || 1)
        setPrinters(names)
        setSelectedPrinter(savedPrinter && names.includes(savedPrinter) ? savedPrinter : names[0] ?? '')
        setPreview(buildBarcodeLabelHtml(code, nom, prix, productRef, merged, 1))
      } catch (e) {
        if (!cancelled) {
          setPreview(buildBarcodeLabelHtml(code, nom, prix, productRef, labelCfg, 1))
          setError(e instanceof Error ? e.message : String(e))
        }
      }
    }

    void load()
    return () => { cancelled = true }
    // labelCfg is only a fallback for the catch path; reloading on every cfg set would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, nom, prix, productRef])

  const handlePrint = async () => {
    if (!selectedPrinter) {
      setError('Selectionnez une imprimante')
      return
    }

    setPrinting(true)
    setError('')
    try {
      if (!window.api.printTsplLabel) {
        throw new Error('IPC printTsplLabel non disponible')
      }
      try {
        await window.api.settingsSet?.('impression_printer_label', selectedPrinter)
      } catch {
        // non-fatal
      }

      const result = await window.api.printTsplLabel({
        codeBarre: code.trim() || productRef,
        nomProduit: nom.trim() || productRef || 'Produit',
        prix: `${Number(prix).toFixed(3)} DT`,
        copies,
        printerName: selectedPrinter,
        widthMm: labelCfg.widthMm,
        heightMm: labelCfg.heightMm,
        stripLeftMm: labelCfg.stripLeftMm,
        stripRightMm: labelCfg.stripRightMm,
        stripTopMm: labelCfg.stripTopMm,
        stripBottomMm: labelCfg.stripBottomMm,
        rotationDeg: labelCfg.rotationDeg,
        layout: labelCfg.layout,
      })

      if (result.success) {
        showToast('success', `${copies} etiquette(s) imprimee(s)`)
        onClose()
      } else {
        setError(result.error ?? 'Erreur inconnue')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPrinting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/55 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-[440px] p-6 animate-slide-in relative flex flex-col">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-text-secondary hover:text-text-primary hover:bg-muted rounded-lg transition-colors"
          disabled={printing}
        >
          <X size={18} />
        </button>

        <div className="flex items-center gap-2.5 mb-4">
          <div className="p-2 bg-accent-50 text-accent-500 rounded-xl">
            <Printer size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-text-primary">Imprimer etiquette</h2>
            <p className="text-xs text-text-secondary">Clean 40 x 20 mm preview - TSPL raw</p>
          </div>
        </div>

        <div className="flex flex-col items-center gap-3 my-4 bg-gradient-to-br from-slate-50 to-white border border-border/70 rounded-2xl p-5">
          <div className="w-full flex items-center justify-between text-[11px] text-text-secondary">
            <span className="font-semibold">Label preview</span>
            <span className="font-mono bg-white border border-border rounded-md px-2 py-0.5">40 x 20 mm</span>
          </div>
          {preview ? (
            <div
              className="border border-slate-300 bg-white overflow-hidden shadow-md ring-4 ring-white"
              style={{ width: 320, height: 160 }}
            >
              <iframe
                title="Label preview"
                srcDoc={preview}
                style={{
                  width: 151.2,
                  height: 75.6,
                  border: 'none',
                  display: 'block',
                  transform: 'scale(2.116)',
                  transformOrigin: 'top left',
                  pointerEvents: 'none',
                }}
              />
            </div>
          ) : (
            <div className="w-[320px] h-[160px] bg-gray-200 rounded-lg animate-pulse" />
          )}
        </div>

        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-xs font-semibold text-text-primary mb-1.5">Imprimante</label>
            <select
              value={selectedPrinter}
              onChange={(e) => setSelectedPrinter(e.target.value)}
              className="w-full bg-muted rounded-xl px-4 py-2.5 border border-border focus:border-accent-500 focus:bg-accent-50 transition-all font-semibold outline-none"
              disabled={printing}
            >
              {printers.length === 0 && <option value="">Aucune imprimante detectee</option>}
              {printers.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-primary mb-1.5">Nombre d'exemplaires</label>
            <input
              type="number"
              min={1}
              max={200}
              value={copies}
              onChange={(e) => setCopies(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full bg-muted rounded-xl px-4 py-2.5 border border-border focus:border-accent-500 focus:bg-accent-50 transition-all font-semibold outline-none"
              disabled={printing}
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 animate-fade-in">
              <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
              <div className="font-medium break-all">{error}</div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-3 text-sm font-semibold border-2 border-border hover:bg-muted text-text-primary rounded-xl transition-all"
            disabled={printing}
          >
            Annuler
          </button>
          <button
            onClick={handlePrint}
            disabled={printing || !selectedPrinter}
            className="flex-1 py-3 bg-accent-500 hover:bg-accent-600 disabled:bg-gray-100 disabled:text-gray-400 disabled:border-transparent text-text-primary font-bold rounded-xl transition-all flex items-center justify-center gap-1.5"
          >
            {printing ? (
              <>
                <svg className="animate-spin h-4 w-4 text-text-primary" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>Impression...</span>
              </>
            ) : (
              <>
                <Printer size={16} />
                <span>Imprimer {copies > 1 ? `(${copies})` : ''}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

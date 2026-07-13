import { useEffect, useState } from 'react'
import {
  AlertCircle,
  Gauge,
  Minus,
  Plus,
  Printer,
  RotateCcw,
  Settings2,
  X,
} from 'lucide-react'
import { loadLabelPrintConfig, mergeLabelConfig, saveLabelPrintConfig } from '../lib/labelSettings'
import { renderBarcodeLabelRaster, type RenderedBarcodeLabel } from '../lib/labelRaster'
import { DEFAULT_LABEL_CONFIG, type LabelPrintConfig } from '../lib/printManager'
import { showToast } from '../lib/toast'

interface Props {
  code: string
  nom: string
  prix: number
  productRef?: string
  onClose: () => void
}

interface MmStepperProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  disabled?: boolean
  onChange: (value: number) => void
}

function MmStepper({ label, value, min, max, step, disabled, onChange }: MmStepperProps) {
  const commit = (next: number) => {
    const clamped = Math.min(max, Math.max(min, next))
    onChange(Math.round(clamped * 100) / 100)
  }

  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold text-slate-700">{label}</label>
      <div className="grid h-10 grid-cols-[40px_1fr_40px] overflow-hidden rounded-lg border border-slate-200 bg-white">
        <button
          type="button"
          title={`Reduire ${label.toLowerCase()}`}
          aria-label={`Reduire ${label.toLowerCase()}`}
          onClick={() => commit(value - step)}
          disabled={disabled || value <= min}
          className="flex items-center justify-center border-r border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-35"
        >
          <Minus size={15} />
        </button>
        <div className="flex items-center justify-center gap-1 font-mono text-xs font-semibold text-slate-800">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(event) => commit(Number(event.target.value) || 0)}
            disabled={disabled}
            className="w-12 bg-transparent text-center outline-none"
          />
          <span className="text-[10px] font-medium text-slate-400">mm</span>
        </div>
        <button
          type="button"
          title={`Augmenter ${label.toLowerCase()}`}
          aria-label={`Augmenter ${label.toLowerCase()}`}
          onClick={() => commit(value + step)}
          disabled={disabled || value >= max}
          className="flex items-center justify-center border-l border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-35"
        >
          <Plus size={15} />
        </button>
      </div>
    </div>
  )
}

export default function BarcodeLabelPrintDialog({
  code,
  nom,
  prix,
  productRef = '',
  onClose,
}: Props) {
  const [preview, setPreview] = useState<RenderedBarcodeLabel | null>(null)
  const [copies, setCopies] = useState(1)
  const [printing, setPrinting] = useState(false)
  const [configReady, setConfigReady] = useState(false)
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
        const names = printerList.map((printer) => printer.name).filter(Boolean)
        const savedPrinter = String((settings as Record<string, string>).impression_printer_label ?? '')
        const defaultPrinter = printerList.find((printer) => printer.isDefault)?.name

        setLabelCfg(merged)
        setCopies(merged.defaultCopies || 1)
        setPrinters(names)
        setSelectedPrinter(savedPrinter && names.includes(savedPrinter) ? savedPrinter : defaultPrinter ?? names[0] ?? '')
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError))
      } finally {
        if (!cancelled) setConfigReady(true)
      }
    }

    void load()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!configReady) return
    try {
      setPreview(renderBarcodeLabelRaster({ code, nom, prix, productRef }, labelCfg))
      setError('')
    } catch (renderError) {
      setPreview(null)
      setError(renderError instanceof Error ? renderError.message : String(renderError))
    }
  }, [code, configReady, labelCfg, nom, prix, productRef])

  useEffect(() => {
    if (!configReady) return
    const timer = window.setTimeout(() => {
      void saveLabelPrintConfig(labelCfg).catch(() => undefined)
    }, 450)
    return () => window.clearTimeout(timer)
  }, [configReady, labelCfg])

  const patchConfig = (patch: Partial<LabelPrintConfig>) => {
    setLabelCfg((current) => mergeLabelConfig({ ...current, ...patch }))
  }

  const resetPrinterSettings = () => {
    patchConfig({
      dpi: DEFAULT_LABEL_CONFIG.dpi,
      density: DEFAULT_LABEL_CONFIG.density,
      speed: DEFAULT_LABEL_CONFIG.speed,
      gapMm: DEFAULT_LABEL_CONFIG.gapMm,
      offsetXmm: DEFAULT_LABEL_CONFIG.offsetXmm,
      offsetYmm: DEFAULT_LABEL_CONFIG.offsetYmm,
      rotationDeg: DEFAULT_LABEL_CONFIG.rotationDeg,
    })
  }

  const handlePrint = async () => {
    if (!selectedPrinter) {
      setError('Selectionnez une imprimante')
      return
    }

    setPrinting(true)
    setError('')
    try {
      if (!window.api.printTsplLabel) throw new Error('Impression TSPL indisponible')
      const raster = renderBarcodeLabelRaster({ code, nom, prix, productRef }, labelCfg)
      try {
        await Promise.all([
          window.api.settingsSet?.('impression_printer_label', selectedPrinter),
          saveLabelPrintConfig({ ...labelCfg, defaultCopies: copies }),
        ])
      } catch {
        // Saving preferences must never prevent the current label from printing.
      }

      const result = await window.api.printTsplLabel({
        codeBarre: raster.barcodeValue,
        nomProduit: nom.trim() || productRef || 'Produit',
        prix: `${Number(prix).toFixed(3)} DT`,
        copies,
        printerName: selectedPrinter,
        widthMm: labelCfg.widthMm,
        heightMm: labelCfg.heightMm,
        dpi: labelCfg.dpi,
        density: labelCfg.density,
        speed: labelCfg.speed,
        gapMm: labelCfg.gapMm,
        bitmapBase64: raster.bitmapBase64,
        bitmapWidthDots: raster.widthDots,
        bitmapHeightDots: raster.heightDots,
        bitmapWidthBytes: raster.widthBytes,
      })

      if (result.success) {
        showToast('success', `${copies} etiquette(s) imprimee(s)`)
        onClose()
      } else {
        setError(result.error ?? 'Erreur inconnue')
      }
    } catch (printError) {
      setError(printError instanceof Error ? printError.message : String(printError))
    } finally {
      setPrinting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/55 p-4 backdrop-blur-sm animate-fade-in">
      <div className="relative grid w-full max-w-[940px] overflow-hidden rounded-2xl border border-white/70 bg-white shadow-2xl animate-slide-in lg:grid-cols-[minmax(0,1fr)_340px]">
        <button
          type="button"
          title="Fermer"
          aria-label="Fermer"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
          disabled={printing}
        >
          <X size={18} />
        </button>

        <section className="flex min-w-0 flex-col p-6">
          <div className="mb-5 flex items-center gap-3 pr-10">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <Printer size={20} />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-slate-900">Imprimer l'etiquette</h2>
              <p className="text-xs text-slate-500">Apercu exact des points envoyes a l'imprimante</p>
            </div>
          </div>

          <div className="mb-5 flex flex-col items-center gap-3 border-y border-slate-100 bg-slate-50/70 px-4 py-5">
            <div className="flex w-full max-w-[320px] items-center justify-between text-[11px] text-slate-500">
              <span className="font-semibold">Apercu impression</span>
              <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 font-mono">
                {labelCfg.widthMm} x {labelCfg.heightMm} mm
              </span>
            </div>
            {preview ? (
              <div className="h-[160px] w-[320px] max-w-full overflow-hidden border border-slate-300 bg-white shadow-sm">
                <img
                  src={preview.dataUrl}
                  alt="Apercu exact de l'etiquette"
                  className="h-full w-full"
                  style={{ imageRendering: 'pixelated' }}
                />
              </div>
            ) : (
              <div className="h-[160px] w-[320px] max-w-full animate-pulse bg-slate-200" />
            )}
            <div className="flex w-full max-w-[320px] items-center justify-between text-[10px] text-slate-400">
              <span>{labelCfg.dpi} dpi</span>
              <span>{preview ? `${preview.barcodeFormat} - module ${preview.moduleDots} dot` : 'Preparation...'}</span>
            </div>
          </div>

          <div className="mb-5 grid gap-4 sm:grid-cols-[1fr_150px]">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">Imprimante</label>
              <select
                value={selectedPrinter}
                onChange={(event) => setSelectedPrinter(event.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-amber-400 focus:bg-white"
                disabled={printing}
              >
                {printers.length === 0 && <option value="">Aucune imprimante detectee</option>}
                {printers.map((printer) => <option key={printer} value={printer}>{printer}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">Exemplaires</label>
              <input
                type="number"
                min={1}
                max={99}
                value={copies}
                onChange={(event) => setCopies(Math.min(99, Math.max(1, parseInt(event.target.value, 10) || 1)))}
                className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-center text-sm font-semibold text-slate-800 outline-none transition focus:border-amber-400 focus:bg-white"
                disabled={printing}
              />
            </div>
          </div>

          {error && (
            <div className="mb-5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 animate-fade-in">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <div className="break-all font-medium">{error}</div>
            </div>
          )}

          <div className="mt-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              disabled={printing}
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handlePrint}
              disabled={printing || !selectedPrinter || !preview}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-amber-400 py-3 text-sm font-bold text-slate-950 transition hover:bg-amber-500 disabled:bg-slate-100 disabled:text-slate-400"
            >
              {printing ? (
                <span>Impression...</span>
              ) : (
                <><Printer size={16} /><span>Imprimer{copies > 1 ? ` (${copies})` : ''}</span></>
              )}
            </button>
          </div>
        </section>

        <aside className="border-t border-slate-200 bg-slate-50/90 p-6 lg:border-l lg:border-t-0">
          <div className="mb-5 flex items-center justify-between pr-10">
            <div className="flex items-center gap-2">
              <Settings2 size={17} className="text-slate-500" />
              <h3 className="text-sm font-bold text-slate-900">Reglages imprimante</h3>
            </div>
            <button
              type="button"
              title="Reinitialiser les reglages"
              aria-label="Reinitialiser les reglages"
              onClick={resetPrinterSettings}
              disabled={printing}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-white hover:text-slate-900 disabled:opacity-40"
            >
              <RotateCcw size={15} />
            </button>
          </div>

          <div className="space-y-5">
            <div>
              <label className="mb-2 block text-xs font-semibold text-slate-700">Resolution</label>
              <div className="grid grid-cols-2 rounded-lg border border-slate-200 bg-white p-1">
                {[203, 300].map((dpi) => (
                  <button
                    key={dpi}
                    type="button"
                    onClick={() => patchConfig({ dpi })}
                    disabled={printing}
                    className={`h-8 rounded-md text-xs font-semibold transition ${labelCfg.dpi === dpi ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                  >
                    {dpi} dpi
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                  <Gauge size={13} /> Densite
                </label>
                <span className="font-mono text-xs font-bold text-slate-800">{labelCfg.density}/15</span>
              </div>
              <input
                type="range"
                min={1}
                max={15}
                step={1}
                value={labelCfg.density}
                onChange={(event) => patchConfig({ density: Number(event.target.value) })}
                disabled={printing}
                className="h-2 w-full cursor-pointer accent-amber-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">Vitesse</label>
                <select
                  value={labelCfg.speed}
                  onChange={(event) => patchConfig({ speed: Number(event.target.value) })}
                  disabled={printing}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-800 outline-none"
                >
                  {[2, 3, 4, 5, 6, 7, 8].map((speed) => <option key={speed} value={speed}>{speed} ips</option>)}
                </select>
              </div>
              <MmStepper
                label="Ecart"
                value={labelCfg.gapMm}
                min={0}
                max={10}
                step={0.5}
                disabled={printing}
                onChange={(gapMm) => patchConfig({ gapMm })}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <MmStepper
                label="Horizontal"
                value={labelCfg.offsetXmm}
                min={-3}
                max={3}
                step={0.25}
                disabled={printing}
                onChange={(offsetXmm) => patchConfig({ offsetXmm })}
              />
              <MmStepper
                label="Vertical"
                value={labelCfg.offsetYmm}
                min={-3}
                max={3}
                step={0.25}
                disabled={printing}
                onChange={(offsetYmm) => patchConfig({ offsetYmm })}
              />
            </div>

            <div>
              <label className="mb-2 block text-xs font-semibold text-slate-700">Orientation</label>
              <div className="grid grid-cols-2 rounded-lg border border-slate-200 bg-white p-1">
                {([0, 180] as const).map((rotationDeg) => (
                  <button
                    key={rotationDeg}
                    type="button"
                    onClick={() => patchConfig({ rotationDeg })}
                    disabled={printing}
                    className={`h-8 rounded-md text-xs font-semibold transition ${labelCfg.rotationDeg === rotationDeg ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                  >
                    {rotationDeg} deg
                  </button>
                ))}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

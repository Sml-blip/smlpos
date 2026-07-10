import { useState, useEffect } from 'react'
import { renderLabel } from '../lib/labelRenderer'
import { showToast } from '../lib/toast'
import { Printer, X, AlertCircle } from 'lucide-react'
import type { LabelData } from '../../../main/printer/LabelTemplate'

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
  const [pngB64, setPngB64] = useState('')
  const [copies, setCopies] = useState(1)
  const [printing, setPrinting] = useState(false)
  const [error, setError] = useState('')

  const data: LabelData = {
    nom: nom.trim() || productRef || 'Produit',
    codeBarre: code.trim() || productRef,
    prix: prix,
  }

  // Render preview on open
  useEffect(() => {
    setError('')
    renderLabel(data)
      .then(({ dataURL, blob }) => {
        setPreview(dataURL)
        const reader = new FileReader()
        reader.onload = () => {
          const res = reader.result as string
          setPngB64(res.split(',')[1])
        }
        reader.readAsDataURL(blob)
      })
      .catch((e) => setError(String(e)))
  }, [code, nom, prix, productRef])

  const handlePrint = async () => {
    if (!pngB64) return
    setPrinting(true)
    setError('')
    try {
      if (!window.api.printerPrint) {
        throw new Error('IPC printerPrint non disponible')
      }
      const result = await window.api.printerPrint(pngB64, copies)
      if (result.success) {
        showToast('success', `✅ ${copies} étiquette(s) imprimée(s)`)
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-[420px] p-6 animate-slide-in relative flex flex-col">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-text-secondary hover:text-text-primary hover:bg-muted rounded-lg transition-colors"
          disabled={printing}
        >
          <X size={18} />
        </button>

        {/* Title */}
        <div className="flex items-center gap-2.5 mb-4">
          <div className="p-2 bg-accent-50 text-accent-500 rounded-xl">
            <Printer size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-text-primary">Imprimer Étiquette</h2>
            <p className="text-xs text-text-secondary">Aperçu pixel-exact (40 × 19.9 mm — 203 DPI)</p>
          </div>
        </div>

        {/* Canvas Preview Container */}
        <div className="flex flex-col items-center gap-2.5 my-4 bg-gray-50 border border-border/60 rounded-xl p-4">
          {preview ? (
            <img
              src={preview}
              alt="Label preview"
              className="border border-border/80 bg-white"
              style={{
                width: 320, // 320 dots at 203 DPI
                height: 159, // 159 dots at 203 DPI
                imageRendering: 'pixelated', // no blurring
              }}
            />
          ) : (
            <div className="w-[320px] h-[159px] bg-gray-200 rounded-lg animate-pulse" />
          )}
          <span className="text-[10px] text-text-secondary font-mono bg-white px-2 py-0.5 border border-border rounded">
            DPI: 203 | Size: 320x159 px
          </span>
        </div>

        {/* Controls */}
        <div className="space-y-4 mb-6">
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

        {/* Footer actions */}
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
            disabled={printing || !pngB64}
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

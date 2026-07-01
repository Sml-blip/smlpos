import { useMemo, useState } from 'react'
import { X, Upload, FileSpreadsheet, Loader2, AlertTriangle } from 'lucide-react'
import { cn, formatPrice } from '../lib/utils'
import {
  DEFAULT_IMPORT_SETTINGS,
  parseProductImportBuffer,
  type ProductImportSettings,
} from '../lib/parseProductImport'
import { invalidateProduitsCache } from '../lib/produitsCache'
import { showToast } from '../lib/toast'

const api = window.api
const BATCH_SIZE = 120

type ImportStats = { inserted: number; updated: number; skipped: number }

export default function ProductImportModal({
  fileName,
  buffer,
  onClose,
  onDone,
}: {
  fileName: string
  buffer: ArrayBuffer
  onClose: () => void
  onDone: () => void
}) {
  const [settings, setSettings] = useState<ProductImportSettings>(DEFAULT_IMPORT_SETTINGS)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [stats, setStats] = useState<ImportStats | null>(null)

  const parsed = useMemo(() => {
    try {
      return parseProductImportBuffer(buffer, settings)
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Fichier invalide', produits: [], preview: null }
    }
  }, [buffer, settings])

  const { produits, preview, error: parseError } = parsed as {
    produits: ReturnType<typeof parseProductImportBuffer>['produits']
    preview: ReturnType<typeof parseProductImportBuffer>['preview'] | null
    error?: string
  }

  const progressPct = useMemo(
    () => (produits.length > 0 ? Math.round((progress / produits.length) * 100) : 0),
    [progress, produits.length]
  )

  const handleImport = async () => {
    if (importing || !api.produitsBulkImport || produits.length === 0) return
    setImporting(true)
    setProgress(0)
    setStats(null)

    const totals: ImportStats = { inserted: 0, updated: 0, skipped: 0 }

    try {
      for (let i = 0; i < produits.length; i += BATCH_SIZE) {
        const batch = produits.slice(i, i + BATCH_SIZE)
        const res = await api.produitsBulkImport({
          produits: batch,
          options: {
            onDuplicate: settings.onDuplicate,
            matchBy: settings.matchBy,
          },
        }) as ImportStats & { success?: boolean }

        totals.inserted += res.inserted ?? 0
        totals.updated += res.updated ?? 0
        totals.skipped += res.skipped ?? 0
        setProgress(Math.min(i + batch.length, produits.length))
        setStats({ ...totals })
      }

      invalidateProduitsCache()
      showToast(
        'success',
        `Import terminé — ${totals.inserted} ajoutés, ${totals.updated} mis à jour, ${totals.skipped} ignorés`
      )
      onDone()
      onClose()
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Erreur import')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
      <div className="relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-border bg-accent-50 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-500">
              <FileSpreadsheet size={20} />
            </div>
            <div>
              <h2 className="text-base font-bold text-text-primary">Import produits</h2>
              <p className="text-xs text-text-secondary truncate max-w-[420px]">{fileName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={importing}
            className="rounded-lg p-2 text-text-muted hover:bg-white hover:text-text-primary disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {parseError && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              {parseError}
            </div>
          )}

          {preview && (
          <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Format" value={preview.format} />
            <Stat label="Feuille" value={preview.sheetName} />
            <Stat label="Lignes lues" value={String(preview.totalRows)} />
            <Stat label="Produits valides" value={String(preview.validRows)} highlight />
          </div>

          {preview.warnings.map((w) => (
            <div key={w} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              {w}
            </div>
          ))}

          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 className="mb-3 text-sm font-semibold text-text-primary">Paramètres d&apos;import</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs">
                <span className="mb-1 block font-medium text-text-secondary">Type par défaut</span>
                <select
                  value={settings.defaultType}
                  disabled={importing}
                  onChange={(e) => setSettings((s) => ({ ...s, defaultType: e.target.value as 'F' | 'NF' }))}
                  className="w-full rounded-lg border border-border px-2 py-2 text-sm"
                >
                  <option value="F">F (facturé)</option>
                  <option value="NF">NF (non facturé)</option>
                </select>
              </label>

              <label className="text-xs">
                <span className="mb-1 block font-medium text-text-secondary">TVA par défaut (%)</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  disabled={importing}
                  value={settings.defaultTvaPct}
                  onChange={(e) => setSettings((s) => ({ ...s, defaultTvaPct: parseFloat(e.target.value) || 0 }))}
                  className="w-full rounded-lg border border-border px-2 py-2 text-sm"
                />
              </label>

              <label className="text-xs">
                <span className="mb-1 block font-medium text-text-secondary">Stock minimum</span>
                <input
                  type="number"
                  min={0}
                  disabled={importing}
                  value={settings.stockMinimum}
                  onChange={(e) => setSettings((s) => ({ ...s, stockMinimum: parseInt(e.target.value, 10) || 0 }))}
                  className="w-full rounded-lg border border-border px-2 py-2 text-sm"
                />
              </label>

              <label className="text-xs">
                <span className="mb-1 block font-medium text-text-secondary">Doublons (même réf./code-barres)</span>
                <select
                  value={settings.onDuplicate}
                  disabled={importing}
                  onChange={(e) => setSettings((s) => ({ ...s, onDuplicate: e.target.value as 'update' | 'skip' }))}
                  className="w-full rounded-lg border border-border px-2 py-2 text-sm"
                >
                  <option value="update">Mettre à jour</option>
                  <option value="skip">Ignorer</option>
                </select>
              </label>

              <label className="text-xs sm:col-span-2">
                <span className="mb-1 block font-medium text-text-secondary">Correspondance doublons</span>
                <select
                  value={settings.matchBy}
                  disabled={importing}
                  onChange={(e) => setSettings((s) => ({ ...s, matchBy: e.target.value as 'reference' | 'code_barre' }))}
                  className="w-full rounded-lg border border-border px-2 py-2 text-sm"
                >
                  <option value="reference">Référence produit</option>
                  <option value="code_barre">Code-barres</option>
                </select>
              </label>
            </div>
          </div>

          <div className="rounded-xl border border-border overflow-hidden">
            <div className="border-b border-border bg-muted px-3 py-2 text-xs font-semibold text-text-secondary">
              Aperçu ({Math.min(preview.sampleRows.length, preview.validRows)} / {preview.validRows})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-surface text-text-secondary">
                  <tr>
                    <th className="px-3 py-2 text-left">Référence</th>
                    <th className="px-3 py-2 text-left">Désignation</th>
                    <th className="px-3 py-2 text-left">Code-barres</th>
                    <th className="px-3 py-2 text-left">Famille</th>
                    <th className="px-3 py-2 text-right">PVTTC</th>
                    <th className="px-3 py-2 text-right">Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sampleRows.map((row, i) => (
                    <tr key={`${row.reference}-${i}`} className="border-t border-border">
                      <td className="px-3 py-2 font-mono">{row.reference}</td>
                      <td className="px-3 py-2 max-w-[220px] truncate">{row.nom}</td>
                      <td className="px-3 py-2 font-mono">{row.code_barre || '—'}</td>
                      <td className="px-3 py-2">{row.categorie}</td>
                      <td className="px-3 py-2 text-right">{formatPrice(row.prix_vente)}</td>
                      <td className="px-3 py-2 text-right">{row.stock}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          </>
          )}
        </div>

        <div className="border-t border-border bg-white px-5 py-4">
          {importing && (
            <div className="mb-4 space-y-2">
              <div className="flex items-center justify-between text-xs text-text-secondary">
                <span className="flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" />
                  Import en cours… {progress} / {produits.length}
                </span>
                <span>{progressPct}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-accent-500 transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              {stats && (
                <div className="flex gap-4 text-[11px] text-text-muted">
                  <span>+{stats.inserted} ajoutés</span>
                  <span>{stats.updated} MAJ</span>
                  <span>{stats.skipped} ignorés</span>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={importing}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-secondary hover:bg-muted disabled:opacity-40"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={importing || produits.length === 0 || !!parseError}
              className={cn(
                'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition-colors',
                importing ? 'bg-muted text-text-muted' : 'bg-accent-500 text-text-primary hover:bg-accent-600'
              )}
            >
              {importing ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Import…
                </>
              ) : (
                <>
                  <Upload size={16} />
                  Importer {produits.length} produits
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div className="rounded-xl border border-border bg-white px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">{label}</div>
      <div className={cn('mt-1 text-sm font-bold truncate', highlight && 'text-success')}>{value}</div>
    </div>
  )
}

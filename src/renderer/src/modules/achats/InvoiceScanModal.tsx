import { useMemo, useState } from 'react'
import Fuse from 'fuse.js'
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  FileImage,
  FileSearch,
  Link2,
  Loader2,
  ScanLine,
  X,
} from 'lucide-react'
import type { Produit } from '../../lib/types'
import { cn, formatPrice } from '../../lib/utils'
import { showToast } from '../../lib/toast'
import type { FactureLigneState } from './factureAchatTypes'
import { emptyFactureLigne, newLineFromProduct } from './factureAchatTypes'
import {
  parseInvoiceLines,
  parseInvoiceMetadata,
  type ParsedInvoiceLine,
  type ParsedInvoiceMetadata,
} from './invoiceScanParser'

type ScanSource = {
  scanId: string
  name: string
  previewDataUrl: string
  kind: 'image' | 'pdf'
  pageCount: number
}

type ReviewLine = ParsedInvoiceLine & {
  mode: 'link' | 'free' | 'skip'
  productId: string
  suggestions: Produit[]
}

type Props = {
  produits: Produit[]
  onClose: () => void
  onImport: (lines: FactureLigneState[], metadata: ParsedInvoiceMetadata) => void
}

const api = window.api

export default function InvoiceScanModal({ produits, onClose, onImport }: Props) {
  const [source, setSource] = useState<ScanSource | null>(null)
  const [reviewLines, setReviewLines] = useState<ReviewLine[]>([])
  const [metadata, setMetadata] = useState<ParsedInvoiceMetadata>({})
  const [rawText, setRawText] = useState('')
  const [ocrConfidence, setOcrConfidence] = useState<number | null>(null)
  const [busy, setBusy] = useState<'scanner' | 'import' | 'ocr' | null>(null)

  const fuse = useMemo(() => new Fuse(produits, {
    keys: ['nom', 'reference', 'code_barre'],
    threshold: 0.48,
    minMatchCharLength: 2,
    ignoreLocation: true,
    includeScore: true,
  }), [produits])

  const findProductMatches = (line: Pick<ParsedInvoiceLine, 'referenceArticle' | 'designation'>) => {
    const normalizedReference = line.referenceArticle.trim().toLocaleLowerCase()
    const exact = normalizedReference
      ? produits.find(product =>
        product.reference?.trim().toLocaleLowerCase() === normalizedReference
        || product.code_barre?.trim().toLocaleLowerCase() === normalizedReference
      )
      : undefined
    const fuzzy = fuse.search(
      [line.referenceArticle, line.designation].filter(Boolean).join(' '),
      { limit: exact ? 3 : 4 },
    )
    const suggestions = [
      ...(exact ? [exact] : []),
      ...fuzzy.map(match => match.item).filter(product => product.id !== exact?.id),
    ].slice(0, 4)
    return { exact, suggestions, bestFuzzy: fuzzy[0] }
  }

  const acquire = async (kind: 'scanner' | 'import') => {
    const action = kind === 'scanner' ? api.invoiceScanAcquireWia : api.invoiceScanChooseImage
    if (!action) {
      showToast('Cette fonction nécessite l’application Windows.', 'error')
      return
    }
    setBusy(kind)
    try {
      const result = await action()
      if (result.canceled) return
      if (!result.success || !result.scanId || !result.previewDataUrl) {
        showToast(result.error || 'Impossible de récupérer la facture.', 'error')
        return
      }
      setSource({
        scanId: result.scanId,
        name: result.name || 'facture',
        previewDataUrl: result.previewDataUrl,
        kind: result.kind === 'pdf' ? 'pdf' : 'image',
        pageCount: Math.max(1, Number(result.pageCount) || 1),
      })
      setReviewLines([])
      setRawText('')
      setOcrConfidence(null)
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  const analyze = async () => {
    if (!source || !api.invoiceScanRecognize) return
    setBusy('ocr')
    try {
      const result = await api.invoiceScanRecognize(source.scanId)
      if (!result.success) {
        showToast(result.error || 'Analyse OCR impossible.', 'error')
        return
      }
      const text = result.text || ''
      const parsed = parseInvoiceLines(text)
      const prepared = parsed.map<ReviewLine>((line) => {
        const { exact, suggestions, bestFuzzy } = findProductMatches(line)
        const confidentlyMatched = !!exact || (!!bestFuzzy && (bestFuzzy.score ?? 1) <= 0.32)
        const selectedProduct = exact ?? bestFuzzy?.item
        return {
          ...line,
          suggestions,
          productId: confidentlyMatched && selectedProduct ? selectedProduct.id : '',
          mode: confidentlyMatched ? 'link' : line.confidence === 'low' ? 'skip' : 'free',
        }
      })
      setRawText(text)
      setMetadata(parseInvoiceMetadata(text))
      setOcrConfidence(Number(result.confidence) || 0)
      setReviewLines(prepared)
      if (!prepared.length) {
        showToast('Aucune ligne fiable détectée. Consultez le texte OCR et importez une image plus nette.', 'warning')
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  const updateLine = (id: string, patch: Partial<ReviewLine>) => {
    setReviewLines(lines => lines.map(line => line.id === id ? { ...line, ...patch } : line))
  }

  const confirmImport = () => {
    const accepted = reviewLines.filter(line => line.mode !== 'skip' && line.designation.trim() && line.quantite > 0)
    if (!accepted.length) {
      showToast('Sélectionnez au moins une ligne à importer.', 'warning')
      return
    }
    const lines = accepted.map<FactureLigneState>((line) => {
      const product = line.mode === 'link' ? produits.find(p => p.id === line.productId) : undefined
      if (product) {
        return {
          ...newLineFromProduct(product, line.quantite),
          nouveau_prix_achat: line.prixUnitaire,
        }
      }
      return {
        ...emptyFactureLigne(),
        designation: [line.referenceArticle.trim(), line.designation.trim()].filter(Boolean).join(' — '),
        quantite: line.quantite,
        nouveau_prix_achat: line.prixUnitaire,
      }
    })
    onImport(lines, metadata)
  }

  const acceptedCount = reviewLines.filter(line => line.mode !== 'skip').length

  return (
    <div className="fixed inset-0 z-[190] bg-black/60 p-3 flex items-center justify-center">
      <div className="w-full max-w-6xl h-[92vh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-slide-in">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="font-bold text-base flex items-center gap-2">
              <ScanLine size={18} className="text-accent-700" />
              Scanner une facture d’achat
            </h2>
            <p className="text-[11px] text-text-muted mt-0.5">
              L’analyse prépare un brouillon. Aucun stock ni prix produit n’est modifié avant l’enregistrement final.
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted text-text-muted" aria-label="Fermer">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[38%_62%]">
          <section className="p-4 border-b lg:border-b-0 lg:border-r border-border flex flex-col min-h-0 bg-muted/40">
            <div className="grid grid-cols-2 gap-2 mb-3">
              <button
                onClick={() => void acquire('scanner')}
                disabled={busy !== null}
                className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-accent-500 hover:bg-accent-600 disabled:opacity-50 font-bold text-xs"
              >
                {busy === 'scanner' ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />}
                Scanner HP / WIA
              </button>
              <button
                onClick={() => void acquire('import')}
                disabled={busy !== null}
                className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-white border border-border hover:bg-muted disabled:opacity-50 font-semibold text-xs"
              >
                {busy === 'import' ? <Loader2 size={15} className="animate-spin" /> : <FileImage size={15} />}
                Importer une image
              </button>
            </div>

            <div className="flex-1 min-h-[220px] rounded-xl border border-dashed border-border bg-white overflow-hidden flex items-center justify-center">
              {source
                ? source.previewDataUrl.startsWith('data:application/pdf')
                  ? <embed src={source.previewDataUrl} type="application/pdf" className="w-full h-full min-h-[420px]" />
                  : <img src={source.previewDataUrl} alt="Facture scannée" className="w-full h-full object-contain" />
                : (
                  <div className="text-center px-6 text-text-muted">
                    <FileSearch size={40} className="mx-auto mb-2 opacity-40" />
                    <p className="text-sm font-semibold">Scannez ou importez une facture</p>
                    <p className="text-[11px] mt-1">PDF, PNG, JPG, BMP ou TIFF</p>
                  </div>
                )}
            </div>

            {source && (
              <div className="mt-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-[11px] text-text-muted truncate" title={source.name}>
                    {source.name}{source.kind === 'pdf' ? ` · ${source.pageCount} page(s)` : ''}
                  </span>
                  {ocrConfidence !== null && (
                    <span className={cn(
                      'text-[10px] font-bold rounded-full px-2 py-0.5',
                      ocrConfidence >= 75 ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800',
                    )}>
                      OCR {Math.round(ocrConfidence)}%
                    </span>
                  )}
                </div>
                <button
                  onClick={() => void analyze()}
                  disabled={busy !== null}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-bold text-xs"
                >
                  {busy === 'ocr'
                    ? <><Loader2 size={15} className="animate-spin" /> Analyse locale en cours…</>
                    : <><FileSearch size={15} /> Analyser la facture</>}
                </button>
                {busy === 'ocr' && (
                  <p className="text-[10px] text-center text-text-muted mt-1.5">La première analyse peut prendre 10 à 30 secondes.</p>
                )}
              </div>
            )}
          </section>

          <section className="min-h-0 flex flex-col">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm">Lignes détectées</h3>
                <p className="text-[10px] text-text-muted">Vérifiez chaque quantité, prix et correspondance avant l’import.</p>
              </div>
              {reviewLines.length > 0 && (
                <span className="text-xs font-bold text-accent-800 bg-accent-100 rounded-full px-2.5 py-1">
                  {acceptedCount}/{reviewLines.length} retenue(s)
                </span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {!reviewLines.length && (
                <div className="h-full min-h-[220px] flex items-center justify-center text-center text-text-muted">
                  <div>
                    <ScanLine size={38} className="mx-auto mb-2 opacity-30" />
                    <p className="text-sm font-semibold">Les suggestions apparaîtront ici</p>
                    <p className="text-[11px] mt-1">Elles resteront éditables avant d’entrer dans la facture.</p>
                  </div>
                </div>
              )}

              {reviewLines.map((line, index) => (
                <div
                  key={line.id}
                  className={cn(
                    'rounded-xl border p-3 transition-colors',
                    line.mode === 'skip' ? 'border-border bg-muted opacity-60' : 'border-accent-200 bg-accent-50/30',
                  )}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-[10px] font-bold text-text-muted">LIGNE {index + 1}</span>
                    <span className={cn(
                      'text-[9px] font-bold rounded-full px-2 py-0.5',
                      line.confidence === 'high'
                        ? 'bg-green-100 text-green-800'
                        : line.confidence === 'medium'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-red-100 text-red-800',
                    )}>
                      Détection {line.confidence === 'high' ? 'forte' : line.confidence === 'medium' ? 'moyenne' : 'à vérifier'}
                    </span>
                  </div>

                  <div className="grid grid-cols-[8rem_1fr_4.5rem_7rem] gap-2">
                    <div>
                      <label className="block text-[9px] font-semibold text-text-muted mb-0.5">Réf. / code article</label>
                      <input
                        value={line.referenceArticle}
                        onChange={event => updateLine(line.id, { referenceArticle: event.target.value })}
                        className="w-full border border-border rounded-lg px-2 py-1.5 text-xs font-mono bg-white"
                        placeholder="ART-1024"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-semibold text-text-muted mb-0.5">Désignation</label>
                      <input
                        value={line.designation}
                        onChange={event => updateLine(line.id, { designation: event.target.value })}
                        className="w-full border border-border rounded-lg px-2 py-1.5 text-xs bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-semibold text-text-muted mb-0.5">Qté</label>
                      <input
                        type="number"
                        min={1}
                        value={line.quantite}
                        onChange={event => updateLine(line.id, { quantite: Math.max(1, Number(event.target.value) || 1) })}
                        className="w-full border border-border rounded-lg px-2 py-1.5 text-xs font-price bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-semibold text-text-muted mb-0.5">Prix achat HT</label>
                      <input
                        type="number"
                        min={0}
                        step="0.001"
                        value={line.prixUnitaire}
                        onChange={event => updateLine(line.id, { prixUnitaire: Math.max(0, Number(event.target.value) || 0) })}
                        className="w-full border border-border rounded-lg px-2 py-1.5 text-xs font-price bg-white"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-[1fr_auto] gap-2 mt-2 items-end">
                    <div>
                      <label className="block text-[9px] font-semibold text-text-muted mb-0.5">Traitement</label>
                      <select
                        value={line.mode === 'link' ? `product:${line.productId}` : line.mode}
                        onChange={event => {
                          const value = event.target.value
                          if (value.startsWith('product:')) {
                            updateLine(line.id, { mode: 'link', productId: value.slice(8) })
                          } else {
                            updateLine(line.id, { mode: value as 'free' | 'skip', productId: '' })
                          }
                        }}
                        className="w-full border border-border rounded-lg px-2 py-1.5 text-xs bg-white"
                      >
                        <option value="free">Ligne libre — ne crée pas de produit</option>
                        {line.suggestions.map(product => (
                          <option key={product.id} value={`product:${product.id}`}>
                            Lier à {product.nom} ({product.reference})
                          </option>
                        ))}
                        <option value="skip">Ignorer cette ligne</option>
                      </select>
                    </div>
                    <div className="text-right">
                      <span className="block text-[9px] text-text-muted">Total HT</span>
                      <span className="text-xs font-price font-bold">{formatPrice(line.quantite * line.prixUnitaire)}</span>
                    </div>
                  </div>

                  {line.mode === 'link' && (
                    <p className="mt-2 text-[10px] text-blue-700 flex items-center gap-1">
                      <Link2 size={10} /> Le prix scanné sera proposé dans cette facture ; le produit ne changera qu’à l’enregistrement final.
                    </p>
                  )}
                  <details className="mt-1.5">
                    <summary className="text-[9px] text-text-muted cursor-pointer">Voir la ligne OCR originale</summary>
                    <code className="block mt-1 text-[9px] bg-white border border-border rounded p-1.5 break-all">{line.sourceLine}</code>
                  </details>
                </div>
              ))}

              {rawText && (
                <details className="rounded-xl border border-border bg-muted p-3">
                  <summary className="text-xs font-semibold cursor-pointer">Texte OCR complet</summary>
                  <pre className="mt-2 text-[10px] whitespace-pre-wrap max-h-48 overflow-auto">{rawText}</pre>
                </details>
              )}
            </div>

            <div className="px-4 py-3 border-t border-border bg-white flex items-center gap-3">
              <div className="flex-1 text-[10px] text-text-muted flex items-start gap-1.5">
                <AlertTriangle size={12} className="text-amber-600 flex-shrink-0 mt-0.5" />
                L’OCR peut se tromper. La confirmation ajoute seulement les lignes au brouillon actuel.
              </div>
              <button onClick={onClose} className="px-4 py-2 rounded-xl border border-border bg-muted hover:bg-border text-xs font-semibold">
                Annuler
              </button>
              <button
                onClick={confirmImport}
                disabled={!acceptedCount}
                className="px-4 py-2 rounded-xl bg-accent-500 hover:bg-accent-600 disabled:bg-gray-200 disabled:text-gray-400 text-xs font-bold flex items-center gap-1.5"
              >
                <CheckCircle2 size={14} /> Importer {acceptedCount || ''} ligne(s)
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

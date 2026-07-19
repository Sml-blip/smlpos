import { useState, useEffect } from 'react'
import { useAppStore } from '../store/appStore'
import { formatPrice } from '../lib/utils'
import { runAction } from '../lib/apiCall'
import { showToast } from '../lib/toast'
import { X, DollarSign, ShoppingBag, Wrench, ArrowDownCircle, LogOut, AlertCircle, CheckCircle, CreditCard, FileText } from 'lucide-react'

const api = window.api

interface ShiftSummary {
  ventes: { total: number; count: number }
  reparations: { total: number; count: number }
  sorties: { total: number; count: number }
  parMode: Array<{ mode_paiement: string; total: number }>
  creditsPercus: { total: number; count: number }
}

const MODE_LABELS: Record<string, string> = {
  ESPECES: 'Espèces',
  CARTE: 'Carte',
  CHEQUE: 'Chèque',
  MIXTE: 'Mixte',
}

interface Props {
  onClose: () => void
  onInvoiceCreated?: (documentId: string) => void | Promise<void>
}

export default function FermetureCaisseModal({ onClose, onInvoiceCreated }: Props) {
  const { currentShift, setCurrentShift, setCurrentOperateur, setShowShiftModal } = useAppStore()
  const [summary, setSummary] = useState<ShiftSummary | null>(null)
  const [soldeCaisse, setSoldeCaisse] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingSummary, setLoadingSummary] = useState(true)
  const [confirmed, setConfirmed] = useState(false)
  const [closedShiftsToday, setClosedShiftsToday] = useState(0)

  useEffect(() => {
    if (!currentShift) return
    let cancelled = false
    const timeout = setTimeout(() => {
      if (!cancelled) setLoadingSummary(false)
    }, 8000)
    Promise.all([
      api.shiftsGetSummary(currentShift.id),
      api.shiftsCountClosedToday?.() ?? Promise.resolve(0),
    ])
      .then(([s, closedCount]) => {
        if (cancelled) return
        if (s) setSummary(s as ShiftSummary)
        setClosedShiftsToday(typeof closedCount === 'number' ? closedCount : 0)
      })
      .catch((e) => {
        console.error('[FermetureCaisse] load failed:', e)
      })
      .finally(() => {
        if (!cancelled) setLoadingSummary(false)
      })
    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [currentShift])

  if (!currentShift) return null

  const totalEncaisse = summary ? summary.ventes.total + summary.reparations.total + (summary.creditsPercus?.total ?? 0) : 0
  const soldeTheorique = currentShift.fond_de_caisse + totalEncaisse - (summary?.sorties.total ?? 0)
  const soldeReel = parseFloat(soldeCaisse.replace(',', '.')) || 0
  const ecart = soldeCaisse ? soldeReel - soldeTheorique : null

  const handleClose = async () => {
    if (!confirmed) { setConfirmed(true); return }
    let dailyInvoice: { documentId?: string; numero?: string; skipped?: boolean; reason?: string } | undefined
    const succeeded = await runAction('Fermeture de caisse', async () => {
      const now = new Date().toISOString()
      await api.shiftsClose(currentShift.id, {
        ended_at: now,
        solde_theorique: soldeTheorique,
        notes_cloture: notes || null,
      })

      const facture = await api.documentsCreateDailyFactureF?.() as {
        success?: boolean
        skipped?: boolean
        documentId?: string
        numero?: string
        lineCount?: number
        reason?: string
        error?: string
      } | undefined
      if (!facture?.success) throw new Error(facture?.error || 'La facture Client Passager n’a pas pu être créée')
      dailyInvoice = facture
      if (!facture.skipped && facture.documentId) {
        await onInvoiceCreated?.(facture.documentId)
      }

      await api.caisseInterneTransferShift(currentShift.id)
      setCurrentShift(null)
      setCurrentOperateur(null)
      setShowShiftModal(true)
      onClose()
    }, { setLoading })
    if (succeeded) {
      showToast('success', dailyInvoice?.documentId
        ? `Caisse fermée — facture Client Passager ${dailyInvoice.numero ?? ''} créée`
        : 'Caisse fermée — aucune vente F non facturée à regrouper')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg animate-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <LogOut size={16} className="text-danger" />
            <h2 className="font-bold text-base">Fermeture de Caisse</h2>
          </div>
          {!confirmed && (
            <button onClick={onClose} className="text-text-muted hover:text-text-primary">
              <X size={18} />
            </button>
          )}
        </div>

        <div className="p-6 space-y-5">
          <div className="flex items-start gap-2 p-3 bg-teal-50 border border-teal-200 rounded-xl text-xs text-teal-900">
            <FileText size={14} className="flex-shrink-0 mt-0.5" />
            <span>
              <strong>Facture de fin de journée</strong> — les ventes <strong>F</strong> non encore facturées seront regroupées
              pour <strong>Client Passager</strong>. Les produits NF et ventes déjà converties en facture sont exclus.
            </span>
          </div>

          {/* Shift info */}
          <div className="bg-muted rounded-xl p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-secondary">Opérateur</span>
              <span className="font-semibold">{currentShift.operateur_nom}</span>
            </div>
            <div className="flex items-center justify-between text-sm mt-1">
              <span className="text-text-secondary">Ouverture</span>
              <span className="font-mono text-xs">{new Date(currentShift.started_at).toLocaleString('fr-FR')}</span>
            </div>
            <div className="flex items-center justify-between text-sm mt-1">
              <span className="text-text-secondary">Fond de caisse</span>
              <span className="font-price font-semibold">{formatPrice(currentShift.fond_de_caisse)}</span>
            </div>
            <div className="flex items-center justify-between text-sm mt-1">
              <span className="text-text-secondary">Shifts déjà clos aujourd&apos;hui</span>
              <span className="font-semibold">{closedShiftsToday}</span>
            </div>
          </div>

          {/* Summary */}
          {loadingSummary ? (
            <div className="text-center py-4 text-text-muted text-sm">Chargement du résumé...</div>
          ) : summary && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Résumé du shift</h3>

              <div className="grid grid-cols-2 gap-2">
                <div className="bg-green-50 border border-green-200 rounded-xl p-3">
                  <div className="flex items-center gap-1 text-xs text-green-700 font-semibold mb-1">
                    <ShoppingBag size={11} /> Ventes
                  </div>
                  <div className="font-price font-bold text-sm text-green-800">{formatPrice(summary.ventes.total)}</div>
                  <div className="text-xs text-green-600">{summary.ventes.count} transaction{summary.ventes.count > 1 ? 's' : ''}</div>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                  <div className="flex items-center gap-1 text-xs text-blue-700 font-semibold mb-1">
                    <Wrench size={11} /> Réparations
                  </div>
                  <div className="font-price font-bold text-sm text-blue-800">{formatPrice(summary.reparations.total)}</div>
                  <div className="text-xs text-blue-600">{summary.reparations.count} dossier{summary.reparations.count > 1 ? 's' : ''}</div>
                </div>
                {(summary.creditsPercus?.total ?? 0) > 0 && (
                  <div className="bg-orange-50 border border-orange-200 rounded-xl p-3">
                    <div className="flex items-center gap-1 text-xs text-orange-700 font-semibold mb-1">
                      <CreditCard size={11} /> Paiements crédit
                    </div>
                    <div className="font-price font-bold text-sm text-orange-800">{formatPrice(summary.creditsPercus.total)}</div>
                    <div className="text-xs text-orange-600">{summary.creditsPercus.count} paiement{summary.creditsPercus.count > 1 ? 's' : ''}</div>
                  </div>
                )}
                <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                  <div className="flex items-center gap-1 text-xs text-red-700 font-semibold mb-1">
                    <ArrowDownCircle size={11} /> Sorties
                  </div>
                  <div className="font-price font-bold text-sm text-red-800">-{formatPrice(summary.sorties.total)}</div>
                  <div className="text-xs text-red-600">{summary.sorties.count} sortie{summary.sorties.count > 1 ? 's' : ''}</div>
                </div>
              </div>

              {/* Par mode */}
              {summary.parMode.length > 0 && (
                <div className="bg-muted rounded-xl p-3">
                  <div className="text-xs font-semibold text-text-secondary mb-2">Ventes par mode de paiement</div>
                  <div className="space-y-1">
                    {summary.parMode.map(m => (
                      <div key={m.mode_paiement} className="flex justify-between text-xs">
                        <span className="text-text-secondary">{MODE_LABELS[m.mode_paiement] || m.mode_paiement}</span>
                        <span className="font-price font-semibold">{formatPrice(m.total)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Solde théorique */}
              <div className="bg-accent-50 border border-accent-400 rounded-xl p-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
                    <DollarSign size={14} />
                    Solde théorique en caisse
                  </span>
                  <span className="font-price font-bold text-lg text-text-primary">{formatPrice(soldeTheorique)}</span>
                </div>
                <div className="text-xs text-text-secondary mt-1">
                  Fond + Ventes + Réparations{(summary?.creditsPercus?.total ?? 0) > 0 ? ' + Paiements crédit' : ''} − Sorties
                </div>
              </div>
            </div>
          )}

          {/* Solde réel */}
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5">
              Solde réel compté (optionnel)
            </label>
            <div className="flex items-center gap-2 border border-border rounded-xl px-4 py-3 focus-within:border-accent-500">
              <input
                type="text"
                inputMode="decimal"
                value={soldeCaisse}
                onChange={e => setSoldeCaisse(e.target.value.replace(/[^0-9.,]/g, ''))}
                className="flex-1 bg-transparent font-price text-base font-semibold outline-none"
                placeholder={soldeTheorique.toFixed(3)}
              />
              <span className="text-text-secondary font-medium">DT</span>
            </div>
            {ecart !== null && (
              <div className={`mt-2 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold ${
                Math.abs(ecart) < 0.001
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : ecart > 0
                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
              }`}>
                {Math.abs(ecart) < 0.001 ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                Écart : {ecart >= 0 ? '+' : ''}{formatPrice(ecart)}
                {Math.abs(ecart) < 0.001 && ' — Parfait !'}
                {ecart > 0.001 && ' — Excédent'}
                {ecart < -0.001 && ' — Manque'}
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Notes de clôture (optionnel)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full border border-border rounded-xl px-4 py-3 text-sm h-16 resize-none"
              placeholder="Remarques, incidents..."
            />
          </div>

          {/* Confirmation warning */}
          {confirmed && (
            <div className="flex items-center gap-2 p-3 bg-orange-50 border border-orange-200 rounded-lg text-sm text-orange-800">
              <AlertCircle size={14} />
              Confirmez la fermeture de caisse. Cette action ne peut pas être annulée.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-border">
          {!confirmed ? (
            <>
              <button
                onClick={onClose}
                className="flex-1 bg-muted hover:bg-border text-text-primary font-semibold py-2.5 rounded-xl transition-colors text-sm"
              >
                Annuler
              </button>
              <button
                onClick={handleClose}
                disabled={loadingSummary}
                className="flex-1 bg-danger hover:bg-red-700 disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold py-2.5 rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
              >
                <LogOut size={15} />
                Fermer la Caisse
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setConfirmed(false)}
                disabled={loading}
                className="flex-1 bg-muted hover:bg-border text-text-primary font-semibold py-2.5 rounded-xl transition-colors text-sm"
              >
                Retour
              </button>
              <button
                onClick={handleClose}
                disabled={loading}
                className="flex-1 bg-danger hover:bg-red-700 disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold py-2.5 rounded-xl transition-colors text-sm"
              >
                {loading ? 'Clôture...' : 'Confirmer la Fermeture'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

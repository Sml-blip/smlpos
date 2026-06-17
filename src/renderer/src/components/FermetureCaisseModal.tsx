import { useState, useEffect } from 'react'
import { useAppStore } from '../store/appStore'
import { formatPrice, generateId } from '../lib/utils'
import { runAction } from '../lib/apiCall'
import { X, DollarSign, ShoppingBag, Wrench, ArrowDownCircle, LogOut, AlertCircle, CheckCircle, CreditCard } from 'lucide-react'

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
}

export default function FermetureCaisseModal({ onClose }: Props) {
  const { currentShift, setCurrentShift, setCurrentOperateur, setShowShiftModal } = useAppStore()
  const [summary, setSummary] = useState<ShiftSummary | null>(null)
  const [soldeCaisse, setSoldeCaisse] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingSummary, setLoadingSummary] = useState(true)
  const [confirmed, setConfirmed] = useState(false)

  useEffect(() => {
    if (!currentShift) return
    let cancelled = false
    const timeout = setTimeout(() => {
      if (!cancelled) setLoadingSummary(false)
    }, 8000)
    api.shiftsGetSummary(currentShift.id)
      .then((s) => {
        if (!cancelled && s) setSummary(s as ShiftSummary)
      })
      .catch((e) => {
        console.error('[FermetureCaisse] shiftsGetSummary failed:', e)
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

  const generateFactureJournaliereF = async () => {
    try {
      // Get all F-type lignes_vente for this shift
      const lignesF = await api.dbQuery(
        `SELECT lv.*, v.client_nom FROM lignes_vente lv JOIN ventes v ON v.id = lv.vente_id WHERE v.shift_id = ? AND lv.type_produit = 'F'`,
        [currentShift!.id]
      ) as Array<Record<string, unknown>>

      if (!lignesF || lignesF.length === 0) return

      const totalTTC = lignesF.reduce((s, l) => s + (l.total_ligne as number || 0), 0)
      if (totalTTC <= 0) return

      // Get next sequence number
      const year = new Date().getFullYear()
      const yy = String(year).slice(-2)
      const seqKey = `facture_vente_sequence_${year}`
      const prevSeqRaw = await api.settingsGet(seqKey) as string | null
      const prevSeq = parseInt(prevSeqRaw ?? '0') || 0
      const nextSeq = prevSeq + 1
      await api.settingsSet(seqKey, String(nextSeq))
      const numero = `${yy}/#${String(nextSeq).padStart(5, '0')}`

      const now = new Date().toISOString()
      const docId = generateId()

      const doc = {
        id: docId,
        numero,
        type_document: 'FACTURE_JOURNALIERE_F',
        statut: 'ACTIF',
        shift_id: currentShift!.id,
        vente_id: null,
        client_nom: 'Client Passager',
        total_ht: totalTTC,
        total_tva: 0,
        total_ttc: totalTTC,
        statut_paiement: 'PAYE',
        montant_paye: totalTTC,
        created_at: now,
        updated_at: now,
      }

      const docLignes = lignesF.map(l => ({
        id: generateId(),
        document_id: docId,
        produit_id: l.produit_id || null,
        designation: l.designation,
        quantite: l.quantite,
        prix_unitaire: l.prix_unitaire,
        remise_pct: l.remise_pct || 0,
        tva_taux: 0,
        total_ht: l.total_ligne,
        total_tva: 0,
        total_ttc: l.total_ligne,
        type_produit: 'F',
      }))

      await api.documentsCreate(doc, docLignes)
    } catch (e) {
      console.error('Erreur génération facture journalière F:', e)
    }
  }

  const handleClose = async () => {
    if (!confirmed) { setConfirmed(true); return }
    await runAction('Fermeture de caisse', async () => {
      const now = new Date().toISOString()
      await api.shiftsClose(currentShift.id, {
        ended_at: now,
        solde_theorique: soldeTheorique,
        notes_cloture: notes || null,
      })
      await generateFactureJournaliereF()
      await api.caisseInterneTransferShift(currentShift.id)
      setCurrentShift(null)
      setCurrentOperateur(null)
      setShowShiftModal(true)
      onClose()
    }, { setLoading, successMessage: 'Caisse fermée' })
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

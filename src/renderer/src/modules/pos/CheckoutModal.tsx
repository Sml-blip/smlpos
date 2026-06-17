import { useState } from 'react'
import { useAppStore } from '../../store/appStore'
import type { CartItem, ModePaiement, Vente } from '../../lib/types'
import { formatPrice, generateId, generateVenteNumber } from '../../lib/utils'
import { X, CreditCard, Banknote, FileCheck, Layers, FileText, ChevronDown, ChevronUp, Printer, Package } from 'lucide-react'
import TicketModal from './TicketModal'
import DocumentPreviewModal from './DocumentPreviewModal'
import { runAction } from '../../lib/apiCall'

const api = window.api

type TypeVente = 'TICKET' | 'FACTURE' | 'BL_VENTE'

interface Props {
  items: CartItem[]
  total: number
  sousTotal: number
  totalRemises: number
  onClose: () => void
  onSuccess: (vente?: Vente, items?: CartItem[]) => void
}

export default function CheckoutModal({ items, total, sousTotal, totalRemises, onClose, onSuccess }: Props) {
  const { currentShift } = useAppStore()
  const [mode, setMode] = useState<ModePaiement>('ESPECES')
  const [montantRecu, setMontantRecu] = useState('')
  const [loading, setLoading] = useState(false)
  const [venteEnregistree, setVenteEnregistree] = useState<Vente | null>(null)
  const [typeVente, setTypeVente] = useState<TypeVente>('TICKET')
  const [showClientFields, setShowClientFields] = useState(false)
  const [clientNom, setClientNom] = useState('')
  const [clientTel, setClientTel] = useState('')
  const [clientAdresse, setClientAdresse] = useState('')
  const [clientMatricule, setClientMatricule] = useState('')
  const [showFacture, setShowFacture] = useState(false)
  const [showTicket, setShowTicket] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const montantRecuNum = parseFloat(montantRecu.replace(',', '.')) || 0
  const monnaieRendue = mode === 'ESPECES' ? Math.max(0, montantRecuNum - total) : 0
  const hasItemsF = items.some(i => i.type_produit === 'F' && !i.is_service)

  const modes: { id: ModePaiement; label: string; icon: React.ReactNode }[] = [
    { id: 'ESPECES', label: 'Espèces', icon: <Banknote size={16} /> },
    { id: 'CARTE', label: 'Carte', icon: <CreditCard size={16} /> },
    { id: 'CHEQUE', label: 'Chèque', icon: <FileCheck size={16} /> },
    { id: 'MIXTE', label: 'Mixte', icon: <Layers size={16} /> },
  ]

  const handleConfirm = async () => {
    if (mode === 'ESPECES' && montantRecuNum < total) return
    setErrorMsg('')
    await runAction('Enregistrement vente', async () => {
      const prefix = `VTE-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`
      const lastNum = await api.ventesGetLastNumber(prefix) as number
      const numero = generateVenteNumber(lastNum)
      const venteId = generateId()
      const now = new Date().toISOString()

      const vente: Vente = {
        id: venteId,
        numero,
        shift_id: currentShift?.id,
        operateur_nom: currentShift?.operateur_nom,
        sous_total: sousTotal,
        total_remises: totalRemises,
        total_ttc: total,
        mode_paiement: mode,
        montant_recu: mode === 'ESPECES' ? montantRecuNum : total,
        monnaie_rendue: monnaieRendue,
        type: 'VENTE',
        type_vente: typeVente,
        client_nom: clientNom.trim() || undefined,
        client_tel: clientTel.trim() || undefined,
        client_adresse: clientAdresse.trim() || undefined,
        client_matricule: clientMatricule.trim() || undefined,
        a_facture: typeVente !== 'TICKET' ? 1 : 0,
        created_at: now,
      }

      const lignes = items.map(item => ({
        id: generateId(),
        vente_id: venteId,
        produit_id: item.produit_id || null,
        designation: item.designation,
        quantite: item.quantite,
        prix_unitaire: item.prix_unitaire,
        remise_pct: item.remise_pct,
        total_ligne: item.total_ligne,
        type_produit: item.type_produit,
      }))

      await api.ventesCreate(vente, lignes)
      setVenteEnregistree(vente)
      if (typeVente === 'FACTURE' || typeVente === 'BL_VENTE') {
        setShowFacture(true)
      }
    }, { setLoading, silent: true, onError: setErrorMsg, successMessage: 'Vente enregistrée' })
  }

  // After payment: offer ticket + optional facture
  if (venteEnregistree) {
    if (showFacture) {
      return (
        <DocumentPreviewModal
          items={items}
          vente={venteEnregistree}
          typeVente={typeVente === 'BL_VENTE' ? 'BL_VENTE' : 'FACTURE'}
          initialClientNom={clientNom}
          initialClientTel={clientTel}
          initialClientAdresse={clientAdresse}
          initialClientMatricule={clientMatricule}
          onClose={() => { setShowFacture(false); onSuccess(venteEnregistree, items) }}
          onSuccess={() => onSuccess(venteEnregistree, items)}
        />
      )
    }
    if (showTicket) {
      return (
        <TicketModal
          vente={venteEnregistree}
          items={items}
          onClose={() => { setShowTicket(false) }}
        />
      )
    }
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-2xl shadow-2xl w-[420px] animate-slide-in">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <h2 className="font-bold text-base">Vente enregistrée ✓</h2>
            <button onClick={() => onSuccess(venteEnregistree, items)} className="text-text-muted hover:text-text-primary"><X size={18} /></button>
          </div>
          <div className="p-6 space-y-3">
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
              <div className="text-green-700 font-bold text-lg font-price">{formatPrice(total)}</div>
              <div className="text-green-600 text-sm mt-1">{venteEnregistree.numero}</div>
              {mode === 'ESPECES' && monnaieRendue > 0 && (
                <div className="text-green-600 text-sm mt-1">Monnaie rendue : <strong className="font-price">{formatPrice(monnaieRendue)}</strong></div>
              )}
            </div>
            <button
              onClick={() => setShowTicket(true)}
              className="w-full bg-muted hover:bg-accent-50 border border-border hover:border-accent-400 text-text-primary font-semibold py-2.5 rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
            >
              <Printer size={15} /> Imprimer Ticket
            </button>
            {hasItemsF && (
              <button
                onClick={() => setShowFacture(true)}
                className="w-full bg-accent-500 hover:bg-accent-600 text-text-primary font-bold py-2.5 rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
              >
                <FileText size={15} /> Générer Facture Client
              </button>
            )}
            <button
              onClick={() => onSuccess(venteEnregistree, items)}
              className="w-full bg-white hover:bg-muted border border-border text-text-secondary font-medium py-2 rounded-xl transition-colors text-sm"
            >
              Fermer
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-[460px] animate-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-bold text-base">Encaissement</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary"><X size={18} /></button>
        </div>

        <div className="p-6">
          {/* Order summary */}
          <div className="bg-muted rounded-xl p-4 mb-5">
            <div className="space-y-1 max-h-40 overflow-y-auto mb-3">
              {items.map((item, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-text-secondary">{item.designation} × {item.quantite}</span>
                  <span className="font-price">{formatPrice(item.total_ligne)}</span>
                </div>
              ))}
            </div>
            {totalRemises > 0 && (
              <div className="flex justify-between text-sm text-danger border-t border-border pt-2 mb-1">
                <span>Remises</span>
                <span className="font-price">-{formatPrice(totalRemises)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-lg border-t border-border pt-2">
              <span>Total TTC</span>
              <span className="font-price text-text-primary">{formatPrice(total)}</span>
            </div>
          </div>

          {/* Payment mode */}
          <div className="mb-5">
            <label className="block text-sm font-semibold mb-2">Mode de paiement</label>
            <div className="grid grid-cols-4 gap-2">
              {modes.map(m => (
                <button
                  key={m.id}
                  onClick={() => setMode(m.id)}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all text-xs font-semibold ${
                    mode === m.id ? 'border-accent-500 bg-accent-50' : 'border-border hover:bg-muted'
                  }`}
                >
                  {m.icon}
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Cash amount */}
          {mode === 'ESPECES' && (
            <div className="mb-5">
              <label className="block text-sm font-semibold mb-2">Montant reçu (DT)</label>
              <input
                type="text"
                inputMode="decimal"
                value={montantRecu}
                onChange={e => setMontantRecu(e.target.value.replace(/[^0-9.,]/g, ''))}
                onKeyDown={e => { if (e.key === 'Enter' && montantRecuNum >= total) handleConfirm() }}
                className="w-full border border-border rounded-xl px-4 py-3 font-price text-lg font-semibold outline-none focus:border-accent-500"
                placeholder={total.toFixed(3)}
                autoFocus
              />
              {montantRecuNum >= total && (
                <div className="mt-2 flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                  <span className="text-sm font-medium text-green-700">Monnaie à rendre</span>
                  <span className="font-price font-bold text-green-700">{formatPrice(monnaieRendue)}</span>
                </div>
              )}
              {montantRecuNum > 0 && montantRecuNum < total && (
                <div className="mt-2 flex items-center justify-between bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <span className="text-sm font-medium text-danger">Manquant</span>
                  <span className="font-price font-bold text-danger">{formatPrice(total - montantRecuNum)}</span>
                </div>
              )}
            </div>
          )}

          {/* Type de vente */}
          <div className="mb-5">
            <label className="block text-sm font-semibold mb-2">Type de document</label>
            <div className="grid grid-cols-3 gap-2">
              <button onClick={() => setTypeVente('TICKET')}
                className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border-2 transition-all text-xs font-semibold ${typeVente === 'TICKET' ? 'border-accent-500 bg-accent-50' : 'border-border hover:bg-muted'}`}>
                <Printer size={16} />Ticket
              </button>
              <button onClick={() => { setTypeVente('FACTURE'); setShowClientFields(true) }}
                className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border-2 transition-all text-xs font-semibold ${typeVente === 'FACTURE' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-border hover:bg-muted'}`}>
                <FileText size={16} />Facture
              </button>
              <button onClick={() => { setTypeVente('BL_VENTE'); setShowClientFields(true) }}
                className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border-2 transition-all text-xs font-semibold ${typeVente === 'BL_VENTE' ? 'border-green-500 bg-green-50 text-green-700' : 'border-border hover:bg-muted'}`}>
                <Package size={16} />Bon de Livraison
              </button>
            </div>
          </div>

          {/* Optional client info */}
          <div className="mb-5">
            <button
              onClick={() => setShowClientFields(v => !v)}
              className="flex items-center gap-2 text-sm font-semibold text-text-secondary hover:text-text-primary transition-colors"
            >
              {showClientFields ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              Client {typeVente !== 'TICKET' ? '(requis pour facture)' : '(optionnel)'}
            </button>
            {showClientFields && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-text-secondary mb-1">Nom client</label>
                  <input type="text" value={clientNom} onChange={e => setClientNom(e.target.value)}
                    className="w-full border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-accent-500"
                    placeholder="Nom ou raison sociale" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">Téléphone</label>
                  <input type="text" value={clientTel} onChange={e => setClientTel(e.target.value)}
                    className="w-full border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-accent-500"
                    placeholder="2x xxx xxx" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">Matricule fiscal</label>
                  <input type="text" value={clientMatricule} onChange={e => setClientMatricule(e.target.value)}
                    className="w-full border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-accent-500"
                    placeholder="MF optionnel" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-text-secondary mb-1">Adresse</label>
                  <input type="text" value={clientAdresse} onChange={e => setClientAdresse(e.target.value)}
                    className="w-full border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-accent-500"
                    placeholder="Adresse (optionnel)" />
                </div>
              </div>
            )}
          </div>

          {/* Error message */}
          {errorMsg && (
            <div className="mb-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2">
              {errorMsg}
            </div>
          )}

          {/* Confirm button */}
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading || (mode === 'ESPECES' && montantRecuNum < total)}
            className="w-full bg-accent-500 hover:bg-accent-600 disabled:bg-gray-200 disabled:text-gray-400 text-text-primary font-bold py-3.5 rounded-xl transition-colors"
          >
            {loading ? 'Traitement...' : 'Confirmer le Paiement'}
          </button>
        </div>
      </div>
    </div>
  )
}

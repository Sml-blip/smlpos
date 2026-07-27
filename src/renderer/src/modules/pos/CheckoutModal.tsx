import { useEffect, useState } from 'react'
import { useAppStore } from '../../store/appStore'
import type { CartItem, Client, ModePaiement, Vente } from '../../lib/types'
import { formatPrice, generateId, generateVenteNumber } from '../../lib/utils'
import { X, CreditCard, Banknote, FileCheck, Layers, FileText, ChevronDown, ChevronUp, Printer, Package, Gift, ScanLine, WalletCards, Sparkles } from 'lucide-react'
import TicketModal from './TicketModal'
import DocumentPreviewModal from './DocumentPreviewModal'
import ClientPicker, { clientFromRecord, emptyClientForm, type ClientFormValue } from '../../components/ClientPicker'
import { runAction } from '../../lib/apiCall'
import { round3 } from '../../lib/invoiceLineCalc'
import { generateInternalEan13 } from '../../lib/ean13'

const api = window.api

type TypeVente = 'TICKET' | 'FACTURE' | 'BL_VENTE' | 'DEVIS'

interface Props {
  items: CartItem[]
  total: number
  sousTotal: number
  totalRemises: number
  initialClient?: ClientFormValue
  onClose: () => void
  onSuccess: (vente?: Vente, items?: CartItem[]) => void
}

export default function CheckoutModal({ items, total, sousTotal, totalRemises, initialClient, onClose, onSuccess }: Props) {
  const { currentShift } = useAppStore()
  const [mode, setMode] = useState<ModePaiement>('ESPECES')
  const [montantRecu, setMontantRecu] = useState('')
  const [loading, setLoading] = useState(false)
  const [venteEnregistree, setVenteEnregistree] = useState<Vente | null>(null)
  const [typeVente, setTypeVente] = useState<TypeVente>('TICKET')
  const [showClientFields, setShowClientFields] = useState(false)
  const [clientForm, setClientForm] = useState<ClientFormValue>(initialClient ?? emptyClientForm())
  const [showFacture, setShowFacture] = useState(false)
  const [showTicket, setShowTicket] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [showLoyalty, setShowLoyalty] = useState(false)
  const [loyaltyCode, setLoyaltyCode] = useState('')
  const [loyaltyClient, setLoyaltyClient] = useState<Client | null>(null)
  const [loyaltyLookupDone, setLoyaltyLookupDone] = useState(false)
  const [loyaltyRedeemInput, setLoyaltyRedeemInput] = useState('')
  const [loyaltyError, setLoyaltyError] = useState('')
  const [loyaltyBusy, setLoyaltyBusy] = useState(false)
  const [loyaltyGainPct, setLoyaltyGainPct] = useState(1)
  const [loyaltyMinPurchase, setLoyaltyMinPurchase] = useState(0)
  const [loyaltyMaxUsePct, setLoyaltyMaxUsePct] = useState(100)

  const montantRecuNum = round3(parseFloat(montantRecu.replace(',', '.')) || 0)
  const cleanTotal = round3(total)
  const cleanSousTotal = round3(sousTotal)
  const cleanTotalRemises = round3(totalRemises)
  const availableLoyalty = Math.max(0, round3(loyaltyClient?.solde_fidelite ?? 0))
  const requestedLoyalty = Math.max(0, round3(parseFloat(loyaltyRedeemInput.replace(',', '.')) || 0))
  const maxLoyaltyUse = round3(cleanTotal * loyaltyMaxUsePct / 100)
  const loyaltyRedeemed = Math.min(requestedLoyalty, availableLoyalty, maxLoyaltyUse)
  const payableTotal = round3(Math.max(0, cleanTotal - loyaltyRedeemed))
  const loyaltyEarnPreview = loyaltyClient && payableTotal >= loyaltyMinPurchase ? round3(payableTotal * loyaltyGainPct / 100) : 0
  const monnaieRendue = mode === 'ESPECES' ? round3(Math.max(0, montantRecuNum - payableTotal)) : 0
  const hasItemsF = items.some(i => i.type_produit === 'F' && !i.is_service)

  useEffect(() => {
    api.settingsGetAll().then(settings => {
      setLoyaltyGainPct(Math.max(0, Number(settings.fidelite_gain_pct) || 0))
      setLoyaltyMinPurchase(Math.max(0, Number(settings.fidelite_min_achat) || 0))
      setLoyaltyMaxUsePct(Math.min(100, Math.max(0, Number(settings.fidelite_max_utilisation_pct) || 0)))
    }).catch(() => {})
  }, [])

  const lookupLoyaltyCard = async () => {
    const code = loyaltyCode.trim()
    if (!code) return
    setLoyaltyBusy(true)
    setLoyaltyError('')
    try {
      const found = await api.fideliteFindByCode(code) as Client | null
      setLoyaltyLookupDone(true)
      setLoyaltyClient(found)
      setLoyaltyRedeemInput('')
      if (found) {
        setClientForm(clientFromRecord(found))
      }
    } catch (e) {
      setLoyaltyError(e instanceof Error ? e.message : 'Lecture de carte impossible')
    } finally {
      setLoyaltyBusy(false)
    }
  }

  const assignLoyaltyCard = async () => {
    if (!clientForm.clientId) {
      setLoyaltyError('Sélectionnez ou créez un client avant d’assigner la carte')
      return
    }
    setLoyaltyBusy(true)
    setLoyaltyError('')
    try {
      const result = await api.fideliteAssignCard(clientForm.clientId, loyaltyCode) as { client?: Client }
      if (!result?.client) throw new Error('Carte non enregistrée')
      setLoyaltyClient(result.client)
      setClientForm(clientFromRecord(result.client))
      setLoyaltyLookupDone(true)
    } catch (e) {
      setLoyaltyError(e instanceof Error ? e.message : 'Affectation impossible')
    } finally {
      setLoyaltyBusy(false)
    }
  }

  const modes: { id: ModePaiement; label: string; icon: React.ReactNode }[] = [
    { id: 'ESPECES', label: 'Espèces', icon: <Banknote size={16} /> },
    { id: 'CARTE', label: 'Carte', icon: <CreditCard size={16} /> },
    { id: 'CHEQUE', label: 'Chèque', icon: <FileCheck size={16} /> },
    { id: 'MIXTE', label: 'Mixte', icon: <Layers size={16} /> },
  ]

  const handleConfirm = async () => {
    if (mode === 'ESPECES' && montantRecuNum < payableTotal) return
    if (typeVente === 'BL_VENTE' && items.length === 0) return
    if ((typeVente === 'FACTURE' || typeVente === 'DEVIS') && !hasItemsF) {
      setErrorMsg(`${typeVente === 'DEVIS' ? 'Devis' : 'Facture'} : au moins un produit F requis dans le panier.`)
      return
    }
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
        sous_total: cleanSousTotal,
        total_remises: round3(cleanTotalRemises + loyaltyRedeemed),
        total_ttc: payableTotal,
        mode_paiement: mode,
        montant_recu: mode === 'ESPECES' ? montantRecuNum : payableTotal,
        monnaie_rendue: monnaieRendue,
        type: 'VENTE',
        type_vente: typeVente,
        client_id: clientForm.clientId,
        client_nom: clientForm.nom.trim() || undefined,
        client_tel: clientForm.tel.trim() || undefined,
        client_adresse: clientForm.adresse.trim() || undefined,
        client_matricule: clientForm.matricule.trim() || undefined,
        a_facture: typeVente !== 'TICKET' ? 1 : 0,
        fidelite_utilisee: loyaltyRedeemed,
        fidelite_gagnee: loyaltyEarnPreview,
        created_at: now,
      }

      const lignes = items.map(item => ({
        id: generateId(),
        vente_id: venteId,
        produit_id: item.produit_id || null,
        designation: item.designation,
        quantite: item.quantite,
        prix_unitaire: round3(item.prix_unitaire),
        remise_pct: round3(item.remise_pct),
        total_ligne: round3(item.total_ligne),
        type_produit: item.type_produit,
        numero_serie: item.numero_serie ?? null,
      }))

      const saved = await api.ventesCreate(vente, lignes) as {
        fidelite_utilisee?: number
        fidelite_gagnee?: number
        solde_fidelite?: number
      }
      setVenteEnregistree({
        ...vente,
        fidelite_utilisee: saved?.fidelite_utilisee ?? loyaltyRedeemed,
        fidelite_gagnee: saved?.fidelite_gagnee ?? loyaltyEarnPreview,
      })
      if (typeVente === 'FACTURE' || typeVente === 'BL_VENTE' || typeVente === 'DEVIS') {
        setShowFacture(true)
      }
    }, { setLoading, silent: true, onError: setErrorMsg, successMessage: 'Vente enregistrée', feedback: 'cash' })
  }

  // After payment: offer ticket + optional facture
  if (venteEnregistree) {
    if (showFacture) {
      return (
        <DocumentPreviewModal
          items={items}
          vente={venteEnregistree}
          typeVente={typeVente === 'BL_VENTE' ? 'BL_VENTE' : typeVente === 'DEVIS' ? 'DEVIS' : 'FACTURE'}
          initialClientNom={clientForm.nom}
          initialClientTel={clientForm.tel}
          initialClientAdresse={clientForm.adresse}
          initialClientMatricule={clientForm.matricule}
          initialClientId={clientForm.clientId}
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
              <div className="text-green-700 font-bold text-lg font-price">{formatPrice(venteEnregistree.total_ttc)}</div>
              <div className="text-green-600 text-sm mt-1">{venteEnregistree.numero}</div>
              {(venteEnregistree.fidelite_utilisee ?? 0) > 0 && (
                <div className="text-violet-700 text-xs mt-2">Fidélité utilisée : -{formatPrice(venteEnregistree.fidelite_utilisee ?? 0)}</div>
              )}
              {(venteEnregistree.fidelite_gagnee ?? 0) > 0 && (
                <div className="text-violet-700 text-xs mt-1">Fidélité gagnée : +{formatPrice(venteEnregistree.fidelite_gagnee ?? 0)}</div>
              )}
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
      <div className="bg-white rounded-2xl shadow-2xl w-[460px] max-h-[94vh] flex flex-col animate-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-bold text-base">Encaissement</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary"><X size={18} /></button>
        </div>

        <div className="p-6 overflow-y-auto">
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
              <span>{loyaltyRedeemed > 0 ? 'Net à payer' : 'Total TTC'}</span>
              <span className="font-price text-text-primary">{formatPrice(payableTotal)}</span>
            </div>
          </div>

          {/* Carte de fidélité */}
          <div className="mb-5">
            <button
              type="button"
              onClick={() => setShowLoyalty(v => !v)}
              className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border border-violet-200 bg-violet-50 hover:bg-violet-100"
            >
              <span className="flex items-center gap-2 text-sm font-bold text-violet-800">
                <Gift size={16} /> Carte de fidélité
              </span>
              <span className="flex items-center gap-2">
                {loyaltyClient && <span className="text-[10px] font-price font-bold text-violet-700">{formatPrice(availableLoyalty)}</span>}
                {showLoyalty ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </span>
            </button>
            {showLoyalty && (
              <div className="mt-2 p-3 rounded-xl border border-violet-200 bg-white space-y-3 animate-slide-in">
                <div className="flex gap-2">
                  <div className="flex-1 flex items-center gap-2 border border-violet-300 rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-violet-200">
                    <ScanLine size={14} className="text-violet-600" />
                    <input
                      value={loyaltyCode}
                      onChange={e => {
                        if (loyaltyClient && clientForm.clientId === loyaltyClient.id) setClientForm(emptyClientForm())
                        setLoyaltyCode(e.target.value)
                        setLoyaltyLookupDone(false)
                        setLoyaltyClient(null)
                        setLoyaltyError('')
                      }}
                      onKeyDown={e => { if (e.key === 'Enter') void lookupLoyaltyCard() }}
                      placeholder="Scanner le code-barres de la carte"
                      className="min-w-0 flex-1 outline-none text-sm font-mono"
                      autoFocus
                    />
                  </div>
                  <button type="button" onClick={() => void lookupLoyaltyCard()} disabled={!loyaltyCode.trim() || loyaltyBusy}
                    className="px-3 rounded-lg bg-violet-600 text-white font-bold text-xs disabled:opacity-40">
                    Lire
                  </button>
                  <button type="button" onClick={() => {
                    if (loyaltyClient && clientForm.clientId === loyaltyClient.id) setClientForm(emptyClientForm())
                    setLoyaltyCode(generateInternalEan13()); setLoyaltyLookupDone(true); setLoyaltyClient(null); setLoyaltyRedeemInput('')
                  }}
                    title="Générer une nouvelle carte" className="w-10 rounded-lg border border-violet-300 text-violet-700 hover:bg-violet-50">
                    <Sparkles size={15} className="mx-auto" />
                  </button>
                </div>

                {loyaltyClient ? (
                  <div className="rounded-xl bg-violet-50 border border-violet-200 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-bold text-violet-900">{loyaltyClient.nom}</div>
                        <div className="text-[10px] text-violet-700 font-mono">{loyaltyClient.fidelite_code}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-violet-700">Solde disponible</div>
                        <div className="font-price font-bold text-violet-900">{formatPrice(availableLoyalty)}</div>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <WalletCards size={15} className="text-violet-700" />
                      <input
                        value={loyaltyRedeemInput}
                        onChange={e => setLoyaltyRedeemInput(e.target.value.replace(/[^0-9.,]/g, ''))}
                        placeholder="Montant à utiliser"
                        className="min-w-0 flex-1 border border-violet-300 rounded-lg px-2.5 py-2 text-sm font-price outline-none"
                      />
                      <button type="button" onClick={() => setLoyaltyRedeemInput(String(Math.min(availableLoyalty, maxLoyaltyUse).toFixed(3)))}
                        className="px-2.5 py-2 rounded-lg bg-violet-100 text-violet-800 text-xs font-bold">
                        Max
                      </button>
                    </div>
                    <div className="mt-2 text-[10px] text-violet-700 flex justify-between">
                      <span>Remise utilisée : {formatPrice(loyaltyRedeemed)}</span>
                      <span>Gain estimé : +{formatPrice(loyaltyEarnPreview)}</span>
                    </div>
                  </div>
                ) : loyaltyLookupDone && loyaltyCode.trim() ? (
                  <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <p className="text-xs font-semibold text-amber-900">Nouvelle carte — choisissez ou créez son client</p>
                    <ClientPicker value={clientForm} onChange={setClientForm} allowPassager={false} compact />
                    <button type="button" onClick={() => void assignLoyaltyCard()} disabled={!clientForm.clientId || loyaltyBusy}
                      className="w-full py-2 rounded-lg bg-violet-600 text-white text-xs font-bold disabled:opacity-40">
                      Assigner cette carte au client
                    </button>
                  </div>
                ) : null}
                {loyaltyError && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{loyaltyError}</p>}
              </div>
            )}
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
                onKeyDown={e => { if (e.key === 'Enter' && montantRecuNum >= payableTotal) handleConfirm() }}
                className="w-full border border-border rounded-xl px-4 py-3 font-price text-lg font-semibold outline-none focus:border-accent-500"
                placeholder={payableTotal.toFixed(3)}
                autoFocus
              />
              {montantRecuNum >= payableTotal && (
                <div className="mt-2 flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                  <span className="text-sm font-medium text-green-700">Monnaie à rendre</span>
                  <span className="font-price font-bold text-green-700">{formatPrice(monnaieRendue)}</span>
                </div>
              )}
              {montantRecuNum > 0 && montantRecuNum < payableTotal && (
                <div className="mt-2 flex items-center justify-between bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <span className="text-sm font-medium text-danger">Manquant</span>
                  <span className="font-price font-bold text-danger">{formatPrice(payableTotal - montantRecuNum)}</span>
                </div>
              )}
            </div>
          )}

          {/* Type de vente */}
          <div className="mb-5">
            <label className="block text-sm font-semibold mb-2">Type de document</label>
            <div className="grid grid-cols-4 gap-2">
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
              <button onClick={() => { setTypeVente('DEVIS'); setShowClientFields(true) }}
                className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border-2 transition-all text-xs font-semibold ${typeVente === 'DEVIS' ? 'border-yellow-500 bg-yellow-50 text-yellow-700' : 'border-border hover:bg-muted'}`}>
                <FileCheck size={16} />Devis
              </button>
            </div>
            {typeVente === 'BL_VENTE' && (
              <p className="text-[10px] text-green-700 bg-green-50 border border-green-200 rounded-lg px-2 py-1.5 mt-2">
                BL vente : produits F et NF acceptés.
              </p>
            )}
            {typeVente === 'FACTURE' && !hasItemsF && (
              <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 mt-2">
                Facture : au moins un produit F requis (NF exclus).
              </p>
            )}
            {typeVente === 'DEVIS' && !hasItemsF && (
              <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 mt-2">
                Devis : au moins un produit F requis (NF exclus).
              </p>
            )}
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
              <div className="mt-3">
                <ClientPicker
                  value={clientForm}
                  onChange={value => {
                    setClientForm(value)
                    if (loyaltyClient && value.clientId !== loyaltyClient.id) {
                      setLoyaltyClient(null)
                      setLoyaltyRedeemInput('')
                    }
                  }}
                  required={typeVente !== 'TICKET'}
                />
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
            disabled={loading || (mode === 'ESPECES' && montantRecuNum < payableTotal) || ((typeVente === 'FACTURE' || typeVente === 'DEVIS') && !hasItemsF)}
            className="w-full bg-accent-500 hover:bg-accent-600 disabled:bg-gray-200 disabled:text-gray-400 text-text-primary font-bold py-3.5 rounded-xl transition-colors"
          >
            {loading ? 'Traitement...' : 'Confirmer le Paiement'}
          </button>
        </div>
      </div>
    </div>
  )
}

import { useState, useEffect, useCallback } from 'react'
import { formatPrice, generateId } from '../../lib/utils'
import { cn } from '../../lib/utils'
import { useAppStore } from '../../store/appStore'
import { loadData, runAction } from '../../lib/apiCall'
import type { Produit } from '../../lib/types'
import {
  ShoppingBag, Plus, X, RefreshCw, Search, Package,
  CheckCircle, Truck, RotateCcw, Clock, DollarSign, ChevronDown, ChevronUp, Printer,
  Ban, BadgeDollarSign
} from 'lucide-react'
import CommandePrintModal from './CommandePrintModal'

const api = window.api

interface CommandeLigne {
  id: string; numero: string; shift_id?: string; operateur_nom?: string
  client_nom: string; client_tel?: string; client_adresse?: string
  produits_json: string; montant_ttc: number; frais_livraison: number
  frais_retour: number; statut: 'EN_ATTENTE' | 'CONFIRME' | 'LIVRE' | 'REGLE' | 'RETOUR' | 'ANNULE'
  livraison_nom?: string; montant_recu: number; montant_net?: number; note?: string
  created_at: string; updated_at: string
}

interface LigneProduit { produit_id?: string; designation: string; quantite: number; prix_unitaire: number }

const STATUT_CONFIG = {
  EN_ATTENTE: { label: 'En attente', color: 'bg-blue-100 text-blue-800 border-blue-300',     icon: <Clock size={11} /> },
  CONFIRME:   { label: 'Confirmé',   color: 'bg-green-100 text-green-800 border-green-300',  icon: <CheckCircle size={11} /> },
  LIVRE:      { label: 'Livré',      color: 'bg-purple-100 text-purple-800 border-purple-300', icon: <Truck size={11} /> },
  REGLE:      { label: 'Réglé',      color: 'bg-emerald-100 text-emerald-800 border-emerald-300', icon: <BadgeDollarSign size={11} /> },
  RETOUR:     { label: 'Retour',     color: 'bg-red-100 text-red-800 border-red-300',         icon: <RotateCcw size={11} /> },
  ANNULE:     { label: 'Annulé',     color: 'bg-gray-100 text-gray-600 border-gray-300',      icon: <Ban size={11} /> },
}

export default function VenteEnLigneTab() {
  const { currentShift } = useAppStore()
  const [commandes, setCommandes] = useState<CommandeLigne[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [filterStatut, setFilterStatut] = useState<string>('all')
  const [showModal, setShowModal] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [actionModal, setActionModal] = useState<{ cmd: CommandeLigne; action: string } | null>(null)
  const [printModal, setPrintModal] = useState<CommandeLigne | null>(null)

  const load = useCallback(async () => {
    const filters: Record<string, string> = {}
    if (filterStatut !== 'all') filters.statut = filterStatut
    if (search) filters.search = search
    const result = await loadData('Chargement commandes', () => api.ventesLigneList(filters) as Promise<CommandeLigne[]>, { setLoading })
    if (result) setCommandes(result)
  }, [filterStatut, search])

  useEffect(() => { load() }, [load])

  // Stats
  const stats = {
    enAttente: commandes.filter(c => c.statut === 'EN_ATTENTE').length,
    confirme: commandes.filter(c => c.statut === 'CONFIRME').length,
    retour: commandes.filter(c => c.statut === 'RETOUR').length,
    regle: commandes.filter(c => c.statut === 'REGLE').length,
    totalPending: commandes.filter(c => ['EN_ATTENTE', 'CONFIRME', 'LIVRE'].includes(c.statut)).reduce((s, c) => s + c.montant_ttc, 0),
    totalRegle: commandes.filter(c => c.statut === 'REGLE').reduce((s, c) => s + (c.montant_net ?? c.montant_ttc), 0),
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-border flex-shrink-0">
        <h2 className="font-bold text-sm flex items-center gap-2"><ShoppingBag size={15} /> Ventes en Ligne</h2>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowModal(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-500 hover:bg-accent-600 rounded-lg text-sm font-bold transition-colors">
            <Plus size={14} /> Nouvelle Commande
          </button>
          <button onClick={load} disabled={loading} className="p-1.5 text-text-muted hover:text-text-primary rounded-lg hover:bg-muted">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-5 gap-2 px-4 py-3 flex-shrink-0">
        {[
          { label: 'En attente', val: stats.enAttente, color: 'text-blue-800 bg-blue-50 border-blue-200' },
          { label: 'Confirmées', val: stats.confirme, color: 'text-green-800 bg-green-50 border-green-200' },
          { label: 'Réglées', val: stats.regle, color: 'text-emerald-800 bg-emerald-50 border-emerald-200' },
          { label: 'Retours', val: stats.retour, color: 'text-red-800 bg-red-50 border-red-200' },
          { label: 'Total réglé', val: formatPrice(stats.totalRegle), color: 'text-text-primary bg-white border-border', isPrice: true },
        ].map((k, i) => (
          <div key={i} className={cn('rounded-xl border p-3 shadow-card', k.color)}>
            <div className="text-xs font-semibold opacity-70">{k.label}</div>
            <div className={cn('font-bold mt-1', k.isPrice ? 'text-sm font-price' : 'text-2xl')}>{k.val}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-border flex-shrink-0">
        <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
          {[{ id: 'all', label: 'Tout' }, { id: 'EN_ATTENTE', label: 'En attente' }, { id: 'CONFIRME', label: 'Confirmé' }, { id: 'LIVRE', label: 'Livré' }, { id: 'REGLE', label: 'Réglé' }, { id: 'RETOUR', label: 'Retour' }, { id: 'ANNULE', label: 'Annulé' }].map(f => (
            <button key={f.id} onClick={() => setFilterStatut(f.id)}
              className={cn('px-3 py-1 rounded-md text-xs font-semibold transition-colors',
                filterStatut === f.id ? 'bg-white shadow-sm text-text-primary' : 'text-text-secondary hover:text-text-primary')}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 border border-border rounded-lg px-3 py-1.5 bg-muted ml-auto">
          <Search size={13} className="text-text-muted" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            className="bg-transparent outline-none text-sm w-36" placeholder="Client ou N°..." />
          {search && <button onClick={() => setSearch('')}><X size={12} className="text-text-muted" /></button>}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {commandes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-muted">
            <ShoppingBag size={40} className="mb-3 opacity-30" />
            <p className="text-sm">Aucune commande en ligne</p>
          </div>
        ) : commandes.map(cmd => {
          const sc = STATUT_CONFIG[cmd.statut]
          const lines = JSON.parse(cmd.produits_json) as LigneProduit[]
          const isExpanded = expanded === cmd.id
          return (
            <div key={cmd.id} className={cn('bg-white rounded-xl border shadow-card overflow-hidden',
              cmd.statut === 'RETOUR' ? 'border-red-200' :
              cmd.statut === 'ANNULE' ? 'border-gray-200' :
              cmd.statut === 'REGLE' ? 'border-emerald-200' :
              cmd.statut === 'CONFIRME' ? 'border-green-200' :
              cmd.statut === 'LIVRE' ? 'border-purple-200' : 'border-blue-200')}>
              <div className="flex items-center gap-3 px-4 py-3 cursor-pointer" onClick={() => setExpanded(isExpanded ? null : cmd.id)}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-text-secondary">{cmd.numero}</span>
                    <span className={cn('text-xs px-2 py-0.5 rounded-full border font-semibold flex items-center gap-1', sc.color)}>{sc.icon}{sc.label}</span>
                    {cmd.livraison_nom && <span className="text-xs text-text-muted">— {cmd.livraison_nom}</span>}
                  </div>
                  <div className="font-semibold text-sm mt-0.5">{cmd.client_nom} {cmd.client_tel && <span className="text-text-muted font-normal">· {cmd.client_tel}</span>}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="font-price font-bold">{formatPrice(cmd.montant_ttc)}</div>
                  <div className="text-xs text-text-muted">{new Date(cmd.created_at).toLocaleDateString('fr-FR')}</div>
                </div>
                {isExpanded ? <ChevronUp size={14} className="text-text-muted flex-shrink-0" /> : <ChevronDown size={14} className="text-text-muted flex-shrink-0" />}
              </div>

              {isExpanded && (
                <div className="border-t border-border px-4 py-3 bg-muted space-y-3">
                  {/* Lines */}
                  <div className="space-y-1">
                    {lines.map((l, i) => (
                      <div key={i} className="flex justify-between text-xs">
                        <span className="text-text-secondary">{l.designation} × {l.quantite}</span>
                        <span className="font-price">{formatPrice(l.quantite * l.prix_unitaire)}</span>
                      </div>
                    ))}
                    {cmd.frais_livraison > 0 && (
                      <div className="flex justify-between text-xs text-text-muted">
                        <span>Frais livraison</span><span className="font-price">{formatPrice(cmd.frais_livraison)}</span>
                      </div>
                    )}
                  </div>
                  {cmd.note && <p className="text-xs text-text-secondary italic">{cmd.note}</p>}
                  {/* Actions */}
                  <div className="flex gap-2">
                    {cmd.statut === 'EN_ATTENTE' && (
                      <>
                        <button onClick={() => setActionModal({ cmd, action: 'CONFIRME' })}
                          className="flex-1 py-1.5 text-xs font-bold bg-green-500 hover:bg-green-600 text-white rounded-lg transition-colors flex items-center justify-center gap-1">
                          <CheckCircle size={12} /> Confirmer
                        </button>
                        <button onClick={() => setActionModal({ cmd, action: 'ANNULE' })}
                          className="py-1.5 px-3 text-xs font-bold bg-gray-400 hover:bg-gray-500 text-white rounded-lg transition-colors flex items-center justify-center gap-1 flex-shrink-0">
                          <Ban size={12} /> Annuler
                        </button>
                      </>
                    )}
                    {cmd.statut === 'CONFIRME' && (
                      <>
                        <button onClick={() => setActionModal({ cmd, action: 'LIVRE' })}
                          className="flex-1 py-1.5 text-xs font-bold bg-purple-500 hover:bg-purple-600 text-white rounded-lg transition-colors flex items-center justify-center gap-1">
                          <Truck size={12} /> Marquer Livré
                        </button>
                        <button onClick={() => setActionModal({ cmd, action: 'ANNULE' })}
                          className="py-1.5 px-3 text-xs font-bold bg-gray-400 hover:bg-gray-500 text-white rounded-lg transition-colors flex items-center justify-center gap-1 flex-shrink-0">
                          <Ban size={12} /> Annuler
                        </button>
                      </>
                    )}
                    {cmd.statut === 'LIVRE' && (
                      <>
                        <button onClick={() => setActionModal({ cmd, action: 'REGLE' })}
                          className="flex-1 py-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors flex items-center justify-center gap-1">
                          <BadgeDollarSign size={12} /> Marquer Réglé
                        </button>
                        <button onClick={() => setActionModal({ cmd, action: 'RETOUR' })}
                          className="py-1.5 px-3 text-xs font-bold bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors flex items-center justify-center gap-1 flex-shrink-0">
                          <RotateCcw size={12} /> Retour
                        </button>
                      </>
                    )}
                    <button onClick={() => setPrintModal(cmd)}
                      className="py-1.5 px-3 text-xs font-bold bg-white border border-border hover:bg-muted rounded-lg transition-colors flex items-center gap-1 flex-shrink-0">
                      <Printer size={12} /> A5
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {showModal && <NouvelleCommandeModal onClose={() => setShowModal(false)} onSaved={load} shift={currentShift} />}
      {actionModal && (
        <ActionModal
          cmd={actionModal.cmd}
          action={actionModal.action}
          onClose={() => setActionModal(null)}
          onSaved={() => { setActionModal(null); load(); setExpanded(null) }}
          shift={currentShift}
        />
      )}
      {printModal && <CommandePrintModal commande={printModal} onClose={() => setPrintModal(null)} />}
    </div>
  )
}

// ── Nouvelle Commande Modal ────────────────────────────────────────────────────
function NouvelleCommandeModal({ onClose, onSaved, shift }: { onClose: () => void; onSaved: () => void; shift: unknown }) {
  const [clientNom, setClientNom] = useState('')
  const [clientTel, setClientTel] = useState('')
  const [clientAdresse, setClientAdresse] = useState('')
  const [livraisonNom, setLivraisonNom] = useState('')
  const [fraisLivraison, setFraisLivraison] = useState('0')
  const [fraisRetourDefaut, setFraisRetourDefaut] = useState(4)
  const [note, setNote] = useState('')
  const [lignes, setLignes] = useState<LigneProduit[]>([{ designation: '', quantite: 1, prix_unitaire: 0 }])
  const [produits, setProduits] = useState<Produit[]>([])
  const [prodSearch, setProdSearch] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadData('Chargement paramètres', () => api.settingsGet('frais_retour_colis'), { silent: true }).then(v => {
      if (v) setFraisRetourDefaut(parseFloat(v as string) || 4)
    })
    if (prodSearch.length >= 2) {
      loadData('Recherche produits', () => api.produitsList({ search: prodSearch }), { silent: true }).then(r => {
        if (r) setProduits((r as Produit[]).slice(0, 8))
      })
    } else setProduits([])
  }, [prodSearch])

  const montantTTC = lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire, 0) + (parseFloat(fraisLivraison) || 0)

  const addFromProduit = (p: Produit) => {
    setLignes(prev => [...prev.filter(l => l.designation), { produit_id: p.id, designation: p.nom, quantite: 1, prix_unitaire: p.prix_vente }])
    setProdSearch('')
  }

  const updateLigne = (i: number, field: string, val: unknown) =>
    setLignes(prev => prev.map((l, idx) => idx === i ? { ...l, [field]: val } : l))

  const handleSave = async () => {
    const filledLignes = lignes.filter(l => l.designation.trim())
    if (!clientNom.trim() || filledLignes.length === 0) return
    await runAction('Création commande', async () => {
      const s = shift as { id?: string; operateur_nom?: string } | null
      const prefix = `VL-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`
      const lastNum = await api.ventesLigneGetLastNumber(prefix) as number
      const numero = `${prefix}-${String(lastNum + 1).padStart(3, '0')}`
      await api.ventesLigneCreate({
        id: generateId(), numero,
        shift_id: s?.id ?? null, operateur_nom: s?.operateur_nom ?? null,
        client_nom: clientNom.trim(), client_tel: clientTel.trim() || null,
        client_adresse: clientAdresse.trim() || null,
        produits_json: JSON.stringify(filledLignes),
        montant_ttc: filledLignes.reduce((s, l) => s + l.quantite * l.prix_unitaire, 0) + (parseFloat(fraisLivraison) || 0), frais_livraison: parseFloat(fraisLivraison) || 0,
        frais_retour: fraisRetourDefaut, statut: 'EN_ATTENTE',
        livraison_nom: livraisonNom.trim() || null, montant_recu: 0,
        note: note || null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      })
      onSaved(); onClose()
    }, { setLoading, successMessage: 'Commande créée' })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto animate-slide-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-white z-10">
          <h2 className="font-bold text-base flex items-center gap-2"><ShoppingBag size={15} /> Nouvelle Commande en Ligne</h2>
          <button onClick={onClose}><X size={18} className="text-text-muted" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-text-secondary mb-1">Nom client *</label>
              <input value={clientNom} onChange={e => setClientNom(e.target.value)} autoFocus
                className="w-full border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent-500" placeholder="Nom complet" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1">Téléphone</label>
              <input value={clientTel} onChange={e => setClientTel(e.target.value)}
                className="w-full border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1">Société livraison</label>
              <input value={livraisonNom} onChange={e => setLivraisonNom(e.target.value)}
                className="w-full border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent-500" placeholder="Ex: Aramex, GLS..." />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-text-secondary mb-1">Adresse livraison</label>
              <input value={clientAdresse} onChange={e => setClientAdresse(e.target.value)}
                className="w-full border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent-500" />
            </div>
          </div>

          {/* Product search */}
          <div className="relative">
            <label className="block text-xs font-semibold text-text-secondary mb-1">Rechercher un produit</label>
            <div className="flex items-center gap-2 border border-border rounded-xl px-3 py-2.5 focus-within:border-accent-500">
              <Search size={13} className="text-text-muted" />
              <input value={prodSearch} onChange={e => setProdSearch(e.target.value)}
                className="flex-1 bg-transparent text-sm outline-none" placeholder="Taper pour rechercher..." />
            </div>
            {produits.length > 0 && (
              <div className="absolute top-full left-0 right-0 bg-white border border-border rounded-xl shadow-lg z-20 mt-1 max-h-40 overflow-y-auto">
                {produits.map(p => (
                  <button key={p.id} onClick={() => addFromProduit(p)}
                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted text-sm transition-colors">
                    <span className="truncate">{p.nom}</span>
                    <span className="font-price font-semibold ml-2 flex-shrink-0">{formatPrice(p.prix_vente)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Lignes */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-text-secondary">Articles</label>
              <button onClick={() => setLignes(prev => [...prev, { designation: '', quantite: 1, prix_unitaire: 0 }])}
                className="text-xs px-2 py-1 bg-accent-500 rounded-lg font-semibold"><Plus size={11} className="inline" /> Ligne</button>
            </div>
            {lignes.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-5">
                  <input value={l.designation} onChange={e => updateLigne(i, 'designation', e.target.value)}
                    className="w-full border border-border rounded-lg px-2 py-1.5 text-xs outline-none focus:border-accent-500 bg-white" placeholder="Désignation *" />
                </div>
                <div className="col-span-2">
                  <input type="text" inputMode="numeric" value={l.quantite} onChange={e => updateLigne(i, 'quantite', parseInt(e.target.value.replace(/[^0-9]/g, '')) || 1)}
                    className="w-full border border-border rounded-lg px-2 py-1.5 text-xs font-price text-center outline-none focus:border-accent-500 bg-white" />
                </div>
                <div className="col-span-3">
                  <input type="text" inputMode="decimal" value={l.prix_unitaire} onChange={e => updateLigne(i, 'prix_unitaire', parseFloat(e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.')) || 0)}
                    className="w-full border border-border rounded-lg px-2 py-1.5 text-xs font-price outline-none focus:border-accent-500 bg-white" />
                </div>
                <div className="col-span-1 text-xs font-price text-text-secondary text-right">{formatPrice(l.quantite * l.prix_unitaire)}</div>
                <div className="col-span-1 text-right">
                  {lignes.length > 1 && <button onClick={() => setLignes(prev => prev.filter((_, idx) => idx !== i))} className="text-danger"><X size={12} /></button>}
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1">Frais livraison (DT)</label>
              <input type="text" inputMode="decimal" value={fraisLivraison} onChange={e => setFraisLivraison(e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.'))}
                className="w-full border border-border rounded-xl px-3 py-2.5 text-sm font-price outline-none focus:border-accent-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1">Note</label>
              <input value={note} onChange={e => setNote(e.target.value)}
                className="w-full border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent-500" />
            </div>
          </div>

          <div className="bg-accent-50 border border-accent-300 rounded-xl p-3 flex justify-between">
            <span className="font-semibold text-sm">Total TTC</span>
            <span className="font-price font-bold text-lg">{formatPrice(montantTTC)}</span>
          </div>
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-border sticky bottom-0 bg-white">
          <button type="button" onClick={onClose} className="flex-1 bg-muted hover:bg-border font-semibold py-2.5 rounded-xl text-sm transition-colors">Annuler</button>
          <button type="button" onClick={handleSave} disabled={loading || !clientNom.trim() || !lignes.some(l => l.designation.trim())}
            className="flex-1 bg-accent-500 hover:bg-accent-600 disabled:bg-gray-200 disabled:text-gray-400 font-bold py-2.5 rounded-xl text-sm transition-colors">
            {loading ? 'Enregistrement...' : `Créer — ${formatPrice(montantTTC)}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Action Modal ──────────────────────────────────────────────────────────────
function ActionModal({ cmd, action, onClose, onSaved, shift }: { cmd: CommandeLigne; action: string; onClose: () => void; onSaved: () => void; shift: unknown }) {
  const [montantRecu, setMontantRecu] = useState(cmd.montant_ttc.toFixed(3))
  const [montantNet, setMontantNet] = useState((cmd.montant_recu > 0 ? cmd.montant_recu : cmd.montant_ttc).toFixed(3))
  const [fraisRetour, setFraisRetour] = useState(cmd.frais_retour.toFixed(3))
  const [loading, setLoading] = useState(false)

  const s = shift as { id?: string; operateur_nom?: string } | null

  const handleAction = async () => {
    await runAction('Mise à jour commande', async () => {
      const extra: Record<string, unknown> = { shift_id: s?.id ?? null, operateur: s?.operateur_nom ?? null }
      if (action === 'RETOUR') extra.frais_retour = parseFloat(fraisRetour) || 4
      if (action === 'LIVRE') extra.montant_recu = parseFloat(montantRecu) || 0
      if (action === 'REGLE') extra.montant_net = parseFloat(montantNet) || 0
      await api.ventesLigneUpdateStatut(cmd.id, action, extra)
      onSaved()
    }, { setLoading, successMessage: 'Commande mise à jour' })
  }

  const labels: Record<string, { title: string; btn: string; color: string }> = {
    CONFIRME: { title: 'Confirmer la commande',   btn: 'Confirmer',           color: 'bg-green-500 hover:bg-green-600' },
    LIVRE:    { title: 'Marquer comme livré',      btn: 'Marquer Livré',       color: 'bg-purple-500 hover:bg-purple-600' },
    REGLE:    { title: 'Marquer comme réglé',      btn: 'Encaisser montant net', color: 'bg-emerald-600 hover:bg-emerald-700' },
    RETOUR:   { title: 'Enregistrer un retour',    btn: 'Confirmer le retour', color: 'bg-red-500 hover:bg-red-600' },
    ANNULE:   { title: 'Annuler la commande',       btn: 'Confirmer l\'annulation', color: 'bg-gray-500 hover:bg-gray-600' },
  }
  const conf = labels[action]

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-[400px] animate-slide-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-bold text-base">{conf.title}</h2>
          <button onClick={onClose}><X size={18} className="text-text-muted" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="bg-muted rounded-xl p-4">
            <div className="font-bold">{cmd.client_nom}</div>
            <div className="text-xs text-text-muted font-mono">{cmd.numero}</div>
            <div className="font-price font-bold text-lg mt-1">{formatPrice(cmd.montant_ttc)}</div>
          </div>

          {action === 'CONFIRME' && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm text-green-800">
              Le stock des produits sera automatiquement déduit à la confirmation.
            </div>
          )}

          {action === 'LIVRE' && (
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1">Montant attendu du transporteur (DT)</label>
              <div className="flex items-center gap-2 border border-border rounded-xl px-4 py-3 focus-within:border-accent-500">
                <DollarSign size={14} className="text-text-muted" />
                <input type="text" inputMode="decimal" value={montantRecu} onChange={e => setMontantRecu(e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.'))} autoFocus
                  className="flex-1 bg-transparent font-price text-lg font-bold outline-none" />
                <span className="text-text-secondary">DT</span>
              </div>
              <p className="text-xs text-text-muted mt-1">Ce montant sera enregistré lors du règlement (statut Réglé).</p>
            </div>
          )}

          {action === 'REGLE' && (
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1">Montant net reçu du transporteur (DT)</label>
              <div className="flex items-center gap-2 border border-emerald-400 rounded-xl px-4 py-3 focus-within:border-emerald-500 bg-emerald-50">
                <DollarSign size={14} className="text-emerald-600" />
                <input type="text" inputMode="decimal" value={montantNet} onChange={e => setMontantNet(e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.'))} autoFocus
                  className="flex-1 bg-transparent font-price text-lg font-bold outline-none text-emerald-800" />
                <span className="text-emerald-700 font-semibold">DT</span>
              </div>
              <p className="text-xs text-emerald-700 mt-1 font-medium">Ce montant sera ajouté à la caisse interne (trésorerie).</p>
            </div>
          )}

          {action === 'RETOUR' && (
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1">Frais de retour (DT) — déduits de la caisse externe</label>
              <div className="flex items-center gap-2 border border-border rounded-xl px-4 py-3 focus-within:border-accent-500">
                <DollarSign size={14} className="text-text-muted" />
                <input type="text" inputMode="decimal" value={fraisRetour} onChange={e => setFraisRetour(e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.'))}
                  className="flex-1 bg-transparent font-price text-lg font-bold outline-none" />
                <span className="text-text-secondary">DT</span>
              </div>
              <p className="text-xs text-text-muted mt-1">Ces frais seront enregistrés comme sortie de la caisse externe.</p>
            </div>
          )}

          {action === 'ANNULE' && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 text-sm text-orange-800">
              La commande sera annulée.{' '}
              {(cmd.statut === 'CONFIRME' || cmd.statut === 'LIVRE') && 'Le stock des produits sera restauré automatiquement.'}
            </div>
          )}
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-border">
          <button type="button" onClick={onClose} className="flex-1 bg-muted hover:bg-border font-semibold py-2.5 rounded-xl text-sm transition-colors">Fermer</button>
          <button type="button" onClick={handleAction} disabled={loading}
            className={cn('flex-1 text-white font-bold py-2.5 rounded-xl text-sm transition-colors disabled:bg-gray-300', conf.color)}>
            {loading ? 'En cours...' : conf.btn}
          </button>
        </div>
      </div>
    </div>
  )
}

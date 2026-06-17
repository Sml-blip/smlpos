import { useState, useEffect } from 'react'
import { formatPrice, generateId } from '../../lib/utils'
import { loadData, runAction } from '../../lib/apiCall'
import { cn } from '../../lib/utils'
import { X, Search, RotateCcw, AlertTriangle, CheckCircle, Package, Banknote, RefreshCw } from 'lucide-react'
import type { Vente, LigneVente } from '../../lib/types'

const api = window.api

interface Props {
  currentShift: { id?: string; operateur_nom?: string } | null
  onClose: () => void
  onSuccess: (msg: string) => void
}

type RetourType = 'DEFECTUEUX' | 'SANS_PROBLEME'
type Resolution = 'REMBOURSEMENT' | 'ECHANGE' | 'EN_ATTENTE'

export default function RetourModal({ currentShift, onClose, onSuccess }: Props) {
  const [step, setStep] = useState<'search' | 'select_item' | 'choose_type'>('search')
  const [search, setSearch] = useState('')
  const [ventes, setVentes] = useState<Vente[]>([])
  const [selectedVente, setSelectedVente] = useState<Vente | null>(null)
  const [lignes, setLignes] = useState<LigneVente[]>([])
  const [selectedLigne, setSelectedLigne] = useState<LigneVente | null>(null)
  const [loading, setLoading] = useState(false)
  const [retourType, setRetourType] = useState<RetourType>('SANS_PROBLEME')
  const [resolution, setResolution] = useState<Resolution>('REMBOURSEMENT')
  const [motif, setMotif] = useState('')
  const [qtyRetour, setQtyRetour] = useState(1)
  const [saving, setSaving] = useState(false)

  // Load recent ventes on open
  useEffect(() => {
    const loadRecent = async () => {
      const today = new Date().toISOString().slice(0, 10)
      const r = await loadData('Chargement ventes', () => api.ventesList({ dateFrom: today, dateTo: today + 'T23:59:59' }) as Promise<Vente[]>, { setLoading })
      if (r) setVentes(r.filter(v => v.type === 'VENTE').slice(0, 20))
    }
    loadRecent()
  }, [])

  const handleSearch = async () => {
    if (!search.trim()) return
    const r = await loadData('Recherche ventes', () => api.ventesList({ search: search.trim() }) as Promise<Vente[]>, { setLoading })
    if (r) setVentes(r.filter(v => v.type === 'VENTE').slice(0, 20))
  }

  const selectVente = async (vente: Vente) => {
    setSelectedVente(vente)
    const l = await loadData('Chargement lignes vente', () => api.ventesGetLignes(vente.id) as Promise<LigneVente[]>, { setLoading })
    if (l) {
      setLignes(l)
      setStep('select_item')
    }
  }

  const selectLigne = (ligne: LigneVente) => {
    setSelectedLigne(ligne)
    setQtyRetour(1)
    setStep('choose_type')
  }

  const handleConfirm = async () => {
    if (!selectedLigne) return
    const montant = retourType === 'SANS_PROBLEME' || resolution === 'REMBOURSEMENT'
      ? selectedLigne.prix_unitaire * qtyRetour * (1 - (selectedLigne.remise_pct || 0) / 100)
      : 0
    const msg = retourType === 'SANS_PROBLEME'
      ? `Retour OK: ${selectedLigne.designation} — stock restauré${montant > 0 ? ` + remb. ${formatPrice(montant)}` : ''}`
      : `Retour défectueux: ${selectedLigne.designation} enregistré`
    await runAction('Enregistrement retour', async () => {
      await api.retoursCreate({
        id: generateId(),
        vente_id: selectedVente?.id ?? null,
        vente_numero: selectedVente?.numero ?? null,
        shift_id: currentShift?.id ?? null,
        produit_id: selectedLigne.produit_id ?? null,
        designation: selectedLigne.designation,
        quantite: qtyRetour,
        prix_unitaire: selectedLigne.prix_unitaire,
        motif: motif.trim() || null,
        type_retour: retourType,
        statut: retourType === 'SANS_PROBLEME' ? 'RESOLU' : (resolution === 'EN_ATTENTE' ? 'EN_ATTENTE' : resolution === 'REMBOURSEMENT' ? 'REMBOURSE' : 'ECHANGE'),
        resolution: resolution,
        montant_rembourse: montant,
        operateur: currentShift?.operateur_nom ?? 'superadmin',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      onSuccess(msg)
    }, { setSaving, successMessage: 'Retour enregistré' })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-[560px] max-h-[85vh] flex flex-col animate-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-red-100 flex items-center justify-center">
              <RotateCcw size={18} className="text-red-600" />
            </div>
            <div>
              <h2 className="font-bold text-base">Retour Produit (F9)</h2>
              <p className="text-xs text-text-muted">
                {step === 'search' && 'Sélectionner la vente'}
                {step === 'select_item' && `Vente ${selectedVente?.numero} — choisir l'article`}
                {step === 'choose_type' && `Article : ${selectedLigne?.designation}`}
              </p>
            </div>
          </div>
          <button onClick={onClose}><X size={18} className="text-text-muted" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">

          {/* STEP 1: Search vente */}
          {step === 'search' && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <div className="flex-1 flex items-center gap-2 border border-border rounded-xl px-3 py-2.5 bg-muted focus-within:border-accent-500 focus-within:bg-accent-50 transition-colors">
                  <Search size={14} className="text-text-muted" />
                  <input
                    autoFocus
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSearch()}
                    className="flex-1 bg-transparent text-sm outline-none"
                    placeholder="N° de vente ou nom client..."
                  />
                </div>
                <button onClick={handleSearch} className="px-4 bg-accent-500 hover:bg-accent-600 font-semibold rounded-xl text-sm transition-colors">
                  Chercher
                </button>
              </div>

              <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                {loading ? (
                  <span className="flex items-center gap-2"><RefreshCw size={10} className="animate-spin" /> Chargement...</span>
                ) : `Ventes du jour (${ventes.length})`}
              </div>

              <div className="space-y-2 max-h-80 overflow-y-auto">
                {ventes.map(v => (
                  <button
                    key={v.id}
                    onClick={() => selectVente(v)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-accent-50 hover:border-accent-300 text-left transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm">{v.numero}</div>
                      <div className="text-xs text-text-muted">
                        {new Date(v.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        {v.client_nom && ` — ${v.client_nom}`}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-price font-bold text-sm">{formatPrice(v.total_ttc)}</div>
                      <div className="text-xs text-text-muted">{v.mode_paiement}</div>
                    </div>
                  </button>
                ))}
                {ventes.length === 0 && !loading && (
                  <div className="text-center py-8 text-text-muted text-sm">Aucune vente trouvée</div>
                )}
              </div>
            </div>
          )}

          {/* STEP 2: Select item */}
          {step === 'select_item' && (
            <div className="space-y-3">
              <button onClick={() => setStep('search')} className="text-xs text-text-muted hover:text-text-primary flex items-center gap-1">
                ← Retour à la recherche
              </button>
              <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Articles de la vente</div>
              {lignes.map(ligne => (
                <button
                  key={ligne.id}
                  onClick={() => selectLigne(ligne)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-accent-50 hover:border-accent-300 text-left transition-colors"
                >
                  <Package size={16} className="text-text-muted flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate">{ligne.designation}</div>
                    <div className="text-xs text-text-muted">Qté: {ligne.quantite}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-price font-bold text-sm">{formatPrice(ligne.total_ligne)}</div>
                    <div className="text-xs text-text-muted">{formatPrice(ligne.prix_unitaire)} / u</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* STEP 3: Choose type + resolution */}
          {step === 'choose_type' && selectedLigne && (
            <div className="space-y-5">
              <button onClick={() => setStep('select_item')} className="text-xs text-text-muted hover:text-text-primary flex items-center gap-1">
                ← Retour aux articles
              </button>

              {/* Quantity */}
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-2">Quantité retournée</label>
                <div className="flex items-center gap-3">
                  <button onClick={() => setQtyRetour(Math.max(1, qtyRetour - 1))} className="w-8 h-8 rounded-lg bg-muted hover:bg-border flex items-center justify-center">-</button>
                  <span className="font-price font-bold text-lg w-8 text-center">{qtyRetour}</span>
                  <button onClick={() => setQtyRetour(Math.min(selectedLigne.quantite, qtyRetour + 1))} className="w-8 h-8 rounded-lg bg-muted hover:bg-border flex items-center justify-center">+</button>
                  <span className="text-xs text-text-muted">/ {selectedLigne.quantite} max</span>
                </div>
              </div>

              {/* Type: Défectueux or Sans problème */}
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-2">Type de retour</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setRetourType('SANS_PROBLEME')}
                    className={cn(
                      'p-4 rounded-xl border-2 text-left transition-all',
                      retourType === 'SANS_PROBLEME' ? 'border-green-500 bg-green-50' : 'border-border hover:bg-muted'
                    )}
                  >
                    <CheckCircle size={20} className={cn('mb-2', retourType === 'SANS_PROBLEME' ? 'text-green-600' : 'text-text-muted')} />
                    <div className="font-bold text-sm">Sans problème</div>
                    <div className="text-xs text-text-muted mt-0.5">Produit OK → stock restauré</div>
                  </button>
                  <button
                    onClick={() => setRetourType('DEFECTUEUX')}
                    className={cn(
                      'p-4 rounded-xl border-2 text-left transition-all',
                      retourType === 'DEFECTUEUX' ? 'border-red-500 bg-red-50' : 'border-border hover:bg-muted'
                    )}
                  >
                    <AlertTriangle size={20} className={cn('mb-2', retourType === 'DEFECTUEUX' ? 'text-red-600' : 'text-text-muted')} />
                    <div className="font-bold text-sm">Défectueux</div>
                    <div className="text-xs text-text-muted mt-0.5">Produit en attente fournisseur</div>
                  </button>
                </div>
              </div>

              {/* Resolution */}
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-2">Résolution</label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { id: 'REMBOURSEMENT', label: 'Remboursement', icon: <Banknote size={14} /> },
                    { id: 'ECHANGE', label: 'Échange produit', icon: <RefreshCw size={14} /> },
                    { id: 'EN_ATTENTE', label: 'En attente', icon: <AlertTriangle size={14} /> },
                  ] as { id: Resolution; label: string; icon: React.ReactNode }[]).map(r => (
                    <button
                      key={r.id}
                      onClick={() => setResolution(r.id)}
                      className={cn(
                        'p-2.5 rounded-xl border-2 flex flex-col items-center gap-1 text-xs font-semibold transition-all',
                        resolution === r.id ? 'border-accent-500 bg-accent-50 text-text-primary' : 'border-border hover:bg-muted text-text-secondary'
                      )}
                    >
                      {r.icon}
                      <span className="text-center leading-tight">{r.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Summary */}
              <div className={cn(
                'rounded-xl p-4 border',
                retourType === 'SANS_PROBLEME' ? 'bg-green-50 border-green-200' : 'bg-orange-50 border-orange-200'
              )}>
                <div className="font-semibold text-sm mb-2">Résumé du retour</div>
                <div className="text-xs space-y-1 text-text-secondary">
                  <div className="flex justify-between">
                    <span>Article :</span>
                    <span className="font-medium truncate ml-2 max-w-[200px]">{selectedLigne.designation}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Quantité :</span>
                    <span className="font-medium">{qtyRetour}</span>
                  </div>
                  {retourType === 'SANS_PROBLEME' && (
                    <div className="flex justify-between text-green-700 font-semibold">
                      <span>Stock restauré :</span>
                      <span>+{qtyRetour}</span>
                    </div>
                  )}
                  {resolution === 'REMBOURSEMENT' && (
                    <div className="flex justify-between text-red-700 font-semibold">
                      <span>Remboursement caisse :</span>
                      <span className="font-price">{formatPrice(selectedLigne.prix_unitaire * qtyRetour * (1 - (selectedLigne.remise_pct || 0) / 100))}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Motif */}
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1">Motif (optionnel)</label>
                <input
                  value={motif}
                  onChange={e => setMotif(e.target.value)}
                  className="w-full border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent-500"
                  placeholder="Raison du retour..."
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-border flex-shrink-0">
          <button type="button" onClick={onClose} className="flex-1 bg-muted hover:bg-border font-semibold py-2.5 rounded-xl text-sm transition-colors">
            Annuler
          </button>
          {step === 'choose_type' && (
            <button
              type="button"
              onClick={handleConfirm}
              disabled={saving}
              className="flex-1 bg-red-500 hover:bg-red-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold py-2.5 rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
            >
              <RotateCcw size={14} />
              {saving ? 'Enregistrement...' : 'Confirmer le retour'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

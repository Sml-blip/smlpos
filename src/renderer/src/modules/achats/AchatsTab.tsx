import { useState, useEffect, useCallback, useMemo } from 'react'
import Fuse from 'fuse.js'
import type { Fournisseur, FactureFournisseur, Produit } from '../../lib/types'
import { formatPrice, generateId, generateReference } from '../../lib/utils'
import { cn } from '../../lib/utils'
import { runAction, loadData } from '../../lib/apiCall'
import { printLabelHtml } from '../../lib/nativePrint'
import { code128Svg } from '../../lib/barcode'
import {
  Plus, Search, Truck, FileText, Clock, CheckCircle,
  AlertTriangle, X, ChevronRight, DollarSign, Package,
  RefreshCw, Edit2, PackageCheck, Inbox, InboxIcon, Printer,
  Barcode, Tag, BarChart2
} from 'lucide-react'

const api = window.api

type Tab = 'fournisseurs' | 'factures' | 'echeancier'

const STATUT_LABELS: Record<string, string> = {
  EN_ATTENTE: 'En attente',
  PARTIEL: 'Partiel',
  PAYE: 'Payé',
  EN_RETARD: 'En retard',
}

const STATUT_COLORS: Record<string, string> = {
  EN_ATTENTE: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  PARTIEL: 'bg-blue-100 text-blue-800 border-blue-300',
  PAYE: 'bg-green-100 text-green-800 border-green-300',
  EN_RETARD: 'bg-red-100 text-red-800 border-red-300',
}

export default function AchatsTab() {
  const [activeTab, setActiveTab] = useState<Tab>('fournisseurs')
  const [fournisseurs, setFournisseurs] = useState<Fournisseur[]>([])
  const [factures, setFactures] = useState<FactureFournisseur[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [showFournisseurModal, setShowFournisseurModal] = useState(false)
  const [showFactureModal, setShowFactureModal] = useState(false)
  const [editingFournisseur, setEditingFournisseur] = useState<Fournisseur | null>(null)
  const [showPaiementModal, setShowPaiementModal] = useState<FactureFournisseur | null>(null)
  const [factureFilter, setFactureFilter] = useState<'tous' | 'arrivees' | 'en_attente'>('tous')

  const loadFournisseurs = useCallback(async () => {
    const data = await loadData('Chargement fournisseurs', async () => {
      const [f, fac] = await Promise.all([
        api.fournisseursList({ search: search || undefined }) as Promise<Fournisseur[]>,
        api.facturesFournisseursList({}) as Promise<FactureFournisseur[]>,
      ])
      return { f, fac }
    }, { setLoading })
    if (data) {
      setFournisseurs(data.f)
      setFactures(data.fac)
    }
  }, [search])

  useEffect(() => { loadFournisseurs() }, [loadFournisseurs])

  const totalDu = fournisseurs.reduce((s, f) => s + (f.solde_du || 0), 0)
  const facturesEnRetard = factures.filter(f => {
    if (f.statut_paiement === 'PAYE') return false
    if (!f.date_echeance) return false
    return new Date(f.date_echeance) < new Date()
  })
  const facturesUrgentes = factures.filter(f => {
    if (f.statut_paiement === 'PAYE') return false
    if (!f.date_echeance) return false
    const diff = (new Date(f.date_echeance).getTime() - Date.now()) / 86400000
    return diff >= 0 && diff <= 7
  })

  return (
    <div className="h-full flex flex-col overflow-hidden bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-border flex-shrink-0">
        <h2 className="font-bold text-sm text-text-primary flex items-center gap-2">
          <Truck size={15} /> Achats & Fournisseurs
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setEditingFournisseur(null); setShowFournisseurModal(true) }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-muted hover:bg-border rounded-lg text-sm font-semibold text-text-primary transition-colors"
          >
            <Plus size={14} /> Fournisseur
          </button>
          <button
            onClick={() => setShowFactureModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-500 hover:bg-accent-600 rounded-lg text-sm font-bold text-text-primary transition-colors"
          >
            <Plus size={14} /> Nouvelle Facture
          </button>
        </div>
      </div>

      {/* Alerts */}
      {(facturesEnRetard.length > 0 || facturesUrgentes.length > 0) && (
        <div className="px-4 py-2 bg-white border-b border-border flex-shrink-0 space-y-1.5">
          {facturesEnRetard.map(f => (
            <div key={f.id} className="flex items-center gap-2 text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertTriangle size={12} className="flex-shrink-0" />
              <span><strong>{f.fournisseur_nom}</strong> — {f.numero_facture} — <strong className="font-price">{formatPrice(f.montant_restant ?? (f.montant_ttc - f.montant_paye))}</strong> — En retard</span>
            </div>
          ))}
          {facturesUrgentes.map(f => (
            <div key={f.id} className="flex items-center gap-2 text-xs text-yellow-800 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
              <Clock size={12} className="flex-shrink-0" />
              <span><strong>{f.fournisseur_nom}</strong> — {f.numero_facture} — <strong className="font-price">{formatPrice(f.montant_restant ?? (f.montant_ttc - f.montant_paye))}</strong> — Échéance dans ≤7j</span>
            </div>
          ))}
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-4 gap-3 px-4 py-3 flex-shrink-0">
        <div className="bg-white rounded-xl border border-border p-3 shadow-card">
          <div className="text-xs text-text-secondary font-semibold flex items-center gap-1"><Truck size={11} /> Fournisseurs</div>
          <div className="text-xl font-bold mt-1">{fournisseurs.length}</div>
        </div>
        <div className="bg-white rounded-xl border border-border p-3 shadow-card">
          <div className="text-xs text-text-secondary font-semibold flex items-center gap-1"><FileText size={11} /> Factures</div>
          <div className="text-xl font-bold mt-1">{factures.length}</div>
        </div>
        <div className="bg-red-50 border-red-200 rounded-xl border p-3 shadow-card">
          <div className="text-xs text-red-700 font-semibold flex items-center gap-1"><DollarSign size={11} /> Total dû</div>
          <div className="text-lg font-bold font-price mt-1 text-red-800">{formatPrice(totalDu)}</div>
        </div>
        <div className="bg-yellow-50 border-yellow-200 rounded-xl border p-3 shadow-card">
          <div className="text-xs text-yellow-700 font-semibold flex items-center gap-1"><AlertTriangle size={11} /> Alertes</div>
          <div className="text-xl font-bold mt-1 text-yellow-800">{facturesEnRetard.length + facturesUrgentes.length}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0 bg-white border-b border-border px-4 flex-shrink-0">
        {([
          { id: 'fournisseurs', label: 'Fournisseurs', icon: Truck },
          { id: 'factures', label: 'Factures', icon: FileText },
          { id: 'echeancier', label: 'Échéancier', icon: Clock },
        ] as const).map(t => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all',
                activeTab === t.id
                  ? 'border-accent-500 text-text-primary bg-accent-50'
                  : 'border-transparent text-text-secondary hover:text-text-primary hover:bg-muted'
              )}
            >
              <Icon size={14} /> {t.label}
            </button>
          )
        })}
        <div className="ml-auto flex items-center gap-2 pb-1">
          <div className="flex items-center gap-1.5 border border-border rounded-lg px-3 py-1.5 bg-muted">
            <Search size={13} className="text-text-muted" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-transparent outline-none text-sm w-36"
              placeholder="Rechercher..."
            />
          </div>
          <button onClick={loadFournisseurs} disabled={loading} className="p-1.5 text-text-muted hover:text-text-primary rounded-lg hover:bg-muted transition-colors">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Facture filter bar */}
      {activeTab === 'factures' && (
        <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-border flex-shrink-0">
          <span className="text-xs text-text-secondary font-semibold mr-1">Afficher :</span>
          {([
            { id: 'tous', label: 'Toutes', count: factures.length },
            { id: 'arrivees', label: 'Factures reçues', count: factures.filter(f => !f.type || f.type === 'FACTURE_ACHAT' || f.statut_reception === 'ARRIVE').length },
            { id: 'en_attente', label: 'BL en attente', count: factures.filter(f => f.type === 'FACTURE_ACHAT_BL' && f.statut_reception !== 'ARRIVE').length },
          ] as const).map(opt => (
            <button
              key={opt.id}
              onClick={() => setFactureFilter(opt.id)}
              className={cn('flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full border transition-all',
                factureFilter === opt.id
                  ? opt.id === 'en_attente' ? 'bg-blue-100 text-blue-800 border-blue-300' : 'bg-accent-500 text-black border-accent-500'
                  : 'bg-white text-text-secondary border-border hover:bg-muted'
              )}
            >
              {opt.label}
              <span className={cn('text-[10px] font-bold rounded-full px-1.5 py-0.5', factureFilter === opt.id ? 'bg-black/10' : 'bg-muted')}>
                {opt.count}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'fournisseurs' && (
          <FournisseursTable
            fournisseurs={fournisseurs}
            onEdit={f => { setEditingFournisseur(f); setShowFournisseurModal(true) }}
          />
        )}
        {activeTab === 'factures' && (() => {
          const filtered = factureFilter === 'arrivees'
            ? factures.filter(f => !f.type || f.type === 'FACTURE_ACHAT' || f.statut_reception === 'ARRIVE')
            : factureFilter === 'en_attente'
              ? factures.filter(f => f.type === 'FACTURE_ACHAT_BL' && f.statut_reception !== 'ARRIVE')
              : factures
          return (
            <FacturesTable
              factures={filtered}
              onPayer={f => setShowPaiementModal(f)}
              onMarquerRecu={async (f) => {
                const ok = await runAction('Réception marchandise', async () => {
                  await api.facturesFournisseursMarquerRecu(f.id)
                }, { successMessage: 'Marchandise marquée comme reçue' })
                if (ok) loadFournisseurs()
              }}
            />
          )
        })()}
        {activeTab === 'echeancier' && (
          <EcheancierTable factures={factures} onPayer={f => setShowPaiementModal(f)} />
        )}
      </div>

      {/* Modals */}
      {showFournisseurModal && (
        <FournisseurModal
          fournisseur={editingFournisseur}
          onClose={() => setShowFournisseurModal(false)}
          onSaved={loadFournisseurs}
        />
      )}
      {showFactureModal && (
        <FactureFournisseurModal
          fournisseurs={fournisseurs}
          onClose={() => setShowFactureModal(false)}
          onSaved={loadFournisseurs}
        />
      )}
      {showPaiementModal && (
        <PaiementModal
          facture={showPaiementModal}
          onClose={() => setShowPaiementModal(null)}
          onSaved={loadFournisseurs}
        />
      )}
    </div>
  )
}

// ── Fournisseurs Table ────────────────────────────────────────────────────────
function FournisseursTable({ fournisseurs, onEdit }: { fournisseurs: Fournisseur[]; onEdit: (f: Fournisseur) => void }) {
  if (fournisseurs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-text-muted">
        <Truck size={40} className="mb-3 opacity-30" />
        <p className="text-sm">Aucun fournisseur. Ajoutez-en un.</p>
      </div>
    )
  }
  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden shadow-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted border-b border-border text-text-secondary text-xs uppercase tracking-wider">
            <th className="px-4 py-3 text-left font-semibold">Fournisseur</th>
            <th className="px-4 py-3 text-left font-semibold">Contact</th>
            <th className="px-4 py-3 text-left font-semibold">Téléphone</th>
            <th className="px-4 py-3 text-right font-semibold">Solde dû</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {fournisseurs.map(f => (
            <tr key={f.id} className="border-b border-border hover:bg-muted transition-colors last:border-0">
              <td className="px-4 py-3">
                <div className="font-semibold text-text-primary">{f.nom}</div>
                {f.matricule_fiscal && <div className="text-xs text-text-muted">MF: {f.matricule_fiscal}</div>}
              </td>
              <td className="px-4 py-3 text-text-secondary">{f.contact_nom || '—'}</td>
              <td className="px-4 py-3 text-text-secondary">{f.telephone || '—'}</td>
              <td className="px-4 py-3 text-right">
                <span className={cn('font-price font-bold', f.solde_du > 0 ? 'text-danger' : 'text-success')}>
                  {formatPrice(f.solde_du)}
                </span>
              </td>
              <td className="px-4 py-3 text-right">
                <button onClick={() => onEdit(f)} className="text-text-muted hover:text-text-primary transition-colors">
                  <Edit2 size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Factures Table ────────────────────────────────────────────────────────────
function FacturesTable({ factures, onPayer, onMarquerRecu }: { factures: FactureFournisseur[]; onPayer: (f: FactureFournisseur) => void; onMarquerRecu: (f: FactureFournisseur) => void }) {
  if (factures.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-text-muted">
        <FileText size={40} className="mb-3 opacity-30" />
        <p className="text-sm">Aucune facture fournisseur.</p>
      </div>
    )
  }
  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden shadow-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted border-b border-border text-text-secondary text-xs uppercase tracking-wider">
            <th className="px-4 py-3 text-left font-semibold">N° Facture</th>
            <th className="px-4 py-3 text-left font-semibold">Fournisseur</th>
            <th className="px-4 py-3 text-left font-semibold">Type</th>
            <th className="px-4 py-3 text-left font-semibold">Date</th>
            <th className="px-4 py-3 text-left font-semibold">Échéance</th>
            <th className="px-4 py-3 text-right font-semibold">Montant TTC</th>
            <th className="px-4 py-3 text-right font-semibold">Restant</th>
            <th className="px-4 py-3 text-center font-semibold">Statut</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {factures.map(f => {
            const restant = f.montant_restant ?? (f.montant_ttc - f.montant_paye)
            const isBL = f.type === 'FACTURE_ACHAT_BL'
            const notReceived = isBL && f.statut_reception !== 'ARRIVE'
            return (
              <tr key={f.id} className={cn('border-b border-border hover:bg-muted transition-colors last:border-0', notReceived && 'bg-blue-50/40')}>
                <td className="px-4 py-3 font-mono text-xs font-semibold">{f.numero_facture}</td>
                <td className="px-4 py-3 font-medium">{f.fournisseur_nom}</td>
                <td className="px-4 py-3">
                  {isBL
                    ? <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-blue-100 text-blue-800 border border-blue-300">BL</span>
                    : <span className="text-xs text-text-muted">Facture</span>
                  }
                </td>
                <td className="px-4 py-3 text-text-secondary text-xs">{f.date_facture}</td>
                <td className="px-4 py-3 text-xs">
                  {f.date_echeance
                    ? <span className={new Date(f.date_echeance) < new Date() && f.statut_paiement !== 'PAYE' ? 'text-danger font-semibold' : 'text-text-secondary'}>{f.date_echeance}</span>
                    : <span className="text-text-muted">—</span>
                  }
                </td>
                <td className="px-4 py-3 text-right font-price font-semibold">{formatPrice(f.montant_ttc)}</td>
                <td className="px-4 py-3 text-right font-price font-bold text-danger">{restant > 0 ? formatPrice(restant) : '—'}</td>
                <td className="px-4 py-3 text-center">
                  <span className={cn('text-xs px-2 py-0.5 rounded-full border font-semibold', STATUT_COLORS[f.statut_paiement])}>
                    {STATUT_LABELS[f.statut_paiement]}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    {notReceived && (
                      <button
                        onClick={() => onMarquerRecu(f)}
                        className="flex items-center gap-1 text-xs px-2.5 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-semibold transition-colors"
                      >
                        <PackageCheck size={11} /> Reçu
                      </button>
                    )}
                    {f.statut_paiement !== 'PAYE' && (
                      <button
                        onClick={() => onPayer(f)}
                        className="flex items-center gap-1 text-xs px-2.5 py-1 bg-accent-500 hover:bg-accent-600 rounded-lg font-semibold transition-colors"
                      >
                        <DollarSign size={11} /> Payer
                      </button>
                    )}
                    {f.statut_paiement === 'PAYE' && !notReceived && <CheckCircle size={14} className="text-success" />}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Échéancier Table ──────────────────────────────────────────────────────────
function EcheancierTable({ factures, onPayer }: { factures: FactureFournisseur[]; onPayer: (f: FactureFournisseur) => void }) {
  const pending = factures
    .filter(f => f.statut_paiement !== 'PAYE' && f.date_echeance)
    .sort((a, b) => new Date(a.date_echeance!).getTime() - new Date(b.date_echeance!).getTime())

  if (pending.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-text-muted">
        <CheckCircle size={40} className="mb-3 opacity-30 text-success" />
        <p className="text-sm font-semibold text-success">Aucune échéance en attente !</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {pending.map(f => {
        const restant = f.montant_restant ?? (f.montant_ttc - f.montant_paye)
        const daysLeft = Math.ceil((new Date(f.date_echeance!).getTime() - Date.now()) / 86400000)
        const isLate = daysLeft < 0
        const isUrgent = daysLeft >= 0 && daysLeft <= 7
        return (
          <div key={f.id} className={cn('bg-white rounded-xl border p-4 shadow-card', isLate ? 'border-red-300' : isUrgent ? 'border-yellow-300' : 'border-border')}>
            <div className="flex items-start justify-between">
              <div>
                <div className="font-bold text-text-primary">{f.fournisseur_nom}</div>
                <div className="text-xs text-text-muted font-mono">{f.numero_facture}</div>
              </div>
              <div className="text-right">
                <div className="font-price font-bold text-danger text-lg">{formatPrice(restant)}</div>
                <div className={cn('text-xs font-semibold', isLate ? 'text-danger' : isUrgent ? 'text-warning' : 'text-text-secondary')}>
                  {isLate ? `En retard de ${Math.abs(daysLeft)}j` : `Dans ${daysLeft}j — ${f.date_echeance}`}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between mt-3">
              <span className={cn('text-xs px-2 py-0.5 rounded-full border font-semibold', STATUT_COLORS[f.statut_paiement])}>
                {STATUT_LABELS[f.statut_paiement]}
              </span>
              <button
                onClick={() => onPayer(f)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-accent-500 hover:bg-accent-600 rounded-lg font-bold transition-colors"
              >
                <DollarSign size={12} /> Enregistrer paiement
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Fournisseur Modal ─────────────────────────────────────────────────────────
function FournisseurModal({ fournisseur, onClose, onSaved }: { fournisseur: Fournisseur | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    nom: fournisseur?.nom ?? '',
    contact_nom: fournisseur?.contact_nom ?? '',
    telephone: fournisseur?.telephone ?? '',
    email: fournisseur?.email ?? '',
    adresse: fournisseur?.adresse ?? '',
    matricule_fiscal: fournisseur?.matricule_fiscal ?? '',
    rib: fournisseur?.rib ?? '',
    notes: fournisseur?.notes ?? '',
  })
  const [loading, setLoading] = useState(false)

  const f = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [field]: e.target.value }))

  const handleSave = async () => {
    if (!form.nom.trim()) return
    const ok = await runAction(
      fournisseur ? 'Mise à jour fournisseur' : 'Création fournisseur',
      async () => {
        if (fournisseur) {
          await api.fournisseursUpdate(fournisseur.id, form)
        } else {
          await api.fournisseursCreate({ ...form, id: generateId(), created_at: new Date().toISOString() })
        }
      },
      {
        setLoading,
        successMessage: fournisseur ? 'Fournisseur mis à jour' : 'Fournisseur créé',
      }
    )
    if (ok) {
      onSaved()
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg animate-slide-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-bold text-base flex items-center gap-2">
            <Truck size={15} /> {fournisseur ? 'Modifier fournisseur' : 'Nouveau fournisseur'}
          </h2>
          <button onClick={onClose}><X size={18} className="text-text-muted" /></button>
        </div>
        <div className="p-6 grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-text-secondary mb-1">Nom / Raison sociale *</label>
            <input value={form.nom} onChange={f('nom')} className="w-full border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-accent-500" placeholder="Nom du fournisseur" autoFocus />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">Nom contact</label>
            <input value={form.contact_nom} onChange={f('contact_nom')} className="w-full border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-accent-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">Téléphone</label>
            <input value={form.telephone} onChange={f('telephone')} className="w-full border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-accent-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">Email</label>
            <input value={form.email} onChange={f('email')} type="email" className="w-full border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-accent-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">Matricule fiscal</label>
            <input value={form.matricule_fiscal} onChange={f('matricule_fiscal')} className="w-full border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-accent-500" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-text-secondary mb-1">Adresse</label>
            <input value={form.adresse} onChange={f('adresse')} className="w-full border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-accent-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">RIB</label>
            <input value={form.rib} onChange={f('rib')} className="w-full border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-accent-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">Notes</label>
            <input value={form.notes} onChange={f('notes')} className="w-full border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-accent-500" />
          </div>
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-border">
          <button type="button" onClick={onClose} className="flex-1 bg-muted hover:bg-border text-text-primary font-semibold py-2.5 rounded-xl text-sm transition-colors">Annuler</button>
          <button type="button" onClick={handleSave} disabled={loading || !form.nom.trim()} className="flex-1 bg-accent-500 hover:bg-accent-600 disabled:bg-gray-200 disabled:text-gray-400 text-text-primary font-bold py-2.5 rounded-xl text-sm transition-colors">
            {loading ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Full New Product Modal (mirrors InventaireTab form) ───────────────────────
interface FullProductFormData {
  code_barre: string
  reference: string
  nom: string
  description: string
  categorie: string
  type: 'F' | 'NF'
  prix_achat: string
  cout_supplementaire: string
  tva_achat_pct: string
  marge_pct: string
  coef_av: string
  prix_vente: string
  tva_taux: string
  stock_actuel: string
  stock_minimum: string
  fournisseur: string
  numero_serie: string
}

const emptyFullForm = (): FullProductFormData => ({
  code_barre: '',
  reference: generateReference(),
  nom: '',
  description: '',
  categorie: 'Général',
  type: 'F',
  prix_achat: '',
  cout_supplementaire: '0',
  tva_achat_pct: '0',
  marge_pct: '',
  coef_av: '',
  prix_vente: '',
  tva_taux: '0',
  stock_actuel: '0',
  stock_minimum: '5',
  fournisseur: '',
  numero_serie: '',
})

function NewProductModal({ onClose, onCreated }: {
  onClose: () => void
  onCreated: (p: Produit) => Promise<void>
}) {
  const [formData, setFormData] = useState<FullProductFormData>(emptyFullForm())
  const [formErrors, setFormErrors] = useState<Partial<FullProductFormData>>({})
  const [saving, setSaving] = useState(false)
  const [categories, setCategories] = useState<string[]>(['Général', 'Électronique', 'Informatique', 'Accessoires', 'Pièces', 'Consommables', 'Autre'])
  const [showCatModal, setShowCatModal] = useState(false)
  const [newCatNom, setNewCatNom] = useState('')
  const [newCatIcone, setNewCatIcone] = useState('📦')

  useEffect(() => {
    void loadData('Chargement catégories', async () => {
      const list = await api.categoriesList()
      const names = (list as { nom: string }[]).map(c => c.nom).filter(Boolean)
      if (names.length > 0) setCategories(names)
    }, { silent: true })
  }, [])

  const f = (key: keyof FullProductFormData, val: string) => {
    setFormData(prev => ({ ...prev, [key]: val }))
    if (formErrors[key]) setFormErrors(prev => ({ ...prev, [key]: undefined }))
  }

  const computePricing = (data: FullProductFormData) => {
    const prixAchatHT = parseFloat(data.prix_achat) || 0
    const coutSupp = parseFloat(data.cout_supplementaire) || 0
    const tvaAchat = parseFloat(data.tva_achat_pct) || 0
    const tvaTaux = parseFloat(data.tva_taux) || 0
    const coutRevient = prixAchatHT + coutSupp
    const prixAchatTTC = coutRevient * (1 + tvaAchat / 100)
    const prixVente = parseFloat(data.prix_vente) || 0
    const prixVenteHT = tvaTaux > 0 ? prixVente / (1 + tvaTaux / 100) : prixVente
    const coef = coutRevient > 0 ? prixVenteHT / coutRevient : 0
    const marge = (coef - 1) * 100
    const isBelowCost = coutRevient > 0 && prixVente < prixAchatTTC
    return { coutRevient, prixAchatTTC, prixVenteHT, coef, marge, isBelowCost }
  }

  const onMargePctChange = (val: string) => {
    const marge = parseFloat(val)
    const coutRevient = (parseFloat(formData.prix_achat) || 0) + (parseFloat(formData.cout_supplementaire) || 0)
    const tvaTaux = parseFloat(formData.tva_taux) || 0
    const newCoef = 1 + marge / 100
    const pvHT = coutRevient * newCoef
    const pvTTC = pvHT * (1 + tvaTaux / 100)
    setFormData(prev => ({
      ...prev, marge_pct: val,
      coef_av: isNaN(newCoef) ? '' : newCoef.toFixed(4),
      prix_vente: isNaN(pvTTC) || coutRevient === 0 ? prev.prix_vente : pvTTC.toFixed(3),
    }))
  }

  const onCoefAvChange = (val: string) => {
    const coef = parseFloat(val)
    const coutRevient = (parseFloat(formData.prix_achat) || 0) + (parseFloat(formData.cout_supplementaire) || 0)
    const tvaTaux = parseFloat(formData.tva_taux) || 0
    const newMarge = (coef - 1) * 100
    const pvTTC = coutRevient * coef * (1 + tvaTaux / 100)
    setFormData(prev => ({
      ...prev, coef_av: val,
      marge_pct: isNaN(newMarge) ? '' : newMarge.toFixed(2),
      prix_vente: isNaN(pvTTC) || coutRevient === 0 ? prev.prix_vente : pvTTC.toFixed(3),
    }))
  }

  const onPrixVenteChange = (val: string) => {
    const pv = parseFloat(val) || 0
    const coutRevient = (parseFloat(formData.prix_achat) || 0) + (parseFloat(formData.cout_supplementaire) || 0)
    const tvaTaux = parseFloat(formData.tva_taux) || 0
    const pvHT = tvaTaux > 0 ? pv / (1 + tvaTaux / 100) : pv
    const coef = coutRevient > 0 ? pvHT / coutRevient : 0
    const marge = (coef - 1) * 100
    setFormData(prev => ({
      ...prev, prix_vente: val,
      coef_av: coutRevient > 0 && !isNaN(coef) ? coef.toFixed(4) : prev.coef_av,
      marge_pct: coutRevient > 0 && !isNaN(marge) ? marge.toFixed(2) : prev.marge_pct,
    }))
    if (formErrors.prix_vente) setFormErrors(prev => ({ ...prev, prix_vente: undefined }))
  }

  const generateBarcode = async () => {
    await runAction('Génération code-barres', async () => {
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      let code = '', unique = false, attempts = 0
      while (!unique && attempts < 10) {
        const rand = String(Math.floor(Math.random() * 99999)).padStart(5, '0')
        code = `SML-${date}-${rand}`
        const res = await api.produitsCheckBarcodeUnique(code, undefined)
        unique = res.unique
        attempts++
      }
      if (!unique) throw new Error('impossible de générer un code unique')
      f('code_barre', code)
    })
  }

  const handleSaveCat = async () => {
    const nom = newCatNom.trim()
    if (!nom) return
    const ok = await runAction('Création catégorie', async () => {
      const id = `cat-${generateId().slice(0, 8)}`
      await api.categoriesCreate({ id, nom, icone: newCatIcone })
      setCategories(prev => [...prev, nom].sort())
      f('categorie', nom)
      setNewCatNom('')
      setShowCatModal(false)
    }, { successMessage: 'Catégorie créée' })
    if (!ok) return
  }

  const handleSave = async () => {
    const errors: Partial<FullProductFormData> = {}
    if (!formData.nom.trim()) errors.nom = 'Obligatoire'
    if (!formData.reference.trim()) errors.reference = 'Obligatoire'
    if (!formData.prix_vente || parseFloat(formData.prix_vente) < 0) errors.prix_vente = 'Prix invalide'
    setFormErrors(errors)
    if (Object.keys(errors).length > 0) return

    const ok = await runAction('Création produit', async () => {
      const now = new Date().toISOString()
      const prixAchatHT = parseFloat(formData.prix_achat) || 0
      const coutSupp = parseFloat(formData.cout_supplementaire) || 0
      const tvaAchatPct = parseFloat(formData.tva_achat_pct) || 0
      const tvaTaux = parseFloat(formData.tva_taux) || 0
      const coutDeRevient = prixAchatHT + coutSupp
      const margePct = formData.marge_pct ? parseFloat(formData.marge_pct) : null
      const coefAv = formData.coef_av ? parseFloat(formData.coef_av) : null
      const prixVente = parseFloat(formData.prix_vente) || 0
      const prixVenteHT = tvaTaux > 0 ? prixVente / (1 + tvaTaux / 100) : prixVente
      const p = {
        id: generateId(),
        code_barre: formData.code_barre.trim() || null,
        reference: formData.reference.trim(),
        nom: formData.nom.trim(),
        description: formData.description.trim() || null,
        categorie: formData.categorie,
        type: formData.type,
        prix_achat: prixAchatHT || null,
        cout_supplementaire: coutSupp,
        tva_achat_pct: tvaAchatPct,
        marge_pct: margePct,
        coef_av: coefAv,
        cout_de_revient: coutDeRevient > 0 ? coutDeRevient : null,
        prix_vente_ht: prixVenteHT > 0 ? prixVenteHT : null,
        prix_vente: prixVente,
        tva_taux: tvaTaux,
        prix_achat_ttc: coutDeRevient > 0 ? coutDeRevient * (1 + tvaAchatPct / 100) : null,
        stock_actuel: parseInt(formData.stock_actuel) || 0,
        stock_minimum: parseInt(formData.stock_minimum) || 5,
        fournisseur: formData.fournisseur.trim() || null,
        numero_serie: formData.numero_serie.trim() || null,
        has_serial_number: 0,
        actif: 1,
        created_at: now,
        updated_at: now,
      }
      await api.produitsCreate(p)
      await onCreated(p as Produit)
    }, { setSaving, successMessage: 'Produit créé' })
    if (ok) onClose()
  }

  const pricing = computePricing(formData)

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[110] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto animate-slide-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-white z-10">
          <h2 className="font-bold flex items-center gap-2">
            <Package size={16} /> Nouveau produit
          </h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Référence — FIRST (spec: référence en premier) */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Référence <span className="text-danger">*</span></label>
              <input
                value={formData.reference}
                onChange={e => f('reference', e.target.value)}
                className={cn('w-full border rounded-lg px-3 py-2 text-sm font-mono', formErrors.reference ? 'border-danger' : 'border-border')}
                placeholder="PRD-..."
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Nom <span className="text-danger">*</span></label>
              <input
                value={formData.nom}
                onChange={e => f('nom', e.target.value)}
                className={cn('w-full border rounded-lg px-3 py-2 text-sm', formErrors.nom ? 'border-danger' : 'border-border')}
                placeholder="Nom du produit"
              />
              {formErrors.nom && <p className="text-xs text-danger mt-1">{formErrors.nom}</p>}
            </div>
          </div>

          {/* Code-barre + N° Série (same line) + Catégorie */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Code-barres + N° Série</label>
              <div className="flex gap-1.5">
                <input
                  value={formData.code_barre}
                  onChange={e => f('code_barre', e.target.value)}
                  className="flex-1 border border-border rounded-lg px-3 py-2 text-sm font-mono"
                  placeholder="EAN-13 / SML-..."
                />
                <button type="button" onClick={generateBarcode} title="Générer code-barres unique"
                  className="px-2 py-1 border border-border rounded-lg text-text-muted hover:text-accent-600 hover:bg-accent-50 transition-colors">
                  <Barcode size={14} />
                </button>
              </div>
              <input
                value={formData.numero_serie ?? ''}
                onChange={e => f('numero_serie', e.target.value)}
                className="mt-1.5 w-full border border-border rounded-lg px-3 py-2 text-sm font-mono"
                placeholder="Numéro de série (optionnel)"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Catégorie</label>
              <div className="flex gap-1.5">
                <select value={formData.categorie} onChange={e => f('categorie', e.target.value)}
                  className="flex-1 border border-border rounded-lg px-3 py-2 text-sm">
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <button type="button" onClick={() => { setNewCatNom(''); setNewCatIcone('📦'); setShowCatModal(true) }}
                  title="Nouvelle catégorie"
                  className="px-2 py-1 border border-border rounded-lg text-text-muted hover:text-accent-600 hover:bg-accent-50 transition-colors">
                  <Tag size={14} />
                </button>
              </div>
            </div>
          </div>

          {/* Type */}
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-2">Type de facturation</label>
            <div className="flex gap-3">
              <button onClick={() => f('type', 'F')} className={cn('flex-1 py-2.5 rounded-xl border-2 text-sm font-semibold transition-colors', formData.type === 'F' ? 'border-green-400 bg-green-50 text-green-700' : 'border-border hover:bg-muted')}>
                🟢 Facturé (F)
              </button>
              <button onClick={() => f('type', 'NF')} className={cn('flex-1 py-2.5 rounded-xl border-2 text-sm font-semibold transition-colors', formData.type === 'NF' ? 'border-red-400 bg-red-50 text-red-700' : 'border-border hover:bg-muted')}>
                🔴 Non Facturé (NF)
              </button>
            </div>
          </div>

          {/* Pricing */}
          <div className="border border-border rounded-xl overflow-hidden">
            <div className="bg-blue-50 border-b border-border px-4 py-2">
              <span className="text-[11px] font-bold text-blue-700 uppercase tracking-wider">Côté Achat</span>
            </div>
            <div className="grid grid-cols-4 gap-3 p-4 border-b border-border">
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">Prix Achat HT (DT)</label>
                <input type="text" inputMode="decimal" value={formData.prix_achat} onChange={e => f('prix_achat', e.target.value.replace(/[^0-9.,]/g, ''))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm font-price"
                  placeholder="0.000" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">Coût suppl. (DT)</label>
                <input type="text" inputMode="decimal" value={formData.cout_supplementaire} onChange={e => f('cout_supplementaire', e.target.value.replace(/[^0-9.,]/g, ''))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm font-price"
                  placeholder="0.000" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">Coût de revient</label>
                <div className="border border-blue-200 bg-blue-50 rounded-lg px-3 py-2 text-sm font-price font-bold text-blue-800">
                  {formatPrice(pricing.coutRevient)}
                </div>
                <p className="text-[10px] text-text-muted mt-0.5">Auto-calculé</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">TVA Achat (%)</label>
                <div className="flex gap-1 flex-wrap">
                  {['0','7','13','19'].map(v => (
                    <button key={v} type="button" onClick={() => f('tva_achat_pct', v)}
                      className={cn('px-2 py-1 rounded text-xs font-price border transition-colors',
                        formData.tva_achat_pct === v ? 'bg-blue-500 text-white border-blue-500' : 'border-border hover:bg-muted'
                      )}>{v}%</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 px-4 pb-3 pt-1 border-b border-border">
              <div>
                <label className="block text-xs font-semibold text-blue-700 mb-1">Prix Achat TTC (DT) ✅</label>
                <div className="border border-blue-300 bg-blue-50 rounded-lg px-3 py-2 text-sm font-price font-bold text-blue-800">
                  {formatPrice(pricing.prixAchatTTC)}
                </div>
                <p className="text-[10px] text-text-muted mt-0.5">= HT × (1 + TVA Achat)</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-green-700 mb-1">Prix Vente HT (DT) ✅</label>
                <div className="border border-green-300 bg-green-50 rounded-lg px-3 py-2 text-sm font-price font-bold text-green-800">
                  {formatPrice(pricing.prixVenteHT)}
                </div>
                <p className="text-[10px] text-text-muted mt-0.5">= TTC ÷ (1 + TVA Vente)</p>
              </div>
            </div>
            <div className="bg-green-50 border-b border-border px-4 py-2 flex items-center justify-between">
              <span className="text-[11px] font-bold text-green-700 uppercase tracking-wider">Côté Vente</span>
              {pricing.isBelowCost && (
                <span className="flex items-center gap-1 text-[11px] font-bold text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
                  <AlertTriangle size={11} /> Vente sous coût de revient !
                </span>
              )}
            </div>
            <div className="grid grid-cols-4 gap-3 p-4">
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">Marge %</label>
                <input type="text" inputMode="decimal" value={formData.marge_pct} onChange={e => onMargePctChange(e.target.value.replace(/[^0-9.,]/g, ''))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm font-price"
                  placeholder="30" />
                <p className="text-[10px] text-text-muted mt-0.5">Path A</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">Coef A/V</label>
                <input type="text" inputMode="decimal" value={formData.coef_av} onChange={e => onCoefAvChange(e.target.value.replace(/[^0-9.,]/g, ''))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm font-price"
                  placeholder="1.3" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">
                  Prix Vente TTC (DT) <span className="text-danger">*</span>
                </label>
                <input type="text" inputMode="decimal" value={formData.prix_vente} onChange={e => onPrixVenteChange(e.target.value.replace(/[^0-9.,]/g, ''))}
                  className={cn('w-full border rounded-lg px-3 py-2 text-sm font-price font-bold',
                    pricing.isBelowCost ? 'border-red-400 bg-red-50' : formErrors.prix_vente ? 'border-danger' : 'border-green-400 bg-green-50'
                  )}
                  placeholder="0.000" />
                {formErrors.prix_vente && <p className="text-xs text-danger mt-1">{formErrors.prix_vente}</p>}
                <p className="text-[10px] text-text-muted mt-0.5">Path B — saisie directe</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">TVA Vente (%) <span className="text-danger">*</span></label>
                <div className="flex gap-1 flex-wrap">
                  {['0','7','13','19'].map(v => (
                    <button key={v} type="button" onClick={() => f('tva_taux', v)}
                      className={cn('px-2 py-1 rounded text-xs font-price border transition-colors',
                        formData.tva_taux === v ? 'bg-green-500 text-white border-green-500' : 'border-border hover:bg-muted'
                      )}>{v}%</button>
                  ))}
                  <input type="text" inputMode="decimal" value={formData.tva_taux} onChange={e => f('tva_taux', e.target.value.replace(/[^0-9.,]/g, ''))}
                    className="w-14 border border-border rounded px-1 py-1 text-xs font-price" />
                </div>
              </div>
            </div>
          </div>

          {/* Stock */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Stock actuel</label>
              <input type="text" inputMode="numeric" value={formData.stock_actuel} onChange={e => f('stock_actuel', e.target.value.replace(/[^0-9]/g, ''))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm font-price" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Stock minimum</label>
              <input type="text" inputMode="numeric" value={formData.stock_minimum} onChange={e => f('stock_minimum', e.target.value.replace(/[^0-9]/g, ''))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm font-price" />
            </div>
          </div>

          {/* Fournisseur + Description */}
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Fournisseur</label>
            <input value={formData.fournisseur} onChange={e => f('fournisseur', e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm"
              placeholder="Nom du fournisseur..." />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Description</label>
            <textarea value={formData.description} onChange={e => f('description', e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm h-16 resize-none"
              placeholder="Description optionnelle..." />
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-border sticky bottom-0 bg-white">
          <button type="button" onClick={onClose}
            className="flex-1 bg-muted hover:bg-border text-text-primary font-semibold py-2.5 rounded-xl transition-colors">
            Annuler
          </button>
          <button type="button" onClick={handleSave} disabled={saving}
            className="flex-1 bg-accent-500 hover:bg-accent-600 disabled:bg-gray-200 disabled:text-gray-400 text-text-primary font-bold py-2.5 rounded-xl transition-colors">
            {saving ? 'Création...' : 'Créer le produit'}
          </button>
        </div>
      </div>

      {/* New Category sub-modal */}
      {showCatModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[120]">
          <div className="bg-white rounded-2xl shadow-2xl w-[360px] p-6 animate-slide-in">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold flex items-center gap-2"><Tag size={16} /> Nouvelle catégorie</h3>
              <button onClick={() => setShowCatModal(false)} className="text-text-muted hover:text-text-primary"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">Nom de la catégorie *</label>
                <input value={newCatNom} onChange={e => setNewCatNom(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSaveCat()}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm"
                  placeholder="Ex: ACCESSOIRE..." autoFocus />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">Icône (emoji)</label>
                <div className="flex items-center gap-2">
                  <input value={newCatIcone} onChange={e => setNewCatIcone(e.target.value)}
                    className="w-20 border border-border rounded-lg px-3 py-2 text-lg text-center" maxLength={4} />
                  <span className="text-xs text-text-muted">Choisissez un emoji ou laissez 📦</span>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {['📦','💻','📱','🖨️','⌚','📺','🎮','🔌','🔋','🖥️','⌨️','🖱️','💾','📷','🎧','🛒'].map(e => (
                    <button key={e} onClick={() => setNewCatIcone(e)}
                      className={cn('w-8 h-8 rounded-lg text-lg flex items-center justify-center transition-colors', newCatIcone === e ? 'bg-accent-100 border border-accent-400' : 'hover:bg-muted border border-transparent')}>
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button type="button" onClick={() => setShowCatModal(false)} className="flex-1 bg-muted hover:bg-border font-semibold py-2.5 rounded-xl transition-colors text-sm">Annuler</button>
              <button type="button" onClick={handleSaveCat} disabled={!newCatNom.trim()}
                className="flex-1 bg-accent-500 hover:bg-accent-600 disabled:bg-gray-200 disabled:text-gray-400 font-bold py-2.5 rounded-xl transition-colors text-sm">Créer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Product Search Popup (full-screen, multi-add) ────────────────────────────
function ProductSearchPopup({ produits, onAddProduct, onNewProduct, onClose }: {
  produits: Produit[]
  onAddProduct: (p: Produit) => void   // stays open — adds new ligne each call
  onNewProduct: (p: Produit) => Promise<void>
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'F' | 'NF' | 'rupture'>('all')
  const [showNewModal, setShowNewModal] = useState(false)
  const [addedIds, setAddedIds] = useState<string[]>([])

  const fuseIndex = useMemo(() => new Fuse(produits, {
    keys: ['nom', 'reference', 'code_barre'],
    threshold: 0.35, minMatchCharLength: 2, ignoreLocation: true,
  }), [produits])

  const list = useMemo(() => {
    const base = q.length >= 2 ? fuseIndex.search(q, { limit: 100 }).map(r => r.item) : [...produits]
    return base.filter(p => {
      if (filterType === 'F') return p.type === 'F'
      if (filterType === 'NF') return p.type === 'NF'
      if (filterType === 'rupture') return p.stock_actuel <= p.stock_minimum
      return true
    })
  }, [q, filterType, produits, fuseIndex])

  return (
    <>
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100] p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <h3 className="font-bold text-sm flex items-center gap-2"><Search size={15} /> Parcourir les produits</h3>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowNewModal(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-500 hover:bg-accent-600 rounded-lg text-xs font-bold transition-colors">
                <Plus size={12} /> Nouveau produit
              </button>
              <button onClick={onClose}><X size={18} className="text-text-muted" /></button>
            </div>
          </div>
          <div className="px-6 py-3 border-b border-border flex items-center gap-3">
            <div className="flex-1 flex items-center gap-2 border border-border rounded-lg px-3 py-2 bg-muted">
              <Search size={14} className="text-text-muted" />
              <input value={q} onChange={e => setQ(e.target.value)} className="flex-1 bg-transparent text-sm outline-none" placeholder="Rechercher produit..." autoFocus />
            </div>
            {(['all','F','NF','rupture'] as const).map(t => (
              <button key={t} onClick={() => setFilterType(t)} className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors', filterType === t ? 'bg-accent-500 text-text-primary' : 'bg-muted hover:bg-border text-text-secondary')}>
                {t === 'all' ? 'Tous' : t === 'rupture' ? 'Rupture' : t}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted border-b border-border">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold text-text-secondary">Réf</th>
                  <th className="text-left px-4 py-2 font-semibold text-text-secondary">Nom</th>
                  <th className="text-center px-3 py-2 font-semibold text-text-secondary">Type</th>
                  <th className="text-center px-3 py-2 font-semibold text-text-secondary">Stock</th>
                  <th className="text-right px-4 py-2 font-semibold text-text-secondary">Prix Achat</th>
                  <th className="text-right px-4 py-2 font-semibold text-text-secondary">Prix Vente</th>
                  <th className="w-20 px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.slice(0, 150).map(p => (
                  <tr key={p.id} className="hover:bg-muted/50">
                    <td className="px-4 py-2 font-mono text-text-muted">{p.reference}</td>
                    <td className="px-4 py-2 font-medium">{p.nom}</td>
                    <td className="px-3 py-2 text-center"><span className={p.type === 'F' ? 'badge-F text-[9px]' : 'badge-NF text-[9px]'}>{p.type}</span></td>
                    <td className={cn('px-3 py-2 text-center font-price', p.stock_actuel <= p.stock_minimum ? 'text-red-600 font-bold' : '')}>{p.stock_actuel}</td>
                    <td className="px-4 py-2 text-right font-price text-text-muted">{formatPrice(p.prix_achat ?? 0)}</td>
                    <td className="px-4 py-2 text-right font-price font-semibold">{formatPrice(p.prix_vente)}</td>
                    <td className="px-3 py-2">
                      {addedIds.includes(p.id) ? (
                        <span className="flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-lg text-[11px] font-bold w-full justify-center">
                          ✓ Ajouté
                        </span>
                      ) : (
                        <button onClick={() => { onAddProduct(p); setAddedIds(prev => [...prev, p.id]) }} className="flex items-center gap-1 px-2 py-1 bg-accent-500 hover:bg-accent-600 rounded-lg text-[11px] font-bold transition-colors w-full justify-center">
                          <Plus size={10} /> Ajouter
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {list.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-text-muted">Aucun produit trouvé</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="px-6 py-2 border-t border-border flex items-center justify-between">
            <span className="text-xs text-text-muted">{list.length} produit(s)</span>
            <div className="flex items-center gap-2">
              {addedIds.length > 0 && (
                <span className="text-xs font-semibold text-green-700 bg-green-100 px-2 py-1 rounded-lg">
                  ✓ {addedIds.length} produit(s) ajouté(s)
                </span>
              )}
              <button onClick={onClose} className="px-4 py-1.5 bg-accent-500 hover:bg-accent-600 rounded-lg text-xs font-bold transition-colors">
                Fermer{addedIds.length > 0 ? ` (${addedIds.length})` : ''}
              </button>
            </div>
          </div>
        </div>
      </div>

      {showNewModal && (
        <NewProductModal
          onClose={() => setShowNewModal(false)}
          onCreated={async (p) => {
            await onNewProduct(p)
            setAddedIds(prev => [...prev, p.id])
          }}
        />
      )}
    </>
  )
}

// ── Facture Fournisseur Modal ──────────────────────────────────────────────────
function FactureFournisseurModal({ fournisseurs: initialFournisseurs, onClose, onSaved }: { fournisseurs: Fournisseur[]; onClose: () => void; onSaved: () => void }) {
  const [fournisseurId, setFournisseurId] = useState('')
  const [fournisseurs, setFournisseurs] = useState(initialFournisseurs)
  const [numeroFacture, setNumeroFacture] = useState('')
  const [dateFacture, setDateFacture] = useState(new Date().toISOString().slice(0, 10))
  const [dateEcheance, setDateEcheance] = useState('')
  const [notes, setNotes] = useState('')
  const [isBL, setIsBL] = useState(false)
  const [lignes, setLignes] = useState([{ id: generateId(), designation: '', quantite: 1, nouveau_prix_achat: 0, tva_taux: 0, produit_id: '' }])
  const [produits, setProduits] = useState<Produit[]>([])
  const [loading, setLoading] = useState(false)
  const [margePct] = useState(30) // default margin
  // Inline new fournisseur form (expanded v1.8)
  const [showNewFourn, setShowNewFourn] = useState(false)
  const [newFourn, setNewFourn] = useState({ nom: '', telephone: '', adresse: '', matricule_fiscal: '', email: '', rib: '' })
  const [newFournCommerciaux, setNewFournCommerciaux] = useState<{ id: string; nom: string; telephone: string; email: string }[]>([])
  const [savingFourn, setSavingFourn] = useState(false)
  // Product search popup
  const [showProductPopup, setShowProductPopup] = useState(false)
  const [popupLineId, setPopupLineId] = useState<string | null>(null)
  // Fiscal fields
  const [exoFlag, setExoFlag] = useState(false)
  const [exoText, setExoText] = useState('')
  const [timbre, setTimbre] = useState('1')
  const [remiseGlobale, setRemiseGlobale] = useState('0')
  // Product Fuse search (per ligne)
  const [lineSearches, setLineSearches] = useState<Record<string, string>>({})
  const [lineResults, setLineResults] = useState<Record<string, Produit[]>>({})
  // Quick create product (per ligne)
  const [quickCreateLineId, setQuickCreateLineId] = useState<string | null>(null)
  const [quickCreate, setQuickCreate] = useState({ nom: '', prixAchat: '', prixVente: '' })
  const [savingQC, setSavingQC] = useState(false)
  const [lastCreatedBarcode, setLastCreatedBarcode] = useState<{ code: string; nom: string; prix: number; ref: string } | null>(null)

  const fuseIndex = useMemo(() => new Fuse(produits, {
    keys: ['nom', 'reference', 'code_barre'],
    threshold: 0.35,
    minMatchCharLength: 2,
    ignoreLocation: true,
  }), [produits])

  useEffect(() => {
    void loadData('Chargement produits', async () => {
      const p = await api.produitsList({}) as Produit[]
      setProduits(p)
    })
  }, [])

  const handleCreateFournisseur = async () => {
    if (!newFourn.nom.trim()) return
    const ok = await runAction('Création fournisseur', async () => {
      const id = generateId()
      const now = new Date().toISOString()
      const f = {
        id, nom: newFourn.nom.trim(),
        contact_nom: null, telephone: newFourn.telephone || null, email: newFourn.email || null,
        adresse: newFourn.adresse || null, matricule_fiscal: newFourn.matricule_fiscal || null,
        rib: newFourn.rib || null, notes: null, solde_du: 0, actif: 1, created_at: now
      }
      await api.fournisseursCreate(f)
      const validCommerciaux = newFournCommerciaux.filter(c => c.nom.trim())
      if (validCommerciaux.length > 0) {
        await api.fournisseurCommerciauxBulkCreate(validCommerciaux.map(c => ({
          id: generateId(), fournisseur_id: id, nom: c.nom.trim(),
          telephone: c.telephone || null, email: c.email || null
        })))
      }
      const updated = await api.fournisseursList({}) as Fournisseur[]
      setFournisseurs(updated)
      setFournisseurId(id)
      setShowNewFourn(false)
      setNewFourn({ nom: '', telephone: '', adresse: '', matricule_fiscal: '', email: '', rib: '' })
      setNewFournCommerciaux([])
    }, { setSaving: setSavingFourn, successMessage: `Fournisseur « ${newFourn.nom.trim()} » créé` })
    if (!ok) return
  }

  const onLineSearch = (lineId: string, q: string) => {
    setLineSearches(prev => ({ ...prev, [lineId]: q }))
    if (q.length >= 2) {
      const results = fuseIndex.search(q, { limit: 6 }).map(r => r.item)
      setLineResults(prev => ({ ...prev, [lineId]: results }))
    } else {
      setLineResults(prev => ({ ...prev, [lineId]: [] }))
    }
  }

  const selectProduct = (lineId: string, p: Produit) => {
    updateLigne(lineId, 'produit_id', p.id)
    updateLigne(lineId, 'designation', p.nom)
    updateLigne(lineId, 'nouveau_prix_achat', p.prix_achat ?? p.prix_vente)
    setLineSearches(prev => ({ ...prev, [lineId]: '' }))
    setLineResults(prev => ({ ...prev, [lineId]: [] }))
  }

  const printBarcodeLabel = (code: string, nom: string, prix: number, ref: string) => {
    const svg = code128Svg(code, { width: 300, height: 64, showText: false })
    const html = `<!DOCTYPE html><html><head><title>Étiquette</title><style>
      @page{size:58mm auto;margin:2mm}
      body{font-family:Arial,sans-serif;text-align:center;margin:0;padding:4px;background:#fff}
      .nom{font-size:11px;font-weight:bold;margin-bottom:2px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:300px;display:inline-block}
      .prix{font-size:18px;font-weight:bold;margin:3px 0}
      .ref{font-size:9px;color:#555;margin-top:2px}
      svg{display:block;margin:0 auto}
    </style></head><body>
    <div class="nom">${nom.slice(0, 30).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
    ${svg}
    <div class="prix">${prix.toFixed(3)} DT</div>
    <div class="ref">${ref}</div>
    </body></html>`
    void printLabelHtml(html)
  }

  const handleQuickCreateProduct = async (lineId: string) => {
    if (!quickCreate.nom.trim() || !quickCreate.prixVente) return
    await runAction('Création produit rapide', async () => {
      const id = generateId()
      const now = new Date().toISOString()
      const date = now.slice(0, 10).replace(/-/g, '')
      const rand = String(Math.floor(Math.random() * 99999)).padStart(5, '0')
      const code_barre = `SML-${date}-${rand}`
      const ref = generateReference()
      const prix_achat = parseFloat(quickCreate.prixAchat) || null
      const prix_vente = parseFloat(quickCreate.prixVente) || 0
      const p = {
        id, nom: quickCreate.nom.trim(), reference: ref, code_barre,
        prix_achat, prix_vente, type: 'F', categorie: 'Général',
        stock_actuel: 0, stock_minimum: 5, tva_taux: 0, actif: 1,
        created_at: now, updated_at: now,
      }
      await api.produitsCreate(p)
      const updated = await api.produitsList({}) as Produit[]
      setProduits(updated)
      selectProduct(lineId, p as Produit)
      setLastCreatedBarcode({ code: code_barre, nom: p.nom, prix: prix_vente, ref })
      setQuickCreateLineId(null)
      setQuickCreate({ nom: '', prixAchat: '', prixVente: '' })
    }, { setSaving: setSavingQC, successMessage: 'Produit créé' })
  }

  const addLigne = () => setLignes(prev => [...prev, { id: generateId(), designation: '', quantite: 1, nouveau_prix_achat: 0, tva_taux: 0, produit_id: '' }])
  const removeLigne = (id: string) => setLignes(prev => prev.filter(l => l.id !== id))
  const updateLigne = (id: string, field: string, value: unknown) => {
    setLignes(prev => prev.map(l => {
      if (l.id !== id) return l
      const updated = { ...l, [field]: value }
      if (field === 'produit_id' && value) {
        const p = produits.find(p => p.id === value)
        if (p) {
          updated.designation = p.nom
          updated.nouveau_prix_achat = p.prix_achat ?? p.prix_vente
        }
      }
      return updated
    }))
  }

  const montantHT = lignes.reduce((s, l) => s + l.quantite * l.nouveau_prix_achat, 0)
  const montantTTC = lignes.reduce((s, l) => s + l.quantite * l.nouveau_prix_achat * (1 + l.tva_taux / 100), 0)

  const handleSave = async () => {
    if (!fournisseurId || !numeroFacture) return
    const filledLignes = lignes.filter(l => l.designation.trim())
    if (filledLignes.length === 0) return
    const ok = await runAction(isBL ? 'Enregistrement bon de livraison' : 'Enregistrement facture fournisseur', async () => {
      const factureId = generateId()
      const now = new Date().toISOString()
      const mHT = filledLignes.reduce((s, l) => s + l.quantite * l.nouveau_prix_achat, 0)
      const mTTC = filledLignes.reduce((s, l) => s + l.quantite * l.nouveau_prix_achat * (1 + l.tva_taux / 100), 0)
      const remise = parseFloat(remiseGlobale) || 0
      const timbreVal = parseFloat(timbre) || 0
      const tvaAmount = exoFlag ? 0 : mTTC - mHT
      const totalGeneral = (exoFlag ? mHT : mTTC) - remise + timbreVal
      // TVA split by rate
      const ht7 = filledLignes.filter(l => l.tva_taux === 7).reduce((s, l) => s + l.quantite * l.nouveau_prix_achat, 0)
      const tva7 = ht7 * 0.07
      const ht19 = filledLignes.filter(l => l.tva_taux === 19).reduce((s, l) => s + l.quantite * l.nouveau_prix_achat, 0)
      const tva19 = ht19 * 0.19
      const facture = {
        id: factureId, numero_facture: numeroFacture, fournisseur_id: fournisseurId,
        date_facture: dateFacture, date_echeance: dateEcheance || null,
        statut_paiement: 'EN_ATTENTE', montant_ht: mHT, montant_tva: tvaAmount,
        montant_ttc: totalGeneral, notes: notes || null, created_at: now,
        type: isBL ? 'FACTURE_ACHAT_BL' : 'FACTURE_ACHAT',
        statut_reception: isBL ? 'NON_ARRIVE' : 'ARRIVE',
        exo: exoFlag ? (exoText || 'EXO') : null,
        timbre: timbreVal, total_remise: remise > 0 ? remise : null,
        ht_7: ht7 > 0 ? ht7 : null, tva_7: tva7 > 0 ? tva7 : null,
        ht_19: ht19 > 0 ? ht19 : null, tva_19: tva19 > 0 ? tva19 : null,
      }
      const lignesData = filledLignes.map(l => {
        const p = produits.find(p => p.id === l.produit_id)
        return {
          id: generateId(), facture_id: factureId, produit_id: l.produit_id || null,
          designation: l.designation, quantite: l.quantite,
          ancien_prix_achat: p?.prix_achat ?? null,
          nouveau_prix_achat: l.nouveau_prix_achat,
          prix_vente_suggere: +(l.nouveau_prix_achat * (1 + margePct / 100)).toFixed(3),
          prix_vente_applique: null, tva_taux: l.tva_taux,
        }
      })
      await api.facturesFournisseursCreate(facture, lignesData)
    }, {
      setLoading,
      successMessage: isBL ? 'Bon de livraison enregistré' : 'Facture fournisseur enregistrée',
    })
    if (ok) {
      onSaved()
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[130] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-slide-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-white z-10">
          <h2 className="font-bold text-base flex items-center gap-2">
            <FileText size={15} /> {isBL ? 'Nouveau Bon de Livraison' : 'Nouvelle Facture Fournisseur'}
          </h2>
          <div className="flex items-center gap-3">
            {/* BL Toggle */}
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <div
                onClick={() => setIsBL(v => !v)}
                className={cn('w-10 h-5 rounded-full transition-colors relative cursor-pointer', isBL ? 'bg-blue-500' : 'bg-gray-300')}
              >
                <div className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform', isBL ? 'translate-x-5' : 'translate-x-0.5')} />
              </div>
              <span className={cn('text-xs font-semibold', isBL ? 'text-blue-700' : 'text-text-secondary')}>
                Bon de livraison (BL)
              </span>
            </label>
            <button onClick={onClose}><X size={18} className="text-text-muted" /></button>
          </div>
        </div>
        {isBL && (
          <div className="px-6 py-2 bg-blue-50 border-b border-blue-100 text-xs text-blue-700 flex items-center gap-2">
            <PackageCheck size={13} /> Le stock ne sera <strong>pas mis à jour</strong> avant de marquer comme reçu.
          </div>
        )}
        <div className="p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-text-secondary mb-1">Fournisseur *</label>
              <div className="flex gap-2">
                <select value={fournisseurId} onChange={e => setFournisseurId(e.target.value)} className="flex-1 border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-accent-500">
                  <option value="">— Choisir un fournisseur —</option>
                  {fournisseurs.map(f => <option key={f.id} value={f.id}>{f.nom}</option>)}
                </select>
                <button onClick={() => setShowNewFourn(v => !v)} className="flex items-center gap-1.5 px-3 py-2 bg-muted hover:bg-border border border-border rounded-xl text-xs font-semibold text-text-secondary whitespace-nowrap transition-colors">
                  <Plus size={12} /> Nouveau Fournisseur
                </button>
              </div>
              {/* Inline new fournisseur — v1.8 expanded */}
              {showNewFourn && (
                <div className="mt-2 border border-accent-300 rounded-xl p-3 bg-accent-50 space-y-3">
                  <p className="text-xs font-bold text-accent-700">Nouveau Fournisseur</p>
                  <div className="grid grid-cols-2 gap-2">
                    <input value={newFourn.nom} onChange={e => setNewFourn(p => ({ ...p, nom: e.target.value }))} className="col-span-2 border border-border rounded-lg px-3 py-1.5 text-xs" placeholder="Nom *" autoFocus />
                    <input value={newFourn.telephone} onChange={e => setNewFourn(p => ({ ...p, telephone: e.target.value }))} className="border border-border rounded-lg px-3 py-1.5 text-xs" placeholder="Téléphone" />
                    <input value={newFourn.email} onChange={e => setNewFourn(p => ({ ...p, email: e.target.value }))} className="border border-border rounded-lg px-3 py-1.5 text-xs" placeholder="Email" />
                    <input value={newFourn.matricule_fiscal} onChange={e => setNewFourn(p => ({ ...p, matricule_fiscal: e.target.value }))} className="border border-border rounded-lg px-3 py-1.5 text-xs" placeholder="Matricule fiscal" />
                    <input value={newFourn.rib} onChange={e => setNewFourn(p => ({ ...p, rib: e.target.value }))} className="border border-border rounded-lg px-3 py-1.5 text-xs" placeholder="RIB" />
                    <input value={newFourn.adresse} onChange={e => setNewFourn(p => ({ ...p, adresse: e.target.value }))} className="col-span-2 border border-border rounded-lg px-3 py-1.5 text-xs" placeholder="Adresse" />
                  </div>
                  {/* Commerciaux */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[11px] font-bold text-accent-700">Commerciaux</p>
                      <button type="button" onClick={() => setNewFournCommerciaux(c => [...c, { id: generateId(), nom: '', telephone: '', email: '' }])}
                        className="text-[10px] font-bold text-accent-600 hover:text-accent-800 flex items-center gap-1">
                        <Plus size={9} /> Ajouter commercial
                      </button>
                    </div>
                    {newFournCommerciaux.map((c, i) => (
                      <div key={c.id} className="grid grid-cols-3 gap-1 mb-1 items-center">
                        <input value={c.nom} onChange={e => setNewFournCommerciaux(prev => prev.map((x, j) => j === i ? { ...x, nom: e.target.value } : x))} className="border border-border rounded-lg px-2 py-1 text-[11px]" placeholder="Nom *" />
                        <input value={c.telephone} onChange={e => setNewFournCommerciaux(prev => prev.map((x, j) => j === i ? { ...x, telephone: e.target.value } : x))} className="border border-border rounded-lg px-2 py-1 text-[11px]" placeholder="Tél" />
                        <div className="flex gap-1">
                          <input value={c.email} onChange={e => setNewFournCommerciaux(prev => prev.map((x, j) => j === i ? { ...x, email: e.target.value } : x))} className="flex-1 border border-border rounded-lg px-2 py-1 text-[11px]" placeholder="Email" />
                          <button type="button" onClick={() => setNewFournCommerciaux(prev => prev.filter((_, j) => j !== i))} className="text-danger hover:text-red-700 flex-shrink-0"><X size={11} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button type="button" onClick={() => setShowNewFourn(false)} className="px-3 py-1 text-xs font-semibold bg-muted hover:bg-border rounded-lg transition-colors">Annuler</button>
                    <button type="button" onClick={handleCreateFournisseur} disabled={savingFourn || !newFourn.nom.trim()} className="px-3 py-1 text-xs font-bold bg-accent-500 hover:bg-accent-600 disabled:bg-gray-200 rounded-lg transition-colors">
                      {savingFourn ? '...' : 'Créer & Sélectionner'}
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1">N° Facture *</label>
              <input value={numeroFacture} onChange={e => setNumeroFacture(e.target.value)} className="w-full border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-accent-500" placeholder="FAC-2026-001" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1">Date facture</label>
              <input type="date" value={dateFacture} onChange={e => setDateFacture(e.target.value)} className="w-full border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-accent-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1">Date échéance</label>
              <input type="date" value={dateEcheance} onChange={e => setDateEcheance(e.target.value)} className="w-full border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-accent-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1">Notes</label>
              <input value={notes} onChange={e => setNotes(e.target.value)} className="w-full border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-accent-500" />
            </div>
          </div>

          {/* Lines */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Lignes de facture</label>
              <button onClick={addLigne} className="flex items-center gap-1 text-xs px-2.5 py-1 bg-accent-500 hover:bg-accent-600 rounded-lg font-semibold transition-colors">
                <Plus size={12} /> Ajouter ligne
              </button>
            </div>
            <div className="space-y-2">
              {lignes.map((l, i) => (
                <div key={l.id} className="bg-muted rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-muted font-bold w-5 text-center flex-shrink-0">{i + 1}</span>
                    {/* Smart product search + Browse button */}
                    <div className="flex-1 relative">
                      <div className="flex items-center gap-1.5 border border-border rounded-lg px-2 py-1.5 bg-white">
                        <Search size={11} className="text-text-muted flex-shrink-0" />
                        <input
                          value={lineSearches[l.id] ?? ''}
                          onChange={e => onLineSearch(l.id, e.target.value)}
                          className="flex-1 bg-transparent text-xs outline-none"
                          placeholder={l.produit_id ? (produits.find(p => p.id === l.produit_id)?.nom ?? 'Chercher produit...') : 'Chercher produit...'}
                        />
                        <button type="button" onClick={() => { setPopupLineId(l.id); setShowProductPopup(true) }} title="Parcourir produits" className="text-accent-600 hover:text-accent-800 flex-shrink-0">
                          <Package size={12} />
                        </button>
                        {l.produit_id && (
                          <button onClick={() => updateLigne(l.id, 'produit_id', '')} className="text-text-muted hover:text-danger"><X size={10} /></button>
                        )}
                      </div>
                      {((lineResults[l.id] ?? []).length > 0 || ((lineSearches[l.id]?.length ?? 0) >= 2 && (lineResults[l.id] ?? []).length === 0)) && (
                        <div className="absolute top-full left-0 right-0 z-10 bg-white border border-border rounded-lg shadow-lg mt-0.5">
                          {(lineResults[l.id] ?? []).map(p => (
                            <button key={p.id} onClick={() => selectProduct(l.id, p)}
                              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted text-left text-xs border-b border-border last:border-0">
                              <span className={p.type === 'F' ? 'badge-F text-[9px]' : 'badge-NF text-[9px]'}>{p.type}</span>
                              <span className="flex-1 truncate font-medium">{p.nom}</span>
                              <span className="font-price text-text-muted">{formatPrice(p.prix_achat ?? p.prix_vente)}</span>
                            </button>
                          ))}
                          {(lineSearches[l.id]?.length ?? 0) >= 2 && (
                            <button
                              onClick={() => { setQuickCreateLineId(l.id); setQuickCreate({ nom: lineSearches[l.id] ?? '', prixAchat: '', prixVente: '' }); setLineResults(prev => ({ ...prev, [l.id]: [] })); setLineSearches(prev => ({ ...prev, [l.id]: '' })) }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs bg-accent-50 text-accent-700 font-semibold hover:bg-accent-100 rounded-b-lg"
                            >
                              <Plus size={11} /> Créer &ldquo;{lineSearches[l.id]}&rdquo;
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <input value={l.designation} onChange={e => updateLigne(l.id, 'designation', e.target.value)} className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white" placeholder="Désignation *" />
                    <input type="text" inputMode="numeric" value={l.quantite} onChange={e => updateLigne(l.id, 'quantite', parseInt(e.target.value.replace(/[^0-9]/g, '')) || 1)} className="w-14 border border-border rounded-lg px-2 py-1.5 text-xs font-price bg-white text-center" />
                    <input type="text" inputMode="decimal" value={l.nouveau_prix_achat} onChange={e => updateLigne(l.id, 'nouveau_prix_achat', parseFloat(e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.')) || 0)} className="w-24 border border-border rounded-lg px-2 py-1.5 text-xs font-price bg-white" placeholder="P.Achat" />
                    <span className="text-xs font-price text-text-secondary w-20 text-right flex-shrink-0">{formatPrice(l.quantite * l.nouveau_prix_achat)}</span>
                    {lignes.length > 1 && (
                      <button onClick={() => removeLigne(l.id)} className="text-danger hover:text-red-700 flex-shrink-0"><X size={13} /></button>
                    )}
                  </div>

                  {/* Quick-create product inline form */}
                  {quickCreateLineId === l.id && (
                    <div className="border border-accent-300 rounded-xl p-3 bg-accent-50 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-bold text-accent-700 flex items-center gap-1.5"><Package size={12} /> Créer nouveau produit</p>
                        <button onClick={() => setQuickCreateLineId(null)} className="text-text-muted hover:text-danger"><X size={13} /></button>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <input
                          value={quickCreate.nom}
                          onChange={e => setQuickCreate(q => ({ ...q, nom: e.target.value }))}
                          className="col-span-3 border border-border rounded-lg px-3 py-1.5 text-xs"
                          placeholder="Nom du produit *"
                          autoFocus
                        />
                        <div>
                          <label className="block text-[10px] text-text-muted mb-0.5">Prix Achat HT</label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={quickCreate.prixAchat}
                            onChange={e => setQuickCreate(q => ({ ...q, prixAchat: e.target.value.replace(/[^0-9.,]/g, '') }))}
                            className="w-full border border-border rounded-lg px-2 py-1.5 text-xs font-price"
                            placeholder="0.000"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-text-muted mb-0.5">Prix Vente TTC *</label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={quickCreate.prixVente}
                            onChange={e => setQuickCreate(q => ({ ...q, prixVente: e.target.value.replace(/[^0-9.,]/g, '') }))}
                            className="w-full border border-border rounded-lg px-2 py-1.5 text-xs font-price"
                            placeholder="0.000"
                          />
                        </div>
                        <div className="flex items-end">
                          <p className="text-[10px] text-text-muted">Code-barres auto-généré (SML-...)</p>
                        </div>
                      </div>
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => setQuickCreateLineId(null)} className="px-3 py-1 text-xs font-semibold bg-white hover:bg-muted border border-border rounded-lg transition-colors">Annuler</button>
                        <button
                          onClick={() => handleQuickCreateProduct(l.id)}
                          disabled={savingQC || !quickCreate.nom.trim() || !quickCreate.prixVente}
                          className="px-3 py-1 text-xs font-bold bg-accent-500 hover:bg-accent-600 disabled:bg-gray-200 disabled:text-gray-400 rounded-lg transition-colors"
                        >
                          {savingQC ? '...' : 'Créer & Sélectionner'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Last created product barcode — print prompt */}
          {lastCreatedBarcode && (
            <div className="flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-xl px-4 py-2.5">
              <Package size={14} className="text-orange-600 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-orange-800">Produit créé : {lastCreatedBarcode.nom}</p>
                <p className="text-[11px] font-mono text-orange-600">{lastCreatedBarcode.code}</p>
              </div>
              <button
                onClick={() => printBarcodeLabel(lastCreatedBarcode.code, lastCreatedBarcode.nom, lastCreatedBarcode.prix, lastCreatedBarcode.ref)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-xs font-bold transition-colors flex-shrink-0"
              >
                <Printer size={12} /> Imprimer étiquette
              </button>
              <button onClick={() => setLastCreatedBarcode(null)} className="text-orange-400 hover:text-orange-700"><X size={13} /></button>
            </div>
          )}

          {/* Fiscal fields — v1.8 */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1">Remise globale (DT)</label>
              <input type="text" inputMode="decimal" value={remiseGlobale} onChange={e => setRemiseGlobale(e.target.value.replace(/[^0-9.,]/g, ''))} className="w-full border border-border rounded-xl px-3 py-2 text-sm font-price outline-none focus:border-accent-500" placeholder="0.000" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1">Timbre fiscal (DT)</label>
              <input type="text" inputMode="decimal" value={timbre} onChange={e => setTimbre(e.target.value.replace(/[^0-9.,]/g, ''))} className="w-full border border-border rounded-xl px-3 py-2 text-sm font-price outline-none focus:border-accent-500" placeholder="1.000" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1">EXO</label>
              <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
                <div onClick={() => setExoFlag(v => !v)} className={cn('w-8 h-4 rounded-full transition-colors relative cursor-pointer', exoFlag ? 'bg-orange-500' : 'bg-gray-300')}>
                  <div className={cn('absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform', exoFlag ? 'translate-x-4' : 'translate-x-0.5')} />
                </div>
                <span className="text-xs text-text-secondary">Exonéré TVA</span>
              </label>
              {exoFlag && (
                <input value={exoText} onChange={e => setExoText(e.target.value)} className="w-full mt-1 border border-border rounded-lg px-2 py-1 text-xs" placeholder="Motif EXO..." />
              )}
            </div>
          </div>

          {/* Totals */}
          <div className="bg-muted rounded-xl p-4 space-y-1.5">
            <div className="flex justify-between text-sm"><span className="text-text-secondary">Montant HT</span><span className="font-price font-semibold">{formatPrice(montantHT)}</span></div>
            {!exoFlag && <div className="flex justify-between text-sm"><span className="text-text-secondary">TVA</span><span className="font-price font-semibold">{formatPrice(montantTTC - montantHT)}</span></div>}
            {(parseFloat(remiseGlobale) || 0) > 0 && <div className="flex justify-between text-sm text-red-600"><span>Remise</span><span className="font-price font-semibold">- {formatPrice(parseFloat(remiseGlobale) || 0)}</span></div>}
            {(parseFloat(timbre) || 0) > 0 && <div className="flex justify-between text-sm"><span className="text-text-secondary">Timbre fiscal</span><span className="font-price font-semibold">+ {formatPrice(parseFloat(timbre) || 0)}</span></div>}
            <div className="flex justify-between font-bold border-t border-border pt-1.5">
              <span>Total Général</span>
              <span className="font-price text-lg">{formatPrice((exoFlag ? montantHT : montantTTC) - (parseFloat(remiseGlobale) || 0) + (parseFloat(timbre) || 0))}</span>
            </div>
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-border sticky bottom-0 bg-white">
          <button type="button" onClick={onClose} className="flex-1 bg-muted hover:bg-border text-text-primary font-semibold py-2.5 rounded-xl text-sm transition-colors">Annuler</button>
          <button
            type="button"
            onClick={() => {
              const fourn = fournisseurs.find(f => f.id === fournisseurId)
              const html = `<!DOCTYPE html><html><head><title>Facture ${numeroFacture}</title>
              <style>@page{size:A4;margin:15mm}body{font-family:Arial,sans-serif;font-size:11px}
              h2{font-size:15px;margin:0 0 2px}.sub{color:#555;margin-bottom:12px}
              table{width:100%;border-collapse:collapse;margin-top:10px}
              th{background:#f5f5f5;border:1px solid #ccc;padding:5px 8px;text-align:left;font-size:10px}
              td{border:1px solid #ddd;padding:5px 8px;font-size:10px}
              .total{font-weight:bold;background:#fffde7}</style></head><body>
              <h2>${isBL ? 'Bon de Livraison' : 'Facture Fournisseur'} — ${numeroFacture}</h2>
              <div class="sub">Date : ${dateFacture} | Fournisseur : ${fourn?.nom ?? fournisseurId}</div>
              ${exoFlag ? `<div style="background:#fff3cd;padding:6px;border-radius:4px;margin-bottom:8px">EXO : ${exoText || 'Exonéré'}</div>` : ''}
              <table><thead><tr><th>Désignation</th><th>Qté</th><th>Prix HT</th><th>TVA%</th><th>Total HT</th></tr></thead>
              <tbody>${lignes.filter(l => l.designation.trim()).map(l =>
                `<tr><td>${l.designation}</td><td>${l.quantite}</td><td>${l.nouveau_prix_achat.toFixed(3)}</td><td>${l.tva_taux}%</td><td>${(l.quantite * l.nouveau_prix_achat).toFixed(3)}</td></tr>`
              ).join('')}
              <tr class="total"><td colspan="4">Total HT</td><td>${montantHT.toFixed(3)}</td></tr>
              <tr><td colspan="4">TVA</td><td>${(montantTTC - montantHT).toFixed(3)}</td></tr>
              <tr class="total"><td colspan="4">Total TTC</td><td>${montantTTC.toFixed(3)}</td></tr>
              ${parseFloat(remiseGlobale) > 0 ? `<tr><td colspan="4">Remise</td><td>- ${parseFloat(remiseGlobale).toFixed(3)}</td></tr>` : ''}
              ${parseFloat(timbre) > 0 ? `<tr><td colspan="4">Timbre fiscal</td><td>${parseFloat(timbre).toFixed(3)}</td></tr>` : ''}
              </tbody></table></body></html>`
              void printLabelHtml(html)
            }}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-muted hover:bg-border border border-border text-text-primary font-semibold rounded-xl text-sm transition-colors"
          >
            <Printer size={14} /> Aperçu
          </button>
          <button type="button" onClick={handleSave} disabled={loading || !fournisseurId || !numeroFacture} className={cn('flex-1 disabled:bg-gray-200 disabled:text-gray-400 font-bold py-2.5 rounded-xl text-sm transition-colors', isBL ? 'bg-blue-500 hover:bg-blue-600 text-white' : 'bg-accent-500 hover:bg-accent-600 text-text-primary')}>
            {loading ? 'Enregistrement...' : `${isBL ? 'Créer BL' : 'Enregistrer'} — ${formatPrice((exoFlag ? montantHT : montantTTC) - (parseFloat(remiseGlobale) || 0) + (parseFloat(timbre) || 0))}`}
          </button>
        </div>
      </div>
      {/* Product Search Popup — multi-add mode (stays open until user closes) */}
      {showProductPopup && (
        <ProductSearchPopup
          produits={produits}
          onAddProduct={(p) => {
            // Add a new ligne with this product
            const newId = generateId()
            setLignes(prev => [...prev, { id: newId, designation: p.nom, quantite: 1, nouveau_prix_achat: p.prix_achat ?? p.prix_vente, tva_taux: p.tva_taux ?? 0, produit_id: p.id }])
            setPopupLineId(newId)
          }}
          onNewProduct={async (p) => {
            await runAction('Ajout produit', async () => {
              await api.produitsCreate(p)
              const updated = await api.produitsList({}) as Produit[]
              setProduits(updated)
              const newId = generateId()
              setLignes(prev => [...prev, { id: newId, designation: p.nom, quantite: 1, nouveau_prix_achat: p.prix_achat ?? p.prix_vente, tva_taux: 0, produit_id: p.id }])
              setLastCreatedBarcode({ code: p.code_barre ?? '', nom: p.nom, prix: p.prix_vente, ref: p.reference })
            })
          }}
          onClose={() => { setShowProductPopup(false); setPopupLineId(null) }}
        />
      )}
    </div>
  )
}

// ── Paiement Modal ────────────────────────────────────────────────────────────
function PaiementModal({ facture, onClose, onSaved }: { facture: FactureFournisseur; onClose: () => void; onSaved: () => void }) {
  const restant = facture.montant_restant ?? (facture.montant_ttc - facture.montant_paye)
  const [montant, setMontant] = useState(restant.toFixed(3))
  const [mode, setMode] = useState<'ESPECES' | 'CHEQUE' | 'VIREMENT' | 'AUTRE'>('ESPECES')
  const [refCheque, setRefCheque] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const montantNum = parseFloat(montant.replace(',', '.')) || 0

  const handlePayer = async () => {
    if (montantNum <= 0) return
    setError('')
    const ok = await runAction('Enregistrement paiement fournisseur', async () => {
      await api.paiementsFournisseursCreate({
        id: generateId(),
        facture_id: facture.id,
        fournisseur_id: facture.fournisseur_id,
        montant: montantNum,
        mode_paiement: mode,
        reference_cheque: refCheque || null,
        date_paiement: new Date().toISOString().slice(0, 10),
        notes: notes || null,
        created_at: new Date().toISOString(),
      })
    }, {
      setLoading,
      successMessage: 'Paiement enregistré',
      onError: msg => setError(msg),
    })
    if (ok) {
      onSaved()
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-[420px] animate-slide-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-bold text-base flex items-center gap-2"><DollarSign size={15} /> Enregistrer un paiement</h2>
          <button onClick={onClose}><X size={18} className="text-text-muted" /></button>
        </div>
        <div className="p-6 space-y-4">
          {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
          <div className="bg-muted rounded-xl p-4">
            <div className="text-xs text-text-secondary">Facture</div>
            <div className="font-bold">{facture.fournisseur_nom} — {facture.numero_facture}</div>
            <div className="flex justify-between mt-2 text-sm">
              <span className="text-text-secondary">Restant dû</span>
              <span className="font-price font-bold text-danger">{formatPrice(restant)}</span>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Montant payé (DT) *</label>
            <div className="flex items-center gap-2 border border-border rounded-xl px-4 py-3 focus-within:border-accent-500">
              <input type="text" inputMode="decimal" value={montant} onChange={e => setMontant(e.target.value.replace(/[^0-9.,]/g, ''))} className="flex-1 bg-transparent font-price text-xl font-bold outline-none" autoFocus />
              <span className="text-text-secondary font-medium">DT</span>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Mode de paiement</label>
            <div className="grid grid-cols-4 gap-2">
              {(['ESPECES', 'CHEQUE', 'VIREMENT', 'AUTRE'] as const).map(m => (
                <button key={m} onClick={() => setMode(m)} className={cn('py-2 rounded-lg text-xs font-semibold border-2 transition-all', mode === m ? 'border-accent-500 bg-accent-50' : 'border-border hover:bg-muted')}>
                  {m === 'ESPECES' ? 'Espèces' : m === 'CHEQUE' ? 'Chèque' : m === 'VIREMENT' ? 'Virement' : 'Autre'}
                </button>
              ))}
            </div>
          </div>
          {mode === 'CHEQUE' && (
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">N° Chèque</label>
              <input value={refCheque} onChange={e => setRefCheque(e.target.value)} className="w-full border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-accent-500" />
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Notes</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} className="w-full border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-accent-500" />
          </div>
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-border">
          <button type="button" onClick={onClose} className="flex-1 bg-muted hover:bg-border text-text-primary font-semibold py-2.5 rounded-xl text-sm transition-colors">Annuler</button>
          <button type="button" onClick={handlePayer} disabled={loading || montantNum <= 0} className="flex-1 bg-accent-500 hover:bg-accent-600 disabled:bg-gray-200 disabled:text-gray-400 text-text-primary font-bold py-2.5 rounded-xl text-sm transition-colors">
            {loading ? 'Enregistrement...' : `Payer ${formatPrice(montantNum)}`}
          </button>
        </div>
      </div>
    </div>
  )
}

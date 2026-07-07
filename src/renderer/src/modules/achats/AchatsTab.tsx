import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Fuse from 'fuse.js'
import type { Fournisseur, FactureFournisseur, Produit } from '../../lib/types'
import { formatPrice, generateId, generateReference } from '../../lib/utils'
import { cn } from '../../lib/utils'
import { runAction, loadData } from '../../lib/apiCall'
import { showToast } from '../../lib/toast'
import BarcodeLabelPrintDialog from '../../components/BarcodeLabelPrintDialog'
import FactureAchatPrintModal from './FactureAchatPrintModal'
import FactureSerialModal from './FactureSerialModal'
import { buildAchatInvoiceDoc, mapFactureAchatLignes } from '../../lib/invoiceAchatMapper'
import type { InvoiceDocData, InvoiceLineData } from '../../components/InvoicePrintTemplate'
import {
  emptyFactureLigne,
  ligneBarcodeInfo,
  lineHasInventoryLink,
  lineTracksSerial,
  mergeProductIntoLine,
  newLineFromProduct,
  pendingFromQuickCreate,
  productTracksSerial,
  syncSerialNumsForQty,
  validateSerialLines,
  type FactureLigneState,
  type PendingProduct,
} from './factureAchatTypes'
import {
  Plus, Search, Truck, FileText, Clock, CheckCircle,
  AlertTriangle, X, ChevronRight, DollarSign, Package,
  RefreshCw, Edit2, PackageCheck, Inbox, InboxIcon, Printer,
  Barcode, Tag, BarChart2, Hash
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
  const [resumeDraftId, setResumeDraftId] = useState<string | null>(null)
  const [showDraftPicker, setShowDraftPicker] = useState(false)
  const [draftCount, setDraftCount] = useState(0)
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

  const loadDraftCount = useCallback(async () => {
    if (!api.facturesFournisseursListDrafts) return
    const drafts = await api.facturesFournisseursListDrafts() as unknown[]
    setDraftCount(drafts?.length ?? 0)
  }, [])

  useEffect(() => { void loadDraftCount() }, [loadDraftCount])

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
          {draftCount > 0 && (
            <button
              onClick={() => setShowDraftPicker(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg text-sm font-semibold text-blue-800 transition-colors"
            >
              <FileText size={14} /> Reprendre brouillon ({draftCount})
            </button>
          )}
          <button
            onClick={() => { setResumeDraftId(null); setShowFactureModal(true) }}
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
          initialDraftId={resumeDraftId}
          onClose={() => { setShowFactureModal(false); setResumeDraftId(null); void loadDraftCount() }}
          onSaved={() => { loadFournisseurs(); void loadDraftCount() }}
        />
      )}
      {showPaiementModal && (
        <PaiementModal
          facture={showPaiementModal}
          onClose={() => setShowPaiementModal(null)}
          onSaved={loadFournisseurs}
        />
      )}
      {showDraftPicker && (
        <DraftPickerModal
          onClose={() => setShowDraftPicker(false)}
          onSelect={(id) => {
            setResumeDraftId(id)
            setShowDraftPicker(false)
            setShowFactureModal(true)
          }}
        />
      )}
    </div>
  )
}

function DraftPickerModal({ onClose, onSelect }: { onClose: () => void; onSelect: (draftId: string) => void }) {
  const [drafts, setDrafts] = useState<{
    id: string
    numero_facture?: string
    fournisseur_nom?: string
    ligne_count?: number
    updated_at?: string
    created_at?: string
  }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void loadData('Chargement brouillons', async () => {
      const rows = await api.facturesFournisseursListDrafts?.() as typeof drafts
      setDrafts(rows ?? [])
      return rows
    }, { setLoading, silent: true })
  }, [])

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[140] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg animate-slide-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="font-bold text-sm">Brouillons disponibles</h3>
          <button type="button" onClick={onClose}><X size={18} className="text-text-muted" /></button>
        </div>
        <div className="max-h-[60vh] overflow-auto p-3 space-y-2">
          {loading && <p className="text-sm text-text-muted text-center py-6">Chargement…</p>}
          {!loading && drafts.length === 0 && (
            <p className="text-sm text-text-muted text-center py-6">Aucun brouillon enregistré.</p>
          )}
          {drafts.map(d => {
            const when = d.updated_at || d.created_at
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => onSelect(d.id)}
                className="w-full text-left border border-border rounded-xl px-4 py-3 hover:bg-accent-50 hover:border-accent-400 transition-colors"
              >
                <div className="font-semibold text-sm text-text-primary">{d.numero_facture || 'Brouillon sans numéro'}</div>
                <div className="text-xs text-text-secondary mt-1">
                  {d.fournisseur_nom || 'Fournisseur non défini'}
                  {d.ligne_count != null ? ` · ${d.ligne_count} ligne${d.ligne_count !== 1 ? 's' : ''}` : ''}
                  {when ? ` · ${new Date(when).toLocaleString('fr-FR')}` : ''}
                </div>
              </button>
            )
          })}
        </div>
      </div>
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

function NewProductModal({ onClose, onCreated, deferCreate = false, initialProduct, onUpdated }: {
  onClose: () => void
  onCreated: (p: Produit | PendingProduct) => Promise<void>
  deferCreate?: boolean
  initialProduct?: Produit
  onUpdated?: (p: Produit) => void
}) {
  const isEdit = !!initialProduct
  const [formData, setFormData] = useState<FullProductFormData>(() => {
    if (!initialProduct) return emptyFullForm()
    return {
      code_barre: initialProduct.code_barre ?? '',
      reference: initialProduct.reference ?? '',
      nom: initialProduct.nom ?? '',
      description: initialProduct.description ?? '',
      categorie: initialProduct.categorie ?? 'Général',
      type: initialProduct.type ?? 'F',
      prix_achat: initialProduct.prix_achat != null ? String(initialProduct.prix_achat) : '',
      cout_supplementaire: String(initialProduct.cout_supplementaire ?? 0),
      tva_achat_pct: String(initialProduct.tva_achat_pct ?? 0),
      marge_pct: initialProduct.marge_pct != null ? String(initialProduct.marge_pct) : '',
      coef_av: initialProduct.coef_av != null ? String(initialProduct.coef_av) : '',
      prix_vente: String(initialProduct.prix_vente ?? ''),
      tva_taux: String(initialProduct.tva_taux ?? 0),
      stock_actuel: String(initialProduct.stock_actuel ?? 0),
      stock_minimum: String(initialProduct.stock_minimum ?? 5),
      fournisseur: initialProduct.fournisseur ?? '',
      numero_serie: initialProduct.numero_serie ?? '',
    }
  })
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

    const ok = await runAction(isEdit ? 'Modification produit' : 'Création produit', async () => {
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
        id: initialProduct?.id ?? generateId(),
        code_barre: formData.code_barre.trim() || null,
        reference: formData.reference.trim(),
        nom: formData.nom.trim(),
        description: formData.description.trim() || null,
        categorie: formData.categorie,
        type: formData.type as 'F' | 'NF',
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
        has_serial_number: initialProduct?.has_serial_number ?? 0,
        actif: initialProduct?.actif ?? 1,
        created_at: initialProduct?.created_at ?? now,
        updated_at: now,
      }
      if (isEdit) {
        await api.produitsUpdate(p.id, p)
        onUpdated?.(p as Produit)
      } else if (deferCreate) {
        const pending: PendingProduct = {
          nom: p.nom,
          reference: p.reference,
          code_barre: p.code_barre,
          prix_achat: p.prix_achat,
          prix_vente: p.prix_vente,
          categorie: p.categorie,
          type: p.type,
          tva_taux: p.tva_taux,
          description: p.description,
          cout_supplementaire: p.cout_supplementaire,
          tva_achat_pct: p.tva_achat_pct,
          marge_pct: p.marge_pct,
          coef_av: p.coef_av,
          cout_de_revient: p.cout_de_revient,
          prix_vente_ht: p.prix_vente_ht,
          prix_achat_ttc: p.prix_achat_ttc,
          stock_minimum: p.stock_minimum,
          fournisseur: p.fournisseur,
          numero_serie: p.numero_serie,
        }
        await onCreated(pending)
      } else {
        await api.produitsCreate(p)
        await onCreated(p as Produit)
      }
    }, { setSaving, successMessage: isEdit ? 'Produit modifié' : 'Produit créé' })
    if (ok) onClose()
  }

  const pricing = computePricing(formData)

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[110] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto animate-slide-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-white z-10">
          <h2 className="font-bold flex items-center gap-2">
            <Package size={16} /> {isEdit ? 'Modifier le produit' : 'Nouveau produit'}
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
function ProductSearchPopup({ produits: initialProduits, onAddProduct, onNewProduct, onProductUpdated, onClose }: {
  produits: Produit[]
  onAddProduct: (p: Produit) => void
  onNewProduct: (p: PendingProduct) => void
  onProductUpdated?: (p: Produit) => void
  onClose: () => void
}) {
  const [produits, setProduits] = useState(initialProduits)
  const [q, setQ] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'F' | 'NF' | 'rupture'>('all')
  const [showNewModal, setShowNewModal] = useState(false)
  const [editProduct, setEditProduct] = useState<Produit | null>(null)
  const [addedIds, setAddedIds] = useState<string[]>([])

  useEffect(() => { setProduits(initialProduits) }, [initialProduits])

  const fuseIndex = useMemo(() => new Fuse(produits, {
    keys: ['nom', 'reference', 'code_barre'],
    threshold: 0.35, minMatchCharLength: 2, ignoreLocation: true,
  }), [produits])

  const list = useMemo(() => {
    const qTrim = q.trim()
    if (qTrim) {
      const exact = produits.find(p => p.code_barre === qTrim)
      if (exact) {
        const okType = filterType === 'all' || exact.type === filterType
        const okStock = filterType !== 'rupture' || exact.stock_actuel <= exact.stock_minimum
        if (okType && (filterType !== 'rupture' || okStock)) return [exact]
      }
    }
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
                  <th className="w-28 px-3 py-2" />
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
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => setEditProduct(p)} title="Modifier catalogue"
                          className="flex items-center gap-0.5 px-1.5 py-1 border border-border hover:bg-muted rounded-lg text-[10px] font-semibold transition-colors">
                          <Edit2 size={10} /> Mod.
                        </button>
                        {addedIds.includes(p.id) ? (
                          <span className="flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-lg text-[10px] font-bold flex-1 justify-center">
                            ✓ Ajouté
                          </span>
                        ) : (
                          <button onClick={() => { onAddProduct(p); setAddedIds(prev => [...prev, p.id]) }} className="flex items-center gap-1 px-2 py-1 bg-accent-500 hover:bg-accent-600 rounded-lg text-[10px] font-bold transition-colors flex-1 justify-center">
                            <Plus size={10} /> Ajouter
                          </button>
                        )}
                      </div>
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
          deferCreate
          onClose={() => setShowNewModal(false)}
          onCreated={async (p) => {
            onNewProduct(p as PendingProduct)
            setAddedIds(prev => [...prev, generateId()])
          }}
        />
      )}

      {editProduct && (
        <NewProductModal
          initialProduct={editProduct}
          onClose={() => setEditProduct(null)}
          onCreated={async () => {}}
          onUpdated={(updated) => {
            setProduits(prev => prev.map(x => x.id === updated.id ? updated : x))
            onProductUpdated?.(updated)
            setEditProduct(null)
          }}
        />
      )}
    </>
  )
}

// ── Facture Fournisseur Modal ──────────────────────────────────────────────────
function FactureFournisseurModal({
  fournisseurs: initialFournisseurs,
  initialDraftId,
  onClose,
  onSaved,
}: {
  fournisseurs: Fournisseur[]
  initialDraftId?: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const [draftId, setDraftId] = useState<string | null>(initialDraftId ?? null)
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null)
  const [savingDraft, setSavingDraft] = useState(false)
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [fournisseurId, setFournisseurId] = useState('')
  const [fournisseurs, setFournisseurs] = useState(initialFournisseurs)
  const [numeroFacture, setNumeroFacture] = useState('')
  const [dateFacture, setDateFacture] = useState(new Date().toISOString().slice(0, 10))
  const [dateEcheance, setDateEcheance] = useState('')
  const [notes, setNotes] = useState('')
  const [isBL, setIsBL] = useState(false)
  const [lignes, setLignes] = useState<FactureLigneState[]>([emptyFactureLigne()])
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
  const [showCloseDialog, setShowCloseDialog] = useState(false)
  const [barcodePrint, setBarcodePrint] = useState<{ code: string; nom: string; prix: number; ref: string } | null>(null)
  const [printPreview, setPrintPreview] = useState<{ doc: InvoiceDocData; lignes: InvoiceLineData[] } | null>(null)
  const [serialModalLineId, setSerialModalLineId] = useState<string | null>(null)

  const hasDraftContent = useMemo(
    () => lignes.some(l => l.designation.trim() || l.produit_id || l.pendingProduct) || !!fournisseurId || !!numeroFacture,
    [lignes, fournisseurId, numeroFacture],
  )

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

  useEffect(() => {
    if (!produits.length) return
    setLignes(prev => prev.map(l => {
      if (l.produit_id) {
        const p = produits.find(x => x.id === l.produit_id)
        if (p) {
          const merged = mergeProductIntoLine(l, p)
          if (l.numeros_serie?.length) {
            return {
              ...merged,
              tracks_serial: true,
              numeros_serie: syncSerialNumsForQty(l.numeros_serie, merged.quantite),
            }
          }
          return merged
        }
      }
      if (!l.produit_id && l.numeros_serie?.length && l.designation.trim()) {
        const match = produits.find(p => p.nom.trim() === l.designation.trim())
        if (match) {
          return mergeProductIntoLine(
            { ...l, tracks_serial: true, numeros_serie: syncSerialNumsForQty(l.numeros_serie, l.quantite) },
            match,
          )
        }
      }
      if (l.numeros_serie?.length && (l.produit_id || l.pendingProduct)) {
        return {
          ...l,
          tracks_serial: true,
          numeros_serie: syncSerialNumsForQty(l.numeros_serie, l.quantite),
        }
      }
      return l
    }))
  }, [produits])

  useEffect(() => {
    if (!initialDraftId || !api.facturesFournisseursGetDraft) return
    void loadData('Chargement brouillon', async () => {
      const data = await api.facturesFournisseursGetDraft(initialDraftId) as {
        facture: Record<string, unknown>
        lignes: Record<string, unknown>[]
      } | null
      if (!data?.facture) return
      const f = data.facture
      setDraftId(initialDraftId)
      setDraftSavedAt(String(f.updated_at ?? f.created_at ?? ''))
      setFournisseurId(String(f.fournisseur_id ?? ''))
      setNumeroFacture(String(f.numero_facture ?? ''))
      setDateFacture(String(f.date_facture ?? '').slice(0, 10))
      setDateEcheance(f.date_echeance ? String(f.date_echeance).slice(0, 10) : '')
      setNotes(String(f.notes ?? ''))
      setIsBL(f.type === 'FACTURE_ACHAT_BL')
      setExoFlag(!!f.exo)
      setExoText(String(f.exo ?? ''))
      setTimbre(String(f.timbre ?? '1'))
      setRemiseGlobale(String(f.total_remise ?? '0'))
      const loaded = (data.lignes ?? []).map((l) => {
        const numeros_serie = l.numeros_serie_json
          ? JSON.parse(String(l.numeros_serie_json)) as string[]
          : undefined
        return {
          id: String(l.id),
          designation: String(l.designation ?? ''),
          quantite: Number(l.quantite) || 1,
          nouveau_prix_achat: Number(l.nouveau_prix_achat) || 0,
          tva_taux: Number(l.tva_taux) || 0,
          produit_id: String(l.produit_id ?? ''),
          pendingProduct: l.pending_product_json
            ? JSON.parse(String(l.pending_product_json)) as PendingProduct
            : undefined,
          numeros_serie,
          tracks_serial: !!numeros_serie?.length,
        } satisfies FactureLigneState
      })
      setLignes(loaded.length > 0 ? loaded : [emptyFactureLigne()])
    }, { silent: true })
  }, [initialDraftId])

  const buildDraftPayload = useCallback(() => {
    const mHT = lignes.reduce((s, l) => s + l.quantite * l.nouveau_prix_achat, 0)
    const remise = parseFloat(remiseGlobale) || 0
    const timbreVal = parseFloat(timbre) || 0
    const ht7 = lignes.filter(l => l.tva_taux === 7).reduce((s, l) => s + l.quantite * l.nouveau_prix_achat, 0)
    const ht19 = lignes.filter(l => l.tva_taux === 19).reduce((s, l) => s + l.quantite * l.nouveau_prix_achat, 0)
    return {
      draftId: draftId ?? undefined,
      facture: {
        id: draftId ?? undefined,
        fournisseur_id: fournisseurId || null,
        numero_facture: numeroFacture,
        date_facture: dateFacture,
        date_echeance: dateEcheance || null,
        notes: notes || null,
        type: isBL ? 'FACTURE_ACHAT_BL' : 'FACTURE_ACHAT',
        exo: exoFlag ? (exoText || 'EXO') : null,
        timbre: timbreVal,
        total_remise: remise > 0 ? remise : null,
        ht_7: ht7 > 0 ? ht7 : null,
        tva_7: ht7 > 0 ? ht7 * 0.07 : null,
        ht_19: ht19 > 0 ? ht19 : null,
        tva_19: ht19 > 0 ? ht19 * 0.19 : null,
      },
      lignes: lignes
        .filter(l => l.designation.trim() || l.produit_id || l.pendingProduct)
        .map(l => ({
          id: l.id,
          produit_id: l.produit_id || null,
          designation: l.designation,
          quantite: l.quantite,
          nouveau_prix_achat: l.nouveau_prix_achat,
          tva_taux: l.tva_taux,
          pending_product_json: l.pendingProduct ? JSON.stringify(l.pendingProduct) : null,
          numeros_serie_json: l.tracks_serial
            ? JSON.stringify(syncSerialNumsForQty(l.numeros_serie, l.quantite))
            : null,
        })),
    }
  }, [draftId, fournisseurId, numeroFacture, dateFacture, dateEcheance, notes, isBL, lignes, exoFlag, exoText, timbre, remiseGlobale])

  const persistDraft = useCallback(async () => {
    if (!api.facturesFournisseursSaveDraft) return
    const payload = buildDraftPayload()
    if (payload.lignes.length === 0 && !fournisseurId && !numeroFacture) return
    setSavingDraft(true)
    try {
      const res = await api.facturesFournisseursSaveDraft(payload) as { draftId?: string; updated_at?: string }
      if (res.draftId) setDraftId(res.draftId)
      if (res.updated_at) setDraftSavedAt(res.updated_at)
    } finally {
      setSavingDraft(false)
    }
  }, [buildDraftPayload, fournisseurId, numeroFacture])

  useEffect(() => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    autosaveTimer.current = setTimeout(() => { void persistDraft() }, 2000)
    return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current) }
  }, [persistDraft])

  const attachPendingToLine = (lineId: string, pending: PendingProduct) => {
    setLignes(prev => prev.map(l => l.id === lineId ? {
      ...l,
      designation: pending.nom,
      nouveau_prix_achat: pending.prix_achat ?? pending.prix_vente,
      tva_taux: pending.tva_taux ?? 0,
      produit_id: '',
      pendingProduct: pending,
      tracks_serial: false,
      numeros_serie: undefined,
    } : l))
  }

  const createProductFromPending = async (pending: PendingProduct): Promise<Produit> => {
    const now = new Date().toISOString()
    const p = {
      id: generateId(),
      code_barre: pending.code_barre,
      reference: pending.reference,
      nom: pending.nom,
      description: pending.description ?? null,
      categorie: pending.categorie,
      type: pending.type,
      prix_achat: pending.prix_achat,
      cout_supplementaire: pending.cout_supplementaire ?? 0,
      tva_achat_pct: pending.tva_achat_pct ?? 0,
      marge_pct: pending.marge_pct ?? null,
      coef_av: pending.coef_av ?? null,
      cout_de_revient: pending.cout_de_revient ?? null,
      prix_vente_ht: pending.prix_vente_ht ?? null,
      prix_vente: pending.prix_vente,
      tva_taux: pending.tva_taux ?? 0,
      prix_achat_ttc: pending.prix_achat_ttc ?? null,
      stock_actuel: 0,
      stock_minimum: pending.stock_minimum ?? 5,
      fournisseur: pending.fournisseur ?? null,
      numero_serie: pending.numero_serie ?? null,
      has_serial_number: 0,
      actif: 1,
      created_at: now,
      updated_at: now,
    }
    await api.produitsCreate(p)
    return p as Produit
  }

  const handleClose = () => {
    if (!hasDraftContent) {
      if (draftId) void api.facturesFournisseursDeleteDraft?.(draftId)
      onClose()
      return
    }
    setShowCloseDialog(true)
  }

  const discardDraftAndClose = () => {
    if (draftId) void api.facturesFournisseursDeleteDraft?.(draftId)
    setShowCloseDialog(false)
    onClose()
  }

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
    const trimmed = q.trim()
    if (trimmed) {
      const exactCache = produits.find(p => p.code_barre === trimmed)
      if (exactCache) {
        setLineResults(prev => ({ ...prev, [lineId]: [exactCache] }))
        selectProduct(lineId, exactCache)
        return
      }
      if (/^\d{6,}$/.test(trimmed) && api.produitsFindByBarcode) {
        void api.produitsFindByBarcode(trimmed).then((p) => {
          const hit = p as Produit | null
          if (hit?.code_barre === trimmed) {
            setLineResults(prev => ({ ...prev, [lineId]: [hit] }))
            selectProduct(lineId, hit)
          }
        }).catch(() => {})
      }
    }
    if (q.length >= 2) {
      const results = fuseIndex.search(q, { limit: 6 }).map(r => r.item)
      setLineResults(prev => ({ ...prev, [lineId]: results }))
    } else if (!trimmed || !produits.some(p => p.code_barre === trimmed)) {
      setLineResults(prev => ({ ...prev, [lineId]: [] }))
    }
  }

  const selectProduct = (lineId: string, p: Produit) => {
    setLignes(prev => prev.map(l => l.id === lineId ? mergeProductIntoLine(l, p) : l))
    setLineSearches(prev => ({ ...prev, [lineId]: '' }))
    setLineResults(prev => ({ ...prev, [lineId]: [] }))
  }

  const printBarcodeLabel = (code: string, nom: string, prix: number, ref: string) => {
    if (!code?.trim()) return
    setBarcodePrint({
      code: code.trim(),
      nom: nom.trim() || ref.trim() || 'Produit',
      prix: Number.isFinite(prix) ? prix : parseFloat(String(prix)) || 0,
      ref,
    })
  }

  const handleQuickCreateProduct = (lineId: string) => {
    if (!quickCreate.nom.trim() || !quickCreate.prixVente) return
    const pending = pendingFromQuickCreate(quickCreate.nom, quickCreate.prixAchat, quickCreate.prixVente)
    attachPendingToLine(lineId, pending)
    setQuickCreateLineId(null)
    setQuickCreate({ nom: '', prixAchat: '', prixVente: '' })
  }

  const addLigne = () => setLignes(prev => [...prev, emptyFactureLigne()])
  const removeLigne = (id: string) => setLignes(prev => {
    const next = prev.filter(l => l.id !== id)
    return next.length > 0 ? next : [emptyFactureLigne()]
  })
  const updateLigne = (id: string, field: string, value: unknown) => {
    setLignes(prev => prev.map(l => {
      if (l.id !== id) return l
      const updated = { ...l, [field]: value }
      if (field === 'produit_id' && value) {
        const p = produits.find(p => p.id === value)
        if (p) {
          return mergeProductIntoLine(updated, p)
        }
      }
      if (field === 'produit_id' && !value) {
        updated.pendingProduct = undefined
        updated.tracks_serial = false
        updated.numeros_serie = undefined
      }
      if (field === 'quantite') {
        const qty = Math.max(1, Number(value) || 1)
        updated.quantite = qty
        if (updated.tracks_serial || lineTracksSerial(updated, produits)) {
          updated.tracks_serial = true
          updated.numeros_serie = syncSerialNumsForQty(updated.numeros_serie, qty)
        }
      }
      return updated
    }))
  }

  const setLineSerialEnabled = (lineId: string, enabled: boolean, openModal = false) => {
    const line = lignes.find(x => x.id === lineId)
    if (enabled && line && !lineHasInventoryLink(line)) {
      showToast('error', 'Liez d\'abord un produit inventaire avant d\'ajouter des numéros de série')
      return
    }
    setLignes(prev => prev.map(l => {
      if (l.id !== lineId) return l
      return {
        ...l,
        tracks_serial: enabled,
        numeros_serie: enabled ? syncSerialNumsForQty(l.numeros_serie, l.quantite) : undefined,
      }
    }))
    if (enabled && openModal) setSerialModalLineId(lineId)
    if (!enabled) setSerialModalLineId(cur => (cur === lineId ? null : cur))
  }

  const toggleLineSerial = (lineId: string) => {
    const l = lignes.find(x => x.id === lineId)
    if (!l) return
    setLineSerialEnabled(lineId, !l.tracks_serial, !l.tracks_serial)
  }

  const openSerialModal = (lineId: string) => {
    const l = lignes.find(x => x.id === lineId)
    if (!l) return
    if (!l.tracks_serial) setLineSerialEnabled(lineId, true, true)
    else setSerialModalLineId(lineId)
  }

  const saveLineSerials = (lineId: string, nums: string[]) => {
    setLignes(prev => prev.map(l => l.id === lineId ? {
      ...l,
      tracks_serial: true,
      numeros_serie: syncSerialNumsForQty(nums, l.quantite),
    } : l))
    setSerialModalLineId(null)
  }

  const serialFilledCount = (l: FactureLigneState) =>
    syncSerialNumsForQty(l.numeros_serie, l.quantite).filter(s => s.trim()).length

  const montantHT = lignes.reduce((s, l) => s + l.quantite * l.nouveau_prix_achat, 0)
  const montantTTC = lignes.reduce((s, l) => s + l.quantite * l.nouveau_prix_achat * (1 + l.tva_taux / 100), 0)

  const handleSave = async () => {
    if (!fournisseurId || !numeroFacture) return
    const filledLignes = lignes.filter(l => l.designation.trim())
    if (filledLignes.length === 0) return
    const ok = await runAction(isBL ? 'Enregistrement bon de livraison' : 'Enregistrement facture fournisseur', async () => {
      const resolvedLignes: FactureLigneState[] = []
      let produitsSnapshot = [...produits]
      for (const l of filledLignes) {
        if (l.pendingProduct && !l.produit_id) {
          const created = await createProductFromPending(l.pendingProduct)
          produitsSnapshot = [...produitsSnapshot.filter(p => p.id !== created.id), created]
          resolvedLignes.push({ ...l, produit_id: created.id, pendingProduct: undefined })
        } else {
          resolvedLignes.push(l)
        }
      }
      setProduits(produitsSnapshot)

      const serialErr = validateSerialLines(resolvedLignes, produitsSnapshot)
      if (serialErr) throw new Error(serialErr)

      const factureId = generateId()
      const now = new Date().toISOString()
      const mHT = resolvedLignes.reduce((s, l) => s + l.quantite * l.nouveau_prix_achat, 0)
      const mTTC = resolvedLignes.reduce((s, l) => s + l.quantite * l.nouveau_prix_achat * (1 + l.tva_taux / 100), 0)
      const remise = parseFloat(remiseGlobale) || 0
      const timbreVal = parseFloat(timbre) || 0
      const tvaAmount = exoFlag ? 0 : mTTC - mHT
      const totalGeneral = (exoFlag ? mHT : mTTC) - remise + timbreVal
      // TVA split by rate
      const ht7 = resolvedLignes.filter(l => l.tva_taux === 7).reduce((s, l) => s + l.quantite * l.nouveau_prix_achat, 0)
      const tva7 = ht7 * 0.07
      const ht19 = resolvedLignes.filter(l => l.tva_taux === 19).reduce((s, l) => s + l.quantite * l.nouveau_prix_achat, 0)
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
      const lignesData = resolvedLignes.map(l => {
        const p = produitsSnapshot.find(p => p.id === l.produit_id)
        const tracksSerial = !!l.tracks_serial
        return {
          id: generateId(), facture_id: factureId, produit_id: l.produit_id || null,
          designation: l.designation, quantite: l.quantite,
          ancien_prix_achat: p?.prix_achat ?? null,
          nouveau_prix_achat: l.nouveau_prix_achat,
          prix_vente_suggere: +(l.nouveau_prix_achat * (1 + margePct / 100)).toFixed(3),
          prix_vente_applique: null, tva_taux: l.tva_taux,
          numeros_serie_json: tracksSerial
            ? JSON.stringify(syncSerialNumsForQty(l.numeros_serie, l.quantite).map(s => s.trim()))
            : null,
        }
      })
      await api.facturesFournisseursCreate(facture, lignesData)
      if (draftId) await api.facturesFournisseursDeleteDraft?.(draftId)
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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto animate-slide-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-white z-10">
          <h2 className="font-bold text-base flex items-center gap-2 flex-wrap">
            <FileText size={15} /> {isBL ? 'Nouveau Bon de Livraison' : 'Nouvelle Facture Fournisseur'}
            {(draftId || savingDraft || hasDraftContent) && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                {savingDraft ? 'Sauvegarde…' : draftSavedAt ? `Brouillon · ${new Date(draftSavedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : hasDraftContent ? 'Brouillon en cours' : 'Brouillon'}
              </span>
            )}
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
            <button type="button" onClick={handleClose}><X size={18} className="text-text-muted" /></button>
          </div>
        </div>
        {isBL && (
          <div className="px-6 py-2 bg-blue-50 border-b border-blue-100 text-xs text-blue-700 flex items-center gap-2">
            <PackageCheck size={13} /> Le stock ne sera <strong>pas mis à jour</strong> avant de marquer comme reçu.
          </div>
        )}
        <div className="px-6 py-2 bg-amber-50 border-b border-amber-100 text-xs text-amber-900 flex items-center gap-2">
          <Tag size={13} className="flex-shrink-0" />
          <span>Les nouveaux produits restent en <strong>brouillon</strong> jusqu&apos;à l&apos;enregistrement — le stock n&apos;est mis à jour qu&apos;à la validation finale. Auto-sauvegarde toutes les 2 s.</span>
        </div>
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
            <div className="hidden sm:grid grid-cols-[2rem_1fr_3.5rem_5.5rem_5.5rem_4.5rem] gap-2 px-3 pb-1 text-[10px] font-semibold text-text-muted uppercase tracking-wide">
              <span>#</span>
              <span>Produit / désignation</span>
              <span className="text-center">Qté</span>
              <span>P. achat</span>
              <span className="text-right">Total HT</span>
              <span className="text-right">Actions</span>
            </div>
            <div className="space-y-2">
              {lignes.map((l, i) => {
                const bc = ligneBarcodeInfo(l, produits)
                return (
                <div key={l.id} className="bg-muted rounded-xl p-3 space-y-2 border border-border/60">
                  <div className="flex items-start gap-2">
                    <span className="text-xs text-text-muted font-bold w-8 text-center flex-shrink-0 pt-2">{i + 1}</span>
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="relative">
                        <div className="flex items-center gap-1.5 border border-border rounded-lg px-2 py-1.5 bg-white">
                          <Search size={11} className="text-text-muted flex-shrink-0" />
                          <input
                            value={lineSearches[l.id] ?? ''}
                            onChange={e => onLineSearch(l.id, e.target.value)}
                            className="flex-1 min-w-0 bg-transparent text-xs outline-none"
                            placeholder={l.produit_id ? (produits.find(p => p.id === l.produit_id)?.nom ?? 'Chercher produit ou scanner code-barres…') : 'Chercher produit ou scanner code-barres…'}
                          />
                          <button type="button" onClick={() => { setPopupLineId(l.id); setShowProductPopup(true) }} title="Parcourir produits" className="text-accent-600 hover:text-accent-800 flex-shrink-0 p-1 rounded hover:bg-accent-50">
                            <Package size={12} />
                          </button>
                          {l.pendingProduct && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 flex-shrink-0 whitespace-nowrap">Nouveau (brouillon)</span>
                          )}
                          {l.produit_id && (
                            <button type="button" onClick={() => updateLigne(l.id, 'produit_id', '')} className="text-text-muted hover:text-danger flex-shrink-0" title="Retirer le produit lié"><X size={10} /></button>
                          )}
                        </div>
                        {((lineResults[l.id] ?? []).length > 0 || ((lineSearches[l.id]?.length ?? 0) >= 2 && (lineResults[l.id] ?? []).length === 0)) && (
                          <div className="absolute top-full left-0 right-0 z-20 bg-white border border-border rounded-lg shadow-lg mt-0.5 max-h-48 overflow-y-auto">
                            {(lineResults[l.id] ?? []).map(p => (
                              <button key={p.id} onClick={() => selectProduct(l.id, p)}
                                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted text-left text-xs border-b border-border last:border-0">
                                <span className={p.type === 'F' ? 'badge-F text-[9px]' : 'badge-NF text-[9px]'}>{p.type}</span>
                                <span className="flex-1 truncate font-medium">{p.nom}</span>
                                {p.code_barre && <span className="font-mono text-[10px] text-text-muted">{p.code_barre}</span>}
                                <span className="font-price text-text-muted">{formatPrice(p.prix_achat ?? p.prix_vente)}</span>
                              </button>
                            ))}
                            {(lineSearches[l.id]?.length ?? 0) >= 2 && (
                              <button
                                onClick={() => { setQuickCreateLineId(l.id); setQuickCreate({ nom: lineSearches[l.id] ?? '', prixAchat: '', prixVente: '' }); setLineResults(prev => ({ ...prev, [l.id]: [] })); setLineSearches(prev => ({ ...prev, [l.id]: '' })) }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs bg-accent-50 text-accent-700 font-semibold hover:bg-accent-100 rounded-b-lg"
                              >
                                <Plus size={11} /> Créer &ldquo;{lineSearches[l.id]}&rdquo; (brouillon)
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-[1fr_3.5rem_5.5rem_5.5rem] gap-2 items-center">
                        <input value={l.designation} onChange={e => updateLigne(l.id, 'designation', e.target.value)} className="w-full border border-border rounded-lg px-2 py-1.5 text-xs bg-white min-w-0" placeholder="Désignation *" />
                        <input type="text" inputMode="numeric" value={l.quantite} onChange={e => updateLigne(l.id, 'quantite', parseInt(e.target.value.replace(/[^0-9]/g, '')) || 1)} className="w-full border border-border rounded-lg px-2 py-1.5 text-xs font-price bg-white text-center" title="Quantité" />
                        <input type="text" inputMode="decimal" value={l.nouveau_prix_achat} onChange={e => updateLigne(l.id, 'nouveau_prix_achat', parseFloat(e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.')) || 0)} className="w-full border border-border rounded-lg px-2 py-1.5 text-xs font-price bg-white" placeholder="P. achat" />
                        <span className="text-xs font-price text-text-secondary text-right pr-1">{formatPrice(l.quantite * l.nouveau_prix_achat)}</span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 flex-shrink-0 pt-1">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => toggleLineSerial(l.id)}
                          title={l.tracks_serial ? 'Désactiver S/N' : 'Activer S/N par unité'}
                          className={cn(
                            'px-1.5 py-1 rounded-lg border text-[9px] font-bold transition-colors',
                            l.tracks_serial
                              ? 'bg-amber-100 border-amber-400 text-amber-900'
                              : 'bg-white border-border text-text-muted hover:border-amber-300',
                          )}
                        >
                          S/N
                        </button>
                        <button
                          type="button"
                          onClick={() => openSerialModal(l.id)}
                          title="Saisir numéros de série"
                          className={cn(
                            'p-2 rounded-lg border transition-colors relative',
                            l.tracks_serial
                              ? 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100'
                              : 'bg-white border-border text-text-muted hover:border-amber-300 hover:text-amber-800',
                          )}
                        >
                          <Hash size={14} />
                          {l.tracks_serial && (
                            <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-amber-600 text-white text-[8px] font-bold flex items-center justify-center">
                              {serialFilledCount(l)}/{l.quantite}
                            </span>
                          )}
                        </button>
                      </div>
                      {bc ? (
                        <button
                          type="button"
                          title={`Imprimer étiquette — ${bc.code}`}
                          onClick={() => printBarcodeLabel(bc.code, bc.nom, bc.prix, bc.ref)}
                          className="p-2 rounded-lg border border-border bg-white text-accent-700 hover:bg-accent-50 hover:border-accent-300 transition-colors"
                        >
                          <Printer size={14} />
                        </button>
                      ) : (
                        <div className="p-2 rounded-lg border border-dashed border-border/80 bg-white/50 opacity-40" title="Étiquette disponible après sélection ou création produit">
                          <Printer size={14} className="text-text-muted" />
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => removeLigne(l.id)}
                        className="p-2 rounded-lg border border-red-200 bg-red-50 text-danger hover:bg-red-100 transition-colors"
                        title="Supprimer la ligne"
                      >
                        <X size={14} />
                      </button>
                    </div>
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
                          disabled={!quickCreate.nom.trim() || !quickCreate.prixVente}
                          className="px-3 py-1 text-xs font-bold bg-accent-500 hover:bg-accent-600 disabled:bg-gray-200 disabled:text-gray-400 rounded-lg transition-colors"
                        >
                          Ajouter au brouillon
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                )
              })}
            </div>
          </div>

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
          <button type="button" onClick={handleClose} className="flex-1 bg-muted hover:bg-border text-text-primary font-semibold py-2.5 rounded-xl text-sm transition-colors">Annuler</button>
          <button
            type="button"
            onClick={() => {
              const fourn = fournisseurs.find(f => f.id === fournisseurId)
              const remise = parseFloat(remiseGlobale) || 0
              const timbreVal = parseFloat(timbre) || 0
              setPrintPreview({
                doc: buildAchatInvoiceDoc({
                  numero: numeroFacture || 'BROUILLON',
                  type: isBL ? 'FACTURE_ACHAT_BL' : 'FACTURE_ACHAT',
                  fournisseurNom: fourn?.nom ?? 'Fournisseur',
                  fournisseurTel: fourn?.telephone,
                  fournisseurAdresse: fourn?.adresse,
                  fournisseurMatricule: fourn?.matricule_fiscal,
                  dateFacture,
                  montantHT,
                  montantTVA: montantTTC - montantHT,
                  montantTTC,
                  exoFlag,
                  exoText,
                  remiseGlobale: remise,
                  timbre: timbreVal,
                }),
                lignes: mapFactureAchatLignes(lignes, produits, exoFlag),
              })
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
      {serialModalLineId && (() => {
        const l = lignes.find(x => x.id === serialModalLineId)
        if (!l) return null
        return (
          <FactureSerialModal
            designation={l.designation}
            quantite={l.quantite}
            numeros_serie={l.numeros_serie}
            onSave={nums => saveLineSerials(l.id, nums)}
            onClose={() => setSerialModalLineId(null)}
          />
        )
      })()}
      {/* Product Search Popup — multi-add mode (stays open until user closes) */}
      {showProductPopup && (
        <ProductSearchPopup
          produits={produits}
          onAddProduct={(p) => {
            const newLine = newLineFromProduct(p, 1)
            setLignes(prev => [...prev, newLine])
            setPopupLineId(newLine.id)
          }}
          onNewProduct={(pending) => {
            const newId = generateId()
            setLignes(prev => [...prev, {
              id: newId,
              designation: pending.nom,
              quantite: 1,
              nouveau_prix_achat: pending.prix_achat ?? pending.prix_vente,
              tva_taux: pending.tva_taux ?? 0,
              produit_id: '',
              pendingProduct: pending,
            }])
            setPopupLineId(newId)
          }}
          onProductUpdated={(updated) => {
            setProduits(prev => prev.map(p => p.id === updated.id ? updated : p))
            setLignes(prev => prev.map(l =>
              l.produit_id === updated.id
                ? mergeProductIntoLine(l, updated)
                : l
            ))
          }}
          onClose={() => { setShowProductPopup(false); setPopupLineId(null) }}
        />
      )}

      {barcodePrint && (
        <BarcodeLabelPrintDialog
          code={barcodePrint.code}
          nom={barcodePrint.nom}
          prix={barcodePrint.prix}
          productRef={barcodePrint.ref}
          onClose={() => setBarcodePrint(null)}
        />
      )}

      {printPreview && (
        <FactureAchatPrintModal
          preview={printPreview}
          onClose={() => setPrintPreview(null)}
        />
      )}

      {showCloseDialog && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4 animate-slide-in">
            <h3 className="font-bold text-base">Fermer la facture ?</h3>
            <p className="text-sm text-text-secondary">Vous avez des modifications non enregistrées. Que souhaitez-vous faire ?</p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => { void persistDraft().finally(() => { setShowCloseDialog(false); onClose() }) }}
                className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm"
              >
                Sauvegarder le brouillon
              </button>
              <button
                type="button"
                onClick={discardDraftAndClose}
                className="w-full py-2.5 rounded-xl bg-red-50 hover:bg-red-100 border border-red-200 text-red-800 font-semibold text-sm"
              >
                Supprimer le brouillon
              </button>
              <button
                type="button"
                onClick={() => setShowCloseDialog(false)}
                className="w-full py-2.5 rounded-xl bg-muted hover:bg-border font-semibold text-sm"
              >
                Continuer l&apos;édition
              </button>
            </div>
          </div>
        </div>
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

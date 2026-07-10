import { useState, useEffect, useCallback, Fragment, type ReactNode } from 'react'
import type { Vente, LigneVente, Reparation, Document as DocType, Produit } from '../../lib/types'

interface Client { id: string; nom: string; telephone?: string; adresse?: string; matricule_fiscal?: string; solde_credit: number }
import { formatPrice, formatDate, generateId } from '../../lib/utils'
import { cn } from '../../lib/utils'
import { useAppStore } from '../../store/appStore'
import { loadData, runAction } from '../../lib/apiCall'
import { showToast } from '../../lib/toast'
import {
  ShoppingBag, Wrench, Calendar, Download, RefreshCw, ChevronDown, ChevronUp,
  CreditCard, Banknote, FileCheck, Layers, X, Eye, TrendingUp, Bike,
  CheckCircle, Clock, Package, FileText, Ban, Plus, Search, Printer, ScrollText
} from 'lucide-react'
import * as XLSX from 'xlsx'
import DocumentPrintModal from './DocumentPrintModal'
import { ConvertVenteDocModal, printVenteTicketQuick } from './VenteHistoriqueActions'
import type { Document as DocType } from '../../lib/types'
import { ACTIVITY_LABELS, formatActivityDetails } from '../../lib/activityLabels'

const api = window.api
const HISTORIQUE_PRESET_KEY = 'smlpos_historique_preset'
const HISTORIQUE_FROM_KEY = 'smlpos_historique_from'
const HISTORIQUE_TO_KEY = 'smlpos_historique_to'

type SubTab = 'ventes' | 'reparations' | 'documents' | 'journal'
type StatutRep = 'EN_ATTENTE' | 'EN_COURS' | 'TERMINE' | 'RENDU' | 'ANNULE'

const STATUT_CONFIG: Record<StatutRep, { label: string; color: string; icon: ReactNode }> = {
  EN_ATTENTE: { label: 'En attente', color: 'bg-yellow-100 text-yellow-800 border border-yellow-200', icon: <Clock size={11} /> },
  EN_COURS: { label: 'En cours', color: 'bg-blue-100 text-blue-800 border border-blue-200', icon: <RefreshCw size={11} /> },
  TERMINE: { label: 'Terminé', color: 'bg-green-100 text-green-800 border border-green-200', icon: <CheckCircle size={11} /> },
  RENDU: { label: 'Rendu', color: 'bg-gray-100 text-gray-600 border border-gray-200', icon: <Package size={11} /> },
  ANNULE: { label: 'Annulé', color: 'bg-red-100 text-red-700 border border-red-200', icon: <X size={11} /> },
}

const MODE_ICONS: Record<string, ReactNode> = {
  ESPECES: <Banknote size={13} />,
  CARTE: <CreditCard size={13} />,
  CHEQUE: <FileCheck size={13} />,
  MIXTE: <Layers size={13} />,
}

const MODE_LABELS: Record<string, string> = {
  ESPECES: 'Espèces',
  CARTE: 'Carte',
  CHEQUE: 'Chèque',
  MIXTE: 'Mixte',
}

function getDateRange(preset: string): { from: string; to: string } {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  if (preset === 'today') return { from: today, to: today + 'T23:59:59' }
  if (preset === 'week') {
    const start = new Date(now)
    start.setDate(now.getDate() - now.getDay())
    return { from: start.toISOString().slice(0, 10), to: today + 'T23:59:59' }
  }
  if (preset === 'month') {
    return { from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, to: today + 'T23:59:59' }
  }
  if (preset === '90days') {
    const start = new Date(now)
    start.setDate(now.getDate() - 90)
    return { from: start.toISOString().slice(0, 10), to: today + 'T23:59:59' }
  }
  return { from: '', to: '' }
}

function loadStoredPreset(): string {
  try { return localStorage.getItem(HISTORIQUE_PRESET_KEY) || 'month' } catch { return 'month' }
}

function loadStoredDate(key: string, fallback: string): string {
  try { return localStorage.getItem(key) || fallback } catch { return fallback }
}

export default function HistoriqueTab() {
  const { currentOperateur, currentShift } = useAppStore()
  const initialPreset = loadStoredPreset()
  const monthRange = getDateRange('month')
  const [subTab, setSubTab] = useState<SubTab>('ventes')
  const [dateFrom, setDateFrom] = useState(() =>
    initialPreset === 'custom'
      ? loadStoredDate(HISTORIQUE_FROM_KEY, new Date().toISOString().slice(0, 10))
      : getDateRange(initialPreset).from || monthRange.from
  )
  const [dateTo, setDateTo] = useState(() =>
    initialPreset === 'custom'
      ? loadStoredDate(HISTORIQUE_TO_KEY, new Date().toISOString().slice(0, 10))
      : getDateRange(initialPreset).to.slice(0, 10)
  )
  const [preset, setPreset] = useState<string>(initialPreset)
  const [ventes, setVentes] = useState<Vente[]>([])
  const [reparations, setReparations] = useState<Reparation[]>([])
  const [documents, setDocuments] = useState<DocType[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedVente, setExpandedVente] = useState<string | null>(null)
  const [venteLignes, setVenteLignes] = useState<Record<string, LigneVente[]>>({})
  const [expandedRep, setExpandedRep] = useState<string | null>(null)
  const [updatingStatut, setUpdatingStatut] = useState<string | null>(null)
  const [cancelTarget, setCancelTarget] = useState<Vente | null>(null)
  const [showNewDoc, setShowNewDoc] = useState(false)
  const [printDoc, setPrintDoc] = useState<DocType | null>(null)
  const [convertVente, setConvertVente] = useState<Vente | null>(null)
  const [activityLogs, setActivityLogs] = useState<Array<{
    id: string; shift_id?: string; operateur?: string; action: string; details?: unknown; montant?: number; created_at: string
  }>>([])
  const [journalActionFilter, setJournalActionFilter] = useState('')
  const [beneficeStats, setBeneficeStats] = useState<{
    overall: { benefice_net: number; nb: number }
    breakdown: {
      type_appareil: string; nb: number; total_pieces: number; total_encaisse: number; benefice_net: number
      part_technicien: number; part_hamdi: number | null; part_hamma: number | null
    }[]
    part_sml: number
    part_materiel: number
    part_techniciens: number
    benefice_mootez: number
  } | null>(null)

  const applyPreset = (p: string) => {
    setPreset(p)
    try {
      localStorage.setItem(HISTORIQUE_PRESET_KEY, p)
    } catch { /* ignore */ }
    if (p !== 'custom') {
      const { from, to } = getDateRange(p)
      setDateFrom(from)
      setDateTo(to.slice(0, 10))
      try {
        localStorage.setItem(HISTORIQUE_FROM_KEY, from)
        localStorage.setItem(HISTORIQUE_TO_KEY, to.slice(0, 10))
      } catch { /* ignore */ }
    }
  }

  const load = useCallback(async () => {
    const from = dateFrom
    const to = dateTo + 'T23:59:59'
    const data = await loadData('Chargement historique', async () => {
      const [v, r, docs, bStats, logs] = await Promise.all([
        api.ventesList({ dateFrom: from, dateTo: to }) as Promise<Vente[]>,
        api.reparationsList({}) as Promise<Reparation[]>,
        api.documentsList({ dateFrom, dateTo }) as Promise<DocType[]>,
        api.reparationsGetBeneficeStats() as Promise<typeof beneficeStats>,
        api.logsList({ dateFrom: from, dateTo: to, limit: 500 }) as Promise<typeof activityLogs>,
      ])
      return { v, r, docs, bStats, logs }
    }, { setLoading })
    if (!data) return
    setVentes(data.v || [])
    const filtered = (data.r || []).filter(rep => {
      const d = rep.created_at.slice(0, 10)
      return d >= dateFrom && d <= dateTo
    })
    setReparations(filtered)
    setDocuments(data.docs || [])
    setBeneficeStats(data.bStats)
    setActivityLogs(data.logs || [])
  }, [dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  const toggleVente = async (id: string) => {
    if (expandedVente === id) { setExpandedVente(null); return }
    setExpandedVente(id)
    if (!venteLignes[id]) {
      const lignes = await loadData('Chargement lignes vente', () => api.ventesGetLignes(id) as Promise<LigneVente[]>, { silent: true })
      if (lignes) setVenteLignes(prev => ({ ...prev, [id]: lignes }))
    }
  }

  const handleCancelVente = async (vente: Vente, motif: string) => {
    await runAction('Annulation vente', async () => {
      await api.ventesAnnuler(vente.id, { annule_par: currentOperateur?.nom ?? 'superadmin', annule_motif: motif })
      setCancelTarget(null)
      load()
    }, { successMessage: 'Vente annulée' })
  }

  const handleConvertVente = async (vente: Vente) => {
    const lignes = await api.ventesGetLignes(vente.id) as LigneVente[]
    if (!lignes.length) {
      showToast('error', 'Conversion impossible : vente sans lignes.')
      return
    }
    setConvertVente(vente)
  }

  const updateStatut = async (repId: string, statut: StatutRep) => {
    setUpdatingStatut(repId)
    await runAction('Mise à jour réparation', async () => {
      await api.reparationsUpdateStatut(repId, statut)
      setReparations(prev => prev.map(r => r.id === repId ? { ...r, statut } : r))
    }, { successMessage: 'Statut mis à jour' })
    setUpdatingStatut(null)
  }

  const activeVentes = ventes.filter(v => v.type === 'VENTE' && v.statut !== 'ANNULEE')
  const totalVentes = activeVentes.reduce((s, v) => s + v.total_ttc, 0)
  const totalReparations = reparations.filter(r => r.statut !== 'ANNULE').reduce((s, r) => s + r.total_estime, 0)

  const exportVentes = () => {
    const rows = ventes.map(v => ({
      'N°': v.numero,
      'Date': formatDate(v.created_at),
      'Opérateur': v.operateur_nom || '',
      'Mode': MODE_LABELS[v.mode_paiement] || v.mode_paiement,
      'Remises': v.total_remises,
      'Total TTC': v.total_ttc,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Ventes')
    XLSX.writeFile(wb, `ventes-${dateFrom}-${dateTo}.xlsx`)
  }

  const exportReparations = () => {
    const rows = reparations.map(r => ({
      'N°': r.numero,
      'Date': formatDate(r.created_at),
      'Client': r.client_nom || '',
      'Téléphone': r.client_tel || '',
      'Appareil': r.type_appareil,
      'Marque': r.marque || '',
      'Modèle': r.modele || '',
      'Panne': r.description_panne,
      'Main d\'œuvre': r.main_oeuvre,
      'Acompte': r.acompte,
      'Total estimé': r.total_estime,
      'Statut': STATUT_CONFIG[r.statut as StatutRep]?.label || r.statut,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Réparations')
    XLSX.writeFile(wb, `reparations-${dateFrom}-${dateTo}.xlsx`)
  }

  const PRESETS = [
    { id: 'today', label: "Aujourd'hui" },
    { id: 'week', label: 'Cette semaine' },
    { id: 'month', label: 'Ce mois' },
    { id: '90days', label: '90 jours' },
    { id: 'custom', label: 'Personnalisé' },
  ]

  const filteredLogs = journalActionFilter
    ? activityLogs.filter(l => l.action === journalActionFilter)
    : activityLogs

  const journalActions = [...new Set(activityLogs.map(l => l.action))].sort()

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-white border-b border-border flex-shrink-0 flex-wrap gap-y-2">
        {/* Preset buttons */}
        <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
          {PRESETS.map(p => (
            <button
              key={p.id}
              onClick={() => applyPreset(p.id)}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-semibold transition-colors',
                preset === p.id ? 'bg-white shadow-sm text-text-primary' : 'text-text-secondary hover:text-text-primary'
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Date range */}
        <div className="flex items-center gap-2">
          <Calendar size={14} className="text-text-muted" />
          <input
            type="date"
            value={dateFrom}
            onChange={e => { setDateFrom(e.target.value); setPreset('custom'); try { localStorage.setItem(HISTORIQUE_PRESET_KEY, 'custom'); localStorage.setItem(HISTORIQUE_FROM_KEY, e.target.value) } catch { /* ignore */ } }}
            className="border border-border rounded-lg px-2 py-1 text-xs font-mono"
          />
          <span className="text-text-muted text-xs">→</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => { setDateTo(e.target.value); setPreset('custom'); try { localStorage.setItem(HISTORIQUE_PRESET_KEY, 'custom'); localStorage.setItem(HISTORIQUE_TO_KEY, e.target.value) } catch { /* ignore */ } }}
            className="border border-border rounded-lg px-2 py-1 text-xs font-mono"
          />
        </div>

        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-500 hover:bg-accent-600 text-text-primary font-semibold rounded-lg text-xs transition-colors"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Actualiser
        </button>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={subTab === 'ventes' ? exportVentes : exportReparations}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-muted border border-border text-text-secondary hover:text-text-primary font-semibold rounded-lg text-xs transition-colors"
          >
            <Download size={13} />
            Exporter Excel
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 px-4 py-3 bg-surface border-b border-border flex-shrink-0">
        <div className="bg-white rounded-xl border border-border px-4 py-3 shadow-card">
          <div className="text-xs font-semibold text-text-secondary mb-1 flex items-center gap-1">
            <ShoppingBag size={12} /> Ventes (période)
          </div>
          <div className="text-lg font-bold font-price">{formatPrice(totalVentes)}</div>
          <div className="text-xs text-text-muted">{activeVentes.length} transactions actives</div>
        </div>
        <div className="bg-white rounded-xl border border-border px-4 py-3 shadow-card">
          <div className="text-xs font-semibold text-text-secondary mb-1 flex items-center gap-1">
            <Wrench size={12} /> Réparations
          </div>
          <div className="text-lg font-bold font-price">{formatPrice(totalReparations)}</div>
          <div className="text-xs text-text-muted">{reparations.length} dossiers</div>
        </div>
        <div className="bg-white rounded-xl border border-border px-4 py-3 shadow-card">
          <div className="text-xs font-semibold text-text-secondary mb-1 flex items-center gap-1">
            <TrendingUp size={12} /> Total encaissé
          </div>
          <div className="text-lg font-bold font-price text-success">{formatPrice(totalVentes + totalReparations)}</div>
          <div className="text-xs text-text-muted">Ventes + Réparations</div>
        </div>
        <div className="bg-white rounded-xl border border-border px-4 py-3 shadow-card">
          <div className="text-xs font-semibold text-text-secondary mb-1 flex items-center gap-1">
            <Clock size={12} /> Réparations en attente
          </div>
          <div className="text-lg font-bold font-price text-warning">
            {reparations.filter(r => r.statut === 'EN_ATTENTE' || r.statut === 'EN_COURS').length}
          </div>
          <div className="text-xs text-text-muted">À traiter</div>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-0 bg-white border-b border-border px-4 flex-shrink-0">
        {[
          { id: 'ventes' as SubTab, label: 'Ventes', icon: ShoppingBag, count: ventes.length },
          { id: 'reparations' as SubTab, label: 'Réparations', icon: Wrench, count: reparations.length },
          { id: 'documents' as SubTab, label: 'Documents Clients', icon: FileText, count: documents.length },
          { id: 'journal' as SubTab, label: 'Journal', icon: ScrollText, count: activityLogs.length },
        ].map(t => {
          const Icon = t.icon
          return (
            <button key={t.id} onClick={() => setSubTab(t.id)}
              className={cn('flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-all',
                subTab === t.id ? 'border-accent-500 text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary hover:bg-muted')}>
              <Icon size={14} />
              {t.label}
              <span className={cn('text-xs font-bold rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center',
                subTab === t.id ? 'bg-accent-500 text-text-primary' : 'bg-muted text-text-secondary')}>
                {t.count}
              </span>
            </button>
          )
        })}
        {subTab === 'documents' && (
          <div className="ml-auto pr-1 flex items-center">
            <button
              onClick={() => setShowNewDoc(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-500 hover:bg-accent-600 text-black text-xs font-bold rounded-lg transition-colors"
            >
              <Plus size={12} /> Nouveau document
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {subTab === 'ventes' && (
            <VentesTable
            ventes={ventes}
            expandedVente={expandedVente}
            venteLignes={venteLignes}
            onToggle={toggleVente}
            onCancel={setCancelTarget}
            onPrintTicket={(v) => void printVenteTicketQuick(v)}
            onConvert={(v) => void handleConvertVente(v)}
              emptyHint={preset === 'today' ? 'Essayez « Ce mois » ou « 90 jours » pour voir les ventes passées.' : undefined}
            />
        )}
        {subTab === 'reparations' && (
          <>
            {/* Bénéfice Dashboard v1.7 */}
            {beneficeStats && (
              <div className="px-4 py-4 bg-white border-b border-border flex-shrink-0 space-y-3">
                {/* Row 1 — totaux */}
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-2.5 min-w-[160px]">
                    <TrendingUp size={15} className="text-green-600 flex-shrink-0" />
                    <div>
                      <div className="text-[10px] font-semibold text-green-700 uppercase tracking-wider">Total mois</div>
                      <div className="font-price font-bold text-green-800">{formatPrice(beneficeStats.overall.benefice_net ?? 0)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-2.5 min-w-[140px]">
                    <div>
                      <div className="text-[10px] font-semibold text-yellow-700 uppercase tracking-wider">Bénéfice SML</div>
                      <div className="font-price font-bold text-yellow-800">{formatPrice(beneficeStats.part_sml ?? 0)}</div>
                      <div className="text-[9px] text-yellow-600">÷3</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 bg-purple-50 border border-purple-200 rounded-xl px-4 py-2.5 min-w-[140px]">
                    <div>
                      <div className="text-[10px] font-semibold text-purple-700 uppercase tracking-wider">Matériel</div>
                      <div className="font-price font-bold text-purple-800">{formatPrice(beneficeStats.part_materiel ?? 0)}</div>
                      <div className="text-[9px] text-purple-600">÷3</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 min-w-[140px]">
                    <div>
                      <div className="text-[10px] font-semibold text-blue-700 uppercase tracking-wider">Techniciens</div>
                      <div className="font-price font-bold text-blue-800">{formatPrice(beneficeStats.part_techniciens ?? 0)}</div>
                      <div className="text-[9px] text-blue-600">÷3</div>
                    </div>
                  </div>
                </div>
                {/* Row 2 — par catégorie */}
                {beneficeStats.breakdown.length > 0 && (
                  <div className="flex items-stretch gap-2 flex-wrap">
                    <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider self-center">Par catégorie :</span>
                    {beneficeStats.breakdown.map(b => {
                      const icon = b.type_appareil === 'PC' ? '💻' : b.type_appareil === 'SCOOTER' ? '🛵' : b.type_appareil === 'SMARTPHONE' ? '📱' : '🖨️'
                      return (
                        <div key={b.type_appareil} className="bg-muted border border-border rounded-xl px-3 py-2 text-xs">
                          <div className="font-semibold text-text-primary mb-0.5">{icon} {b.type_appareil}</div>
                          <div className="font-price font-bold">{formatPrice(b.benefice_net ?? 0)} total</div>
                          {b.type_appareil === 'SMARTPHONE' ? (
                            <div className="text-[10px] text-text-secondary mt-0.5">
                              Hamdi: <span className="font-bold text-text-primary">{formatPrice(b.part_hamdi ?? 0)}</span>
                              {' '}· Hamma: <span className="font-bold text-text-primary">{formatPrice(b.part_hamma ?? 0)}</span>
                            </div>
                          ) : (
                            <div className="text-[10px] text-text-secondary mt-0.5">
                              Technicien: <span className="font-bold text-text-primary">{formatPrice(b.part_technicien ?? 0)}</span>
                            </div>
                          )}
                          <div className="text-[10px] text-text-muted">{b.nb} répar.</div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
            <ReparationsTable
              reparations={reparations}
              expandedRep={expandedRep}
              setExpandedRep={setExpandedRep}
              updatingStatut={updatingStatut}
              onUpdateStatut={updateStatut}
            />
          </>
        )}
        {subTab === 'documents' && (
          <DocumentsTable documents={documents} onRefresh={load} onPrint={setPrintDoc} />
        )}
        {subTab === 'journal' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 px-1">
              <label className="text-xs font-semibold text-text-secondary">Filtrer par action</label>
              <select
                value={journalActionFilter}
                onChange={e => setJournalActionFilter(e.target.value)}
                className="border border-border rounded-lg px-3 py-1.5 text-sm bg-white focus:border-accent-500 outline-none"
              >
                <option value="">Toutes les actions</option>
                {journalActions.map(a => (
                  <option key={a} value={a}>{ACTIVITY_LABELS[a] ?? a}</option>
                ))}
              </select>
              <span className="text-xs text-text-muted ml-auto">{filteredLogs.length} entrée(s)</span>
            </div>
            {filteredLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-text-muted">
                <ScrollText size={36} className="mb-3 opacity-30" />
                <p className="font-medium">Aucune activité sur cette période</p>
                <p className="text-xs mt-1">
                  Période : {PRESETS.find(p => p.id === preset)?.label ?? preset} — essayez <button type="button" onClick={() => applyPreset('month')} className="text-accent-600 underline">Ce mois</button> ou <button type="button" onClick={() => applyPreset('90days')} className="text-accent-600 underline">90 jours</button>
                </p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted border-b border-border z-10">
                    <tr>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-text-secondary">Date</th>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-text-secondary">Opérateur</th>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-text-secondary">Action</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-text-secondary">Montant</th>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-text-secondary">Détails</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLogs.map(log => (
                      <tr key={log.id} className="border-b border-border hover:bg-muted/50">
                        <td className="px-4 py-2.5 text-xs text-text-secondary whitespace-nowrap">{formatDate(log.created_at)}</td>
                        <td className="px-4 py-2.5 text-xs">{log.operateur || '—'}</td>
                        <td className="px-4 py-2.5">
                          <span className="text-xs font-medium bg-muted px-2 py-0.5 rounded-full">
                            {ACTIVITY_LABELS[log.action] ?? log.action}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-price text-xs">
                          {log.montant != null && log.montant > 0 ? formatPrice(log.montant) : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-text-secondary max-w-xs truncate" title={formatActivityDetails(log.details)}>
                          {formatActivityDetails(log.details) || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Cancel Vente Modal */}
      {cancelTarget && (
        <CancelVenteModal
          vente={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onConfirm={(motif) => handleCancelVente(cancelTarget, motif)}
        />
      )}
      {/* New Document Modal */}
      {showNewDoc && (
        <NewDocumentModal
          currentShift={currentShift as { id?: string; operateur_nom?: string } | null}
          currentOperateur={currentOperateur as { nom?: string } | null}
          onClose={() => setShowNewDoc(false)}
          onSaved={() => { setShowNewDoc(false); load() }}
        />
      )}
      {/* Document Print Modal */}
      {printDoc && (
        <DocumentPrintModal doc={printDoc} onClose={() => setPrintDoc(null)} />
      )}
      {convertVente && (
        <ConvertVenteDocModal
          vente={convertVente}
          onClose={() => setConvertVente(null)}
          onCreated={() => { setConvertVente(null); load() }}
        />
      )}
    </div>
  )
}

// ─── Ventes Table ─────────────────────────────────────────────────────────────

function VentesTable({
  ventes, expandedVente, venteLignes, onToggle, onCancel, onPrintTicket, onConvert, emptyHint,
}: {
  ventes: Vente[]; expandedVente: string | null; venteLignes: Record<string, LigneVente[]>
  onToggle: (id: string) => void; onCancel: (v: Vente) => void
  onPrintTicket: (v: Vente) => void; onConvert: (v: Vente) => void; emptyHint?: string
}) {
  if (ventes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-text-muted">
        <ShoppingBag size={36} className="mb-3 opacity-30" />
        <p className="font-medium">Aucune vente sur cette période</p>
        {emptyHint && <p className="text-xs mt-1 text-center max-w-sm">{emptyHint}</p>}
      </div>
    )
  }

  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 bg-muted border-b border-border z-10">
        <tr>
          <th className="text-left px-4 py-2.5 text-xs font-semibold text-text-secondary">N°</th>
          <th className="text-left px-4 py-2.5 text-xs font-semibold text-text-secondary">Date</th>
          <th className="text-left px-4 py-2.5 text-xs font-semibold text-text-secondary">Opérateur</th>
          <th className="text-center px-4 py-2.5 text-xs font-semibold text-text-secondary">Mode</th>
          <th className="text-right px-4 py-2.5 text-xs font-semibold text-text-secondary">Remises</th>
          <th className="text-right px-4 py-2.5 text-xs font-semibold text-text-secondary">Total TTC</th>
          <th className="text-center px-4 py-2.5 text-xs font-semibold text-text-secondary">Statut</th>
          <th className="text-center px-4 py-2.5 text-xs font-semibold text-text-secondary">Actions</th>
          <th className="w-8 px-4 py-2.5"></th>
        </tr>
      </thead>
      <tbody>
        {ventes.map(v => {
          const annulee = v.statut === 'ANNULEE'
          return (
            <Fragment key={v.id}>
              <tr
                onClick={() => onToggle(v.id)}
                className={cn('border-b border-border hover:bg-muted/50 cursor-pointer transition-colors', annulee && 'opacity-50')}
              >
                <td className={cn('px-4 py-2.5 font-mono text-xs font-semibold text-text-secondary', annulee && 'line-through')}>{v.numero}</td>
                <td className="px-4 py-2.5 text-xs text-text-secondary">{formatDate(v.created_at)}</td>
                <td className="px-4 py-2.5 text-xs font-medium">{v.operateur_nom || '—'}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-center gap-1 text-xs text-text-secondary">
                    {MODE_ICONS[v.mode_paiement]}
                    <span>{MODE_LABELS[v.mode_paiement] || v.mode_paiement}</span>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right">
                  {v.total_remises > 0 ? (
                    <span className="text-xs font-price text-danger">-{formatPrice(v.total_remises)}</span>
                  ) : <span className="text-xs text-text-muted">—</span>}
                </td>
                <td className="px-4 py-2.5 text-right font-price font-bold">{formatPrice(v.total_ttc)}</td>
                <td className="px-4 py-2.5 text-center">
                  {annulee ? (
                    <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Annulée</span>
                  ) : (
                    <button
                      onClick={e => { e.stopPropagation(); onCancel(v) }}
                      className="text-xs text-red-600 hover:bg-red-50 border border-red-200 px-2 py-0.5 rounded-lg flex items-center gap-1 mx-auto"
                    >
                      <Ban size={10} /> Annuler
                    </button>
                  )}
                </td>
                <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
                  {!annulee && (
                    <div className="flex items-center justify-center gap-1 flex-wrap">
                      <button type="button" onClick={() => onPrintTicket(v)} title="Imprimer ticket"
                        className="p-1.5 border border-border rounded-lg hover:bg-muted text-text-secondary">
                        <Printer size={12} />
                      </button>
                      <button type="button" onClick={() => onConvert(v)} title="Facture / BL / Devis"
                        className="p-1.5 border border-border rounded-lg hover:bg-muted text-text-secondary text-[10px] font-bold px-2">
                        Doc
                      </button>
                    </div>
                  )}
                </td>
                <td className="px-4 py-2.5 text-center text-text-muted">
                  {expandedVente === v.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </td>
              </tr>
              {expandedVente === v.id && (
                <tr className="bg-accent-50">
                  <td colSpan={9} className="px-6 py-3">
                    <div className="text-xs font-semibold text-text-secondary mb-2 flex items-center gap-1">
                      <Eye size={12} /> Détail de la vente
                      {annulee && v.annule_motif && <span className="ml-2 text-red-600">— Motif: {v.annule_motif}</span>}
                    </div>
                    {venteLignes[v.id] ? (
                      <div className="space-y-1.5">
                        {venteLignes[v.id].map(l => (
                          <div key={l.id} className="flex items-center gap-3 bg-white rounded-lg px-3 py-2 border border-border">
                            <span className={l.type_produit === 'F' ? 'badge-F' : 'badge-NF'}>{l.type_produit}</span>
                            <span className="flex-1 font-medium text-xs">{l.designation}</span>
                            <span className="text-xs text-text-muted">×{l.quantite}</span>
                            <span className="text-xs font-price text-text-secondary">{formatPrice(l.prix_unitaire)}</span>
                            {l.remise_pct > 0 && <span className="text-xs text-danger font-medium">-{l.remise_pct}%</span>}
                            <span className="text-xs font-price font-bold">{formatPrice(l.total_ligne)}</span>
                          </div>
                        ))}
                        <div className="flex justify-end pt-1">
                          <div className="text-right">
                            {v.total_remises > 0 && (
                              <div className="text-xs text-danger font-price mb-0.5">Remises: -{formatPrice(v.total_remises)}</div>
                            )}
                            <div className="text-sm font-bold font-price">Total: {formatPrice(v.total_ttc)}</div>
                            {v.monnaie_rendue && v.monnaie_rendue > 0 && (
                              <div className="text-xs text-success font-price">Monnaie: {formatPrice(v.monnaie_rendue)}</div>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-text-muted py-2">Chargement...</div>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )
}

// ─── Réparations Table ────────────────────────────────────────────────────────

const STATUTS: StatutRep[] = ['EN_ATTENTE', 'EN_COURS', 'TERMINE', 'RENDU', 'ANNULE']

function ReparationsTable({
  reparations,
  expandedRep,
  setExpandedRep,
  updatingStatut,
  onUpdateStatut,
}: {
  reparations: Reparation[]
  expandedRep: string | null
  setExpandedRep: (id: string | null) => void
  updatingStatut: string | null
  onUpdateStatut: (id: string, statut: StatutRep) => void
}) {
  if (reparations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-text-muted">
        <Wrench size={36} className="mb-3 opacity-30" />
        <p className="font-medium">Aucune réparation sur cette période</p>
      </div>
    )
  }

  const toggle = (id: string) => setExpandedRep(expandedRep === id ? null : id)

  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 bg-muted border-b border-border z-10">
        <tr>
          <th className="text-left px-4 py-2.5 text-xs font-semibold text-text-secondary">N°</th>
          <th className="text-left px-4 py-2.5 text-xs font-semibold text-text-secondary">Date</th>
          <th className="text-left px-4 py-2.5 text-xs font-semibold text-text-secondary">Client</th>
          <th className="text-left px-4 py-2.5 text-xs font-semibold text-text-secondary">Appareil</th>
          <th className="text-left px-4 py-2.5 text-xs font-semibold text-text-secondary">Panne</th>
          <th className="text-center px-4 py-2.5 text-xs font-semibold text-text-secondary">Statut</th>
          <th className="text-right px-4 py-2.5 text-xs font-semibold text-text-secondary">Total estimé</th>
          <th className="w-8 px-4 py-2.5"></th>
        </tr>
      </thead>
      <tbody>
        {reparations.map(r => {
          const sc = STATUT_CONFIG[r.statut as StatutRep] || STATUT_CONFIG.EN_ATTENTE
          return (
            <Fragment key={r.id}>
              <tr
                onClick={() => toggle(r.id)}
                className="border-b border-border hover:bg-muted/50 cursor-pointer transition-colors"
              >
                <td className="px-4 py-2.5 font-mono text-xs font-semibold text-text-secondary">{r.numero}</td>
                <td className="px-4 py-2.5 text-xs text-text-secondary">{formatDate(r.created_at, 'dd/MM/yy HH:mm')}</td>
                <td className="px-4 py-2.5">
                  <div className="text-xs font-medium">{r.client_nom || '—'}</div>
                  {r.client_tel && <div className="text-xs text-text-muted font-mono">{r.client_tel}</div>}
                </td>
                <td className="px-4 py-2.5">
                  <div className="text-xs font-medium">{r.type_appareil}</div>
                  {(r.marque || r.modele) && (
                    <div className="text-xs text-text-muted">{[r.marque, r.modele].filter(Boolean).join(' ')}</div>
                  )}
                </td>
                <td className="px-4 py-2.5 text-xs text-text-secondary max-w-[180px] truncate">{r.description_panne}</td>
                <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
                  <div className="flex justify-center">
                    <select
                      value={r.statut}
                      onChange={e => onUpdateStatut(r.id, e.target.value as StatutRep)}
                      disabled={updatingStatut === r.id}
                      className={cn(
                        'text-xs font-semibold px-2 py-1 rounded-full border cursor-pointer',
                        sc.color
                      )}
                    >
                      {STATUTS.map(s => (
                        <option key={s} value={s}>{STATUT_CONFIG[s].label}</option>
                      ))}
                    </select>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right font-price font-bold text-sm">{formatPrice(r.total_estime)}</td>
                <td className="px-4 py-2.5 text-center text-text-muted">
                  {expandedRep === r.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </td>
              </tr>
              {expandedRep === r.id && (
                <tr className="bg-accent-50">
                  <td colSpan={8} className="px-6 py-3">
                    <div className="text-xs font-semibold text-text-secondary mb-2 flex items-center gap-1">
                      <Eye size={12} /> Détail de la réparation
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-xs">
                      <div>
                        <div className="text-text-muted mb-1">Description panne</div>
                        <div className="font-medium">{r.description_panne}</div>
                      </div>
                      <div>
                        <div className="text-text-muted mb-1">Opérateur</div>
                        <div className="font-medium">{r.operateur_nom || '—'}</div>
                      </div>
                      <div className="text-right">
                        <div className="flex justify-between font-price">
                          <span className="text-text-muted">Pièces (M.O.):</span>
                          <span>{formatPrice(r.main_oeuvre)}</span>
                        </div>
                        <div className="flex justify-between font-price">
                          <span className="text-text-muted">Acompte:</span>
                          <span className="text-success">{formatPrice(r.acompte)}</span>
                        </div>
                        <div className="flex justify-between font-price font-bold mt-1 pt-1 border-t border-border">
                          <span>Total client:</span>
                          <span>{formatPrice(r.total_final ?? r.total_estime)}</span>
                        </div>
                        {r.benefice !== undefined && (
                          <div className={`flex justify-between font-price font-bold ${(r.benefice ?? 0) >= 0 ? 'text-success' : 'text-danger'}`}>
                            <span>Bénéfice:</span>
                            <span>{(r.benefice ?? 0) >= 0 ? '+' : ''}{formatPrice(r.benefice ?? 0)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )
}

// ─── Documents Table ───────────────────────────────────────────────────────────

const DOC_TYPE_LABELS: Record<string, string> = {
  FACTURE_VENTE: 'Facture', DEVIS: 'Devis', BON_LIVRAISON: 'Bon de Livraison',
  FACTURE_JOURNALIERE_F: 'Facture Journalière', TICKET: 'Ticket',
}
const DOC_TYPE_COLORS: Record<string, string> = {
  FACTURE_VENTE: 'bg-blue-100 text-blue-800', DEVIS: 'bg-yellow-100 text-yellow-800',
  BON_LIVRAISON: 'bg-purple-100 text-purple-800', FACTURE_JOURNALIERE_F: 'bg-teal-100 text-teal-800',
  TICKET: 'bg-gray-100 text-gray-700',
}

function DocumentsTable({ documents, onPrint }: { documents: DocType[]; onRefresh: () => void; onPrint: (d: DocType) => void }) {
  const [typeFilter, setTypeFilter] = useState<string>('all')
  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-text-muted">
        <FileText size={36} className="mb-3 opacity-30" />
        <p className="font-medium">Aucun document sur cette période</p>
      </div>
    )
  }
  const filtered = typeFilter === 'all' ? documents : documents.filter(d => d.type_document === typeFilter)
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-white sticky top-0 z-10">
        {['all', 'FACTURE_VENTE', 'DEVIS', 'BON_LIVRAISON'].map(t => (
          <button key={t} onClick={() => setTypeFilter(t)}
            className={cn('px-3 py-1 text-xs rounded-lg font-medium transition-colors',
              typeFilter === t ? 'bg-accent-500 text-black' : 'bg-muted text-text-secondary hover:bg-muted/80')}>
            {t === 'all' ? 'Tous' : DOC_TYPE_LABELS[t]}
          </button>
        ))}
        <span className="ml-auto text-xs text-text-muted">{filtered.length} document{filtered.length !== 1 ? 's' : ''}</span>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-muted border-b border-border">
          <tr>
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-text-secondary">N°</th>
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-text-secondary">Type</th>
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-text-secondary">Client</th>
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-text-secondary">Date</th>
            <th className="text-right px-4 py-2.5 text-xs font-semibold text-text-secondary">Total TTC</th>
            <th className="text-center px-4 py-2.5 text-xs font-semibold text-text-secondary">Statut</th>
            <th className="w-10 px-2 py-2.5"></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(d => (
            <tr key={d.id} className="border-b border-border hover:bg-muted/50">
              <td className="px-4 py-2.5 font-mono text-xs font-semibold text-text-secondary">{d.numero}</td>
              <td className="px-4 py-2.5">
                <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', DOC_TYPE_COLORS[d.type_document] ?? 'bg-gray-100 text-gray-700')}>
                  {DOC_TYPE_LABELS[d.type_document] ?? d.type_document}
                </span>
              </td>
              <td className="px-4 py-2.5 text-xs font-medium">{d.client_nom || '—'}</td>
              <td className="px-4 py-2.5 text-xs text-text-secondary">{formatDate(d.created_at)}</td>
              <td className="px-4 py-2.5 text-right font-price font-bold">{formatPrice(d.total_ttc)}</td>
              <td className="px-4 py-2.5 text-center">
                <span className={cn('text-xs px-2 py-0.5 rounded-full',
                  d.statut === 'ACTIF' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>
                  {d.statut === 'ACTIF' ? 'Actif' : d.statut}
                </span>
              </td>
              <td className="px-2 py-2.5 text-center">
                <button
                  onClick={() => onPrint(d)}
                  title="Imprimer"
                  className="p-1.5 rounded-lg text-text-muted hover:text-accent-600 hover:bg-accent-50 transition-colors"
                >
                  <Printer size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Cancel Vente Modal ────────────────────────────────────────────────────────

function CancelVenteModal({ vente, onClose, onConfirm }: {
  vente: Vente; onClose: () => void; onConfirm: (motif: string) => void
}) {
  const [motif, setMotif] = useState('')
  const [error, setError] = useState('')
  const handleConfirm = () => {
    if (!motif.trim()) { setError('Le motif est obligatoire'); return }
    onConfirm(motif)
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-red-700 flex items-center gap-2"><Ban size={16} /> Annuler la vente</h2>
          <button onClick={onClose}><X size={18} className="text-text-muted" /></button>
        </div>
        <p className="text-sm text-text-secondary">
          Confirmer l'annulation de <strong>{vente.numero}</strong> ({formatPrice(vente.total_ttc)}) ?<br />
          <span className="text-xs text-text-muted">Le stock sera automatiquement restauré.</span>
        </p>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-secondary">Motif (obligatoire)</label>
          <textarea value={motif} onChange={e => setMotif(e.target.value)} rows={2}
            placeholder="Ex: Erreur de saisie, client annulé..."
            className="px-3 py-2 border border-border rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-400/30" />
        </div>
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-border rounded-lg text-text-secondary">Fermer</button>
          <button type="button" onClick={handleConfirm}
            className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg">
            Confirmer l'annulation
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── New Document Modal (Facture / Devis / BL) ─────────────────────────────────
const DOC_TYPES = [
  { id: 'FACTURE_VENTE', label: 'Facture', color: 'border-blue-500 bg-blue-50 text-blue-700' },
  { id: 'DEVIS',         label: 'Devis',   color: 'border-yellow-500 bg-yellow-50 text-yellow-700' },
  { id: 'BON_LIVRAISON', label: 'Bon de Livraison', color: 'border-purple-500 bg-purple-50 text-purple-700' },
]

function NewDocumentModal({
  currentShift, currentOperateur, onClose, onSaved,
}: {
  currentShift: { id?: string; operateur_nom?: string } | null
  currentOperateur: { nom?: string } | null
  onClose: () => void
  onSaved: () => void
}) {
  const [typeDoc, setTypeDoc] = useState<string>('FACTURE_VENTE')
  const [clients, setClients] = useState<Client[]>([])
  const [produits, setProduits] = useState<Produit[]>([])
  const [clientSearch, setClientSearch] = useState('')
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [lignes, setLignes] = useState([{ id: generateId(), produit_id: '', designation: '', quantite: 1, prix_unitaire: 0, remise_pct: 0, tva_taux: 0 }])
  const [notes, setNotes] = useState('')
  const [dateEcheance, setDateEcheance] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [currentSettings, setCurrentSettings] = useState<Record<string, string>>({})

  useEffect(() => {
    loadData('Chargement clients', () => api.clientsList({}), { silent: true }).then(c => {
      if (c) setClients(c as Client[])
    })
    loadData('Chargement produits', () => api.produitsList({}), { silent: true }).then(p => {
      if (p) setProduits(p as Produit[])
    })
    loadData('Chargement paramètres', () => api.settingsGetAll(), { silent: true }).then(s => {
      if (s) setCurrentSettings(s as Record<string, string>)
    })
  }, [])

  // F-only products for FACTURE_VENTE and DEVIS, all for BON_LIVRAISON
  const availableProduits = (typeDoc === 'FACTURE_VENTE' || typeDoc === 'DEVIS')
    ? produits.filter(p => p.type === 'F')
    : produits

  const filteredClients = clientSearch
    ? clients.filter(c => c.nom.toLowerCase().includes(clientSearch.toLowerCase()) || (c.telephone ?? '').includes(clientSearch))
    : clients

  const addLigne = () => setLignes(prev => [...prev, { id: generateId(), produit_id: '', designation: '', quantite: 1, prix_unitaire: 0, remise_pct: 0, tva_taux: 0 }])
  const removeLigne = (id: string) => setLignes(prev => prev.filter(l => l.id !== id))
  const updateLigne = (id: string, field: string, value: unknown) => {
    setLignes(prev => prev.map(l => {
      if (l.id !== id) return l
      const updated = { ...l, [field]: value }
      if (field === 'produit_id' && value) {
        const p = produits.find(p => p.id === value)
        if (p) {
          updated.designation = p.nom
          updated.prix_unitaire = p.prix_vente
          updated.tva_taux = p.tva_taux ?? 19
        }
      }
      return updated
    }))
  }

  const totalHT = lignes.reduce((s, l) => {
    const ttc = l.quantite * l.prix_unitaire * (1 - l.remise_pct / 100)
    const ht = ttc / (1 + (l.tva_taux || 0) / 100)
    return s + ht
  }, 0)
  const totalTVA = lignes.reduce((s, l) => {
    const ttc = l.quantite * l.prix_unitaire * (1 - l.remise_pct / 100)
    const ht = ttc / (1 + (l.tva_taux || 0) / 100)
    const tva = ttc - ht
    return s + tva
  }, 0)
  const totalTTC = totalHT + totalTVA

  const handleSave = async () => {
    const filled = lignes.filter(l => l.designation.trim())
    if (filled.length === 0) { setError('Ajoutez au moins une ligne'); return }
    if (typeDoc === 'DEVIS') {
      const hasNf = filled.some(l => {
        const p = produits.find(prod => prod.id === l.produit_id)
        return p?.type === 'NF'
      })
      if (hasNf) {
        setError('Les devis ne peuvent pas contenir de produits NF')
        return
      }
    }
    setError('')
    await runAction('Création document', async () => {
      const docId = generateId()
      const now = new Date().toISOString()
      const lastNum = await api.documentsGetLastNumber(typeDoc) as number
      const prefix = typeDoc === 'FACTURE_VENTE' ? 'FAC' : typeDoc === 'DEVIS' ? 'DEV' : 'BL'
      const date = now.slice(0, 10).replace(/-/g, '')
      const numero = `${prefix}-${date}-${String((lastNum ?? 0) + 1).padStart(3, '0')}`

      const lignesData = filled.map(l => {
        const ttc = l.quantite * l.prix_unitaire * (1 - l.remise_pct / 100)
        const ht = ttc / (1 + (l.tva_taux || 0) / 100)
        const tva = ttc - ht
        const pu_ht = l.prix_unitaire / (1 + (l.tva_taux || 0) / 100)

        const p = produits.find(prod => prod.id === l.produit_id)
        const typeProduit = p?.type ?? 'F'

        return {
          id: generateId(), document_id: docId,
          produit_id: l.produit_id || null,
          designation: l.designation,
          quantite: l.quantite,
          prix_unitaire: Math.round(pu_ht * 1000) / 1000,
          remise_pct: l.remise_pct,
          tva_taux: l.tva_taux,
          total_ht: Math.round(ht * 1000) / 1000,
          total_tva: Math.round(tva * 1000) / 1000,
          total_ttc: Math.round(ttc * 1000) / 1000,
          type_produit: typeProduit,
        }
      })

      let ht_7 = 0, tva_7 = 0, ht_19 = 0, tva_19 = 0
      for (const line of lignesData) {
        const rate = Math.round(line.tva_taux || 0)
        if (rate <= 7) {
          ht_7 += line.total_ht
          tva_7 += line.total_tva
        } else {
          ht_19 += line.total_ht
          tva_19 += line.total_tva
        }
      }

      const isFacture = typeDoc === 'FACTURE_VENTE' || typeDoc === 'FACTURE_JOURNALIERE_F'
      const timbre = isFacture ? 1.0 : 0.0
      const totalHTRounded = Math.round(totalHT * 1000) / 1000
      const totalTVARounded = Math.round(totalTVA * 1000) / 1000
      const totalTTCRounded = Math.round((totalHTRounded + totalTVARounded) * 1000) / 1000
      const netPay = Math.round((totalTTCRounded + timbre) * 1000) / 1000

      const doc = {
        id: docId, numero, type_document: typeDoc, statut: 'ACTIF',
        shift_id: currentShift?.id ?? null,
        client_id: selectedClient?.id ?? null,
        client_nom: selectedClient?.nom ?? null,
        client_tel: selectedClient?.telephone ?? null,
        client_adresse: selectedClient?.adresse ?? null,
        client_matricule: selectedClient?.matricule_fiscal ?? null,
        total_ht: totalHTRounded,
        total_tva: totalTVARounded,
        total_ttc: totalTTCRounded,
        statut_paiement: 'PAYE',
        montant_paye: netPay,
        date_echeance: dateEcheance || null,
        notes: notes || null, imprimee: 0,
        layout_snapshot: JSON.stringify(currentSettings),
        timbre,
        total_remise: 0,
        exo: null,
        tva_taux_principal: 19.0,
        ht_7: Math.round(ht_7 * 1000) / 1000,
        tva_7: Math.round(tva_7 * 1000) / 1000,
        ht_19: Math.round(ht_19 * 1000) / 1000,
        tva_19: Math.round(tva_19 * 1000) / 1000,
        created_at: now,
      }

      await api.documentsCreate(doc, lignesData)
      onSaved()
    }, { setSaving, silent: true, onError: setError, successMessage: 'Document créé' })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-border px-6 py-4 flex items-center justify-between z-10">
          <h2 className="font-bold text-base flex items-center gap-2"><FileText size={15} /> Nouveau document client</h2>
          <button onClick={onClose}><X size={18} className="text-text-muted" /></button>
        </div>

        <div className="p-6 flex flex-col gap-5">
          {/* Type selector */}
          <div>
            <p className="text-xs font-semibold text-text-secondary mb-2 uppercase tracking-wider">Type de document</p>
            <div className="flex gap-3">
              {DOC_TYPES.map(t => (
                <button key={t.id} onClick={() => setTypeDoc(t.id)}
                  className={cn('flex-1 py-2.5 rounded-xl border-2 text-sm font-bold transition-all', typeDoc === t.id ? t.color : 'border-border text-text-secondary hover:bg-muted')}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Client search */}
          <div>
            <p className="text-xs font-semibold text-text-secondary mb-2 uppercase tracking-wider">Client</p>
            {selectedClient ? (
              <div className="flex items-center justify-between bg-accent-50 border border-accent-200 rounded-xl px-4 py-2.5">
                <div>
                  <p className="text-sm font-semibold">{selectedClient.nom}</p>
                  {selectedClient.telephone && <p className="text-xs text-text-muted">{selectedClient.telephone}</p>}
                </div>
                <button onClick={() => setSelectedClient(null)} className="text-text-muted hover:text-danger">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div>
                <div className="relative mb-2">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input value={clientSearch} onChange={e => setClientSearch(e.target.value)}
                    placeholder="Rechercher un client..."
                    className="w-full pl-9 pr-3 py-2.5 border border-border rounded-xl text-sm outline-none focus:border-accent-500" />
                </div>
                {clientSearch && (
                  <div className="border border-border rounded-xl overflow-hidden max-h-36 overflow-y-auto">
                    {filteredClients.slice(0, 8).map(c => (
                      <button key={c.id} onClick={() => { setSelectedClient(c); setClientSearch('') }}
                        className="w-full text-left px-4 py-2 text-sm hover:bg-muted border-b border-border last:border-0">
                        <p className="font-medium">{c.nom}</p>
                        {c.telephone && <p className="text-xs text-text-muted">{c.telephone}</p>}
                      </button>
                    ))}
                    {filteredClients.length === 0 && <p className="text-xs text-text-muted text-center py-3">Aucun client trouvé</p>}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Lines */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Lignes</p>
              <button onClick={addLigne} className="flex items-center gap-1 text-xs px-2.5 py-1 bg-muted hover:bg-border rounded-lg font-semibold">
                <Plus size={11} /> Ajouter ligne
              </button>
            </div>
            <div className="space-y-2">
              {lignes.map((l, i) => (
                <div key={l.id} className="grid grid-cols-12 gap-1.5 items-center bg-muted rounded-xl p-2">
                  <div className="col-span-1 text-xs text-text-muted text-center font-bold">{i + 1}</div>
                  <div className="col-span-3">
                    <select value={l.produit_id} onChange={e => updateLigne(l.id, 'produit_id', e.target.value)}
                      className="w-full border border-border rounded-lg px-2 py-1.5 text-xs bg-white outline-none">
                      <option value="">Produit (optionnel)</option>
                      {availableProduits.map(p => <option key={p.id} value={p.id}>{p.type === 'NF' ? `[NF] ${p.nom}` : p.nom}</option>)}
                    </select>
                  </div>
                  <div className="col-span-3">
                    <input value={l.designation} onChange={e => updateLigne(l.id, 'designation', e.target.value)}
                      placeholder="Désignation *"
                      className="w-full border border-border rounded-lg px-2 py-1.5 text-xs bg-white outline-none" />
                  </div>
                  <div className="col-span-1">
                    <input type="text" inputMode="decimal" value={l.quantite} onChange={e => updateLigne(l.id, 'quantite', parseFloat(e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.')) || 1)}
                      className="w-full border border-border rounded-lg px-2 py-1.5 text-xs font-price bg-white outline-none text-center" />
                  </div>
                  <div className="col-span-2">
                    <input type="text" inputMode="decimal" value={l.prix_unitaire} onChange={e => updateLigne(l.id, 'prix_unitaire', parseFloat(e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.')) || 0)}
                      className="w-full border border-border rounded-lg px-2 py-1.5 text-xs font-price bg-white outline-none" placeholder="Prix" />
                  </div>
                  <div className="col-span-1 text-xs font-price text-right text-text-secondary">
                    {formatPrice(l.quantite * l.prix_unitaire)}
                  </div>
                  <div className="col-span-1 text-right">
                    {lignes.length > 1 && (
                      <button onClick={() => removeLigne(l.id)} className="text-danger hover:text-red-700"><X size={12} /></button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Totals + notes */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-text-secondary mb-1.5">Notes</p>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                className="w-full border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-accent-500 resize-none" />
              {(typeDoc === 'DEVIS' || typeDoc === 'BON_LIVRAISON') && (
                <div className="mt-2">
                  <p className="text-xs font-semibold text-text-secondary mb-1">Date d'échéance</p>
                  <input type="date" value={dateEcheance} onChange={e => setDateEcheance(e.target.value)}
                    className="w-full border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-accent-500" />
                </div>
              )}
            </div>
            <div className="bg-muted rounded-xl p-4 space-y-2">
              <div className="flex justify-between text-sm"><span className="text-text-secondary">Sous-total HT</span><span className="font-price">{formatPrice(totalHT)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-text-secondary">TVA</span><span className="font-price">{formatPrice(totalTVA)}</span></div>
              <div className="flex justify-between font-bold text-base border-t border-border pt-2"><span>Total TTC</span><span className="font-price">{formatPrice(totalTTC)}</span></div>
            </div>
          </div>

          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        </div>

        <div className="sticky bottom-0 bg-white border-t border-border px-6 py-4 flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 bg-muted hover:bg-border font-semibold py-2.5 rounded-xl text-sm">Annuler</button>
          <button type="button" onClick={handleSave} disabled={saving}
            className="flex-1 bg-accent-500 hover:bg-accent-600 disabled:bg-gray-200 disabled:text-gray-400 font-bold py-2.5 rounded-xl text-sm">
            {saving ? 'Enregistrement...' : `Créer ${DOC_TYPES.find(t => t.id === typeDoc)?.label} — ${formatPrice(totalTTC)}`}
          </button>
        </div>
      </div>
    </div>
  )
}

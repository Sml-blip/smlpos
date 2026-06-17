import { useState, useEffect, useCallback } from 'react'
import { formatPrice, generateId } from '../../lib/utils'
import { cn } from '../../lib/utils'
import {
  Lock, Vault, TrendingUp, TrendingDown, RefreshCw, Plus, X,
  DollarSign, ArrowUpCircle, ArrowDownCircle, Search,
  BarChart3, List, User, Tag, Calendar, Clock, Hash, FileText
} from 'lucide-react'
import { runAction, loadData } from '../../lib/apiCall'

const api = window.api

interface Mouvement {
  id: string; date_journal: string; type: 'ENTREE' | 'SORTIE'
  categorie: string; montant: number; reference_id?: string; note?: string
  operateur: string; created_at: string
}
interface CaisseJournal {
  id: string; date_journal: string; solde_ouverture: number
  total_entrees: number; total_sorties: number
}
interface StatAgent {
  operateur: string; total_entrees: number; total_sorties: number; count: number
}
interface StatCategorie {
  categorie: string; type: 'ENTREE' | 'SORTIE'; count: number; total: number
}
interface StatDay {
  date_journal: string; entrees: number; sorties: number; count: number
}

const CAT_LABELS: Record<string, string> = {
  TRANSFERT_CAISSE_EXTERNE: 'Transfert caisse externe',
  VENTE_EN_LIGNE: 'Vente en ligne',
  SORTIE_INTERNE: 'Sortie interne',
  ENTREE_MANUELLE: 'Entrée manuelle',
  AUTRE: 'Autre',
}
const CAT_COLORS: Record<string, string> = {
  TRANSFERT_CAISSE_EXTERNE: 'bg-blue-100 text-blue-800',
  VENTE_EN_LIGNE: 'bg-purple-100 text-purple-800',
  SORTIE_INTERNE: 'bg-orange-100 text-orange-800',
  ENTREE_MANUELLE: 'bg-green-100 text-green-800',
  AUTRE: 'bg-gray-100 text-gray-700',
}

function todayStr() { return new Date().toISOString().slice(0, 10) }
function weekStart() {
  const d = new Date(); d.setDate(d.getDate() - d.getDay() + 1); return d.toISOString().slice(0, 10)
}
function monthStart() {
  const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function days30Ago() {
  const d = new Date(); d.setDate(d.getDate() - 29); return d.toISOString().slice(0, 10)
}

const DATE_PRESETS = [
  { id: 'today',  label: "Aujourd'hui", from: () => todayStr(),   to: () => todayStr() },
  { id: 'week',   label: 'Cette semaine', from: () => weekStart(), to: () => todayStr() },
  { id: 'month',  label: 'Ce mois',    from: () => monthStart(),   to: () => todayStr() },
  { id: '30days', label: '30 jours',   from: () => days30Ago(),    to: () => todayStr() },
  { id: 'all',    label: 'Tout',       from: () => '2020-01-01',   to: () => todayStr() },
  { id: 'custom', label: 'Personnalisé', from: () => todayStr(),   to: () => todayStr() },
]

export default function CaisseInterneTab() {
  const [unlocked, setUnlocked] = useState(false)
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState(false)
  const [correctPin, setCorrectPin] = useState('sml2023')

  useEffect(() => {
    void loadData('Chargement paramètres caisse', async () => {
      const v = await api.settingsGet('caisse_interne_pin') as unknown
      if (v) setCorrectPin(v as string)
    }, { silent: true })
  }, [])

  const handlePin = () => {
    if (pin === correctPin) { setUnlocked(true); setPinError(false) }
    else { setPinError(true); setPin('') }
  }

  if (!unlocked) {
    return (
      <div className="h-full flex items-center justify-center bg-surface">
        <div className="bg-white rounded-2xl shadow-2xl w-[360px] p-8 animate-slide-in">
          <div className="flex flex-col items-center mb-6">
            <div className="w-16 h-16 bg-accent-50 border-2 border-accent-400 rounded-2xl flex items-center justify-center mb-3">
              <Vault size={28} className="text-text-primary" />
            </div>
            <h2 className="font-bold text-lg">Caisse Interne</h2>
            <p className="text-sm text-text-muted mt-1">Accès restreint — entrez le code PIN</p>
          </div>
          <div className="space-y-3">
            <input
              type="password"
              value={pin}
              onChange={e => { setPin(e.target.value); setPinError(false) }}
              onKeyDown={e => e.key === 'Enter' && handlePin()}
              className={cn('w-full border rounded-xl px-4 py-3 text-center text-xl font-mono tracking-widest outline-none transition-colors',
                pinError ? 'border-danger bg-red-50' : 'border-border focus:border-accent-500')}
              placeholder="••••••••"
              autoFocus
              maxLength={20}
            />
            {pinError && <p className="text-xs text-danger text-center">Code PIN incorrect</p>}
            <button onClick={handlePin}
              className="w-full bg-accent-500 hover:bg-accent-600 text-text-primary font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2">
              <Lock size={15} /> Déverrouiller
            </button>
          </div>
        </div>
      </div>
    )
  }

  return <CaisseInterneView onLock={() => setUnlocked(false)} />
}

// ── Main view (after unlock) ──────────────────────────────────────────────────
function CaisseInterneView({ onLock }: { onLock: () => void }) {
  const today = todayStr()
  const [preset, setPreset] = useState('today')
  const [dateFrom, setDateFrom] = useState(today)
  const [dateTo, setDateTo] = useState(today)
  const [filterType, setFilterType] = useState<string>('all')
  const [filterCategorie, setFilterCategorie] = useState<string>('all')
  const [filterOperateur, setFilterOperateur] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<'journal' | 'stats'>('journal')
  const [mouvements, setMouvements] = useState<Mouvement[]>([])
  const [journal, setJournal] = useState<CaisseJournal | null>(null)
  const [stats, setStats] = useState<{ byAgent: StatAgent[]; byCategorie: StatCategorie[]; byDay: StatDay[]; agents: { operateur: string }[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)

  const applyPreset = useCallback((id: string) => {
    const p = DATE_PRESETS.find(d => d.id === id)
    if (p && id !== 'custom') {
      setDateFrom(p.from())
      setDateTo(p.to())
    }
    setPreset(id)
  }, [])

  const load = useCallback(async () => {
    const data = await loadData('Chargement caisse interne', async () => {
      const filters: Record<string, unknown> = { dateFrom, dateTo }
      if (filterType !== 'all') filters.type = filterType
      if (filterCategorie !== 'all') filters.categorie = filterCategorie
      if (filterOperateur !== 'all') filters.operateur = filterOperateur
      if (search) filters.search = search

      const [mvts, j, st] = await Promise.all([
        api.caisseInterneMouvementsList(filters) as Promise<Mouvement[]>,
        api.caisseInterneGetToday() as Promise<CaisseJournal>,
        api.caisseInterneGetStats(dateFrom, dateTo) as Promise<typeof stats>,
      ])
      return { mvts, j, st }
    }, { setLoading })
    if (data) {
      setMouvements(data.mvts)
      setJournal(data.j)
      setStats(data.st)
    }
  }, [dateFrom, dateTo, filterType, filterCategorie, filterOperateur, search])

  useEffect(() => { load() }, [load])

  // Running balance — compute cumulative sum over sorted movements
  const withBalance = (() => {
    // start from 0 as relative delta for the period
    let running = 0
    return mouvements.map(m => {
      running += m.type === 'ENTREE' ? m.montant : -m.montant
      return { ...m, running }
    })
  })()

  // KPIs for filtered period
  const totalEntrees = mouvements.filter(m => m.type === 'ENTREE').reduce((s, m) => s + m.montant, 0)
  const totalSorties = mouvements.filter(m => m.type === 'SORTIE').reduce((s, m) => s + m.montant, 0)
  const netPeriode = totalEntrees - totalSorties
  const soldeCourant = journal
    ? journal.solde_ouverture + journal.total_entrees - journal.total_sorties
    : 0

  // Distinct agents in filtered movements
  const agentList = [...new Set(mouvements.map(m => m.operateur))].filter(Boolean)

  return (
    <div className="h-full flex flex-col overflow-hidden bg-surface">
      {/* ── Top bar ── */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-white border-b border-border flex-shrink-0">
        <h2 className="font-bold text-sm flex items-center gap-2"><Vault size={15} /> Caisse Interne — Trésorerie</h2>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-500 hover:bg-accent-600 rounded-lg text-xs font-bold transition-colors">
            <Plus size={13} /> Mouvement
          </button>
          <button onClick={load} disabled={loading} className="p-1.5 text-text-muted hover:text-text-primary rounded-lg hover:bg-muted">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={onLock} className="p-1.5 text-text-muted hover:text-danger rounded-lg hover:bg-muted" title="Verrouiller">
            <Lock size={13} />
          </button>
        </div>
      </div>

      {/* ── Solde actuel (always today) ── */}
      <div className="px-4 pt-3 pb-0 flex-shrink-0">
        <div className="bg-text-primary text-white rounded-xl p-4 flex items-center justify-between shadow-lg">
          <div>
            <div className="text-xs font-semibold opacity-60 uppercase tracking-wider mb-0.5">Solde Actuel — Trésorerie</div>
            <div className="text-3xl font-bold font-price">{formatPrice(soldeCourant)}</div>
            <div className="text-xs opacity-50 mt-0.5">{today} · ouverture {formatPrice(journal?.solde_ouverture ?? 0)}</div>
          </div>
          <Vault size={36} className="opacity-20" />
        </div>
      </div>

      {/* ── Date range selector ── */}
      <div className="flex items-center gap-1 px-4 pt-3 flex-shrink-0 flex-wrap">
        {DATE_PRESETS.map(p => (
          <button key={p.id} onClick={() => applyPreset(p.id)}
            className={cn('px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors',
              preset === p.id ? 'bg-accent-500 text-text-primary' : 'bg-white border border-border text-text-secondary hover:bg-muted')}>
            {p.label}
          </button>
        ))}
        {preset === 'custom' && (
          <div className="flex items-center gap-1 ml-1">
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="border border-border rounded-lg px-2 py-1 text-xs outline-none focus:border-accent-500 bg-white" />
            <span className="text-xs text-text-muted">→</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="border border-border rounded-lg px-2 py-1 text-xs outline-none focus:border-accent-500 bg-white" />
          </div>
        )}
      </div>

      {/* ── KPIs for period ── */}
      <div className="grid grid-cols-4 gap-2 px-4 py-2 flex-shrink-0">
        <div className="bg-green-50 border border-green-200 rounded-xl p-3">
          <div className="text-xs font-semibold text-green-700 flex items-center gap-1"><ArrowUpCircle size={11} /> Entrées</div>
          <div className="text-base font-bold font-price text-green-800 mt-1">{formatPrice(totalEntrees)}</div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-3">
          <div className="text-xs font-semibold text-red-700 flex items-center gap-1"><ArrowDownCircle size={11} /> Sorties</div>
          <div className="text-base font-bold font-price text-red-800 mt-1">{formatPrice(totalSorties)}</div>
        </div>
        <div className={cn('rounded-xl border p-3', netPeriode >= 0 ? 'bg-blue-50 border-blue-200' : 'bg-orange-50 border-orange-200')}>
          <div className={cn('text-xs font-semibold flex items-center gap-1', netPeriode >= 0 ? 'text-blue-700' : 'text-orange-700')}><TrendingUp size={11} /> Net période</div>
          <div className={cn('text-base font-bold font-price mt-1', netPeriode >= 0 ? 'text-blue-800' : 'text-orange-800')}>{netPeriode >= 0 ? '+' : ''}{formatPrice(netPeriode)}</div>
        </div>
        <div className="bg-white border border-border rounded-xl p-3">
          <div className="text-xs font-semibold text-text-secondary flex items-center gap-1"><Hash size={11} /> Mouvements</div>
          <div className="text-base font-bold text-text-primary mt-1">{mouvements.length}</div>
        </div>
      </div>

      {/* ── Filters + Tabs ── */}
      <div className="flex items-center gap-2 px-4 py-2 bg-white border-y border-border flex-shrink-0 flex-wrap">
        {/* Tab toggle */}
        <div className="flex items-center gap-0.5 bg-muted rounded-lg p-0.5 flex-shrink-0">
          <button onClick={() => setActiveTab('journal')}
            className={cn('flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors',
              activeTab === 'journal' ? 'bg-white shadow-sm text-text-primary' : 'text-text-secondary hover:text-text-primary')}>
            <List size={11} /> Journal
          </button>
          <button onClick={() => setActiveTab('stats')}
            className={cn('flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors',
              activeTab === 'stats' ? 'bg-white shadow-sm text-text-primary' : 'text-text-secondary hover:text-text-primary')}>
            <BarChart3 size={11} /> Statistiques
          </button>
        </div>

        {/* Type */}
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="border border-border rounded-lg px-2 py-1.5 text-xs outline-none focus:border-accent-500 bg-white">
          <option value="all">Tous types</option>
          <option value="ENTREE">Entrées</option>
          <option value="SORTIE">Sorties</option>
        </select>

        {/* Catégorie */}
        <select value={filterCategorie} onChange={e => setFilterCategorie(e.target.value)}
          className="border border-border rounded-lg px-2 py-1.5 text-xs outline-none focus:border-accent-500 bg-white">
          <option value="all">Toutes catégories</option>
          {Object.entries(CAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>

        {/* Agent */}
        <select value={filterOperateur} onChange={e => setFilterOperateur(e.target.value)}
          className="border border-border rounded-lg px-2 py-1.5 text-xs outline-none focus:border-accent-500 bg-white">
          <option value="all">Tous agents</option>
          {agentList.map(a => <option key={a} value={a}>{a}</option>)}
        </select>

        {/* Search */}
        <div className="flex items-center gap-1.5 border border-border rounded-lg px-2.5 py-1.5 bg-white ml-auto">
          <Search size={11} className="text-text-muted" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            className="bg-transparent outline-none text-xs w-28" placeholder="Rechercher..." />
          {search && <button onClick={() => setSearch('')}><X size={11} className="text-text-muted" /></button>}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'journal' ? (
          <JournalView mouvements={withBalance} loading={loading} />
        ) : (
          <StatsView stats={stats} dateFrom={dateFrom} dateTo={dateTo} />
        )}
      </div>

      {showAddModal && <AddMouvementModal onClose={() => setShowAddModal(false)} onSaved={load} />}
    </div>
  )
}

// ── Journal (full detailed table) ─────────────────────────────────────────────
function JournalView({ mouvements, loading }: { mouvements: (Mouvement & { running: number })[]; loading: boolean }) {
  if (loading) return (
    <div className="flex items-center justify-center h-full text-text-muted text-sm">
      <RefreshCw size={18} className="animate-spin mr-2" /> Chargement...
    </div>
  )
  if (mouvements.length === 0) return (
    <div className="flex flex-col items-center justify-center h-full text-text-muted">
      <FileText size={40} className="mb-3 opacity-20" />
      <p className="text-sm">Aucun mouvement pour cette période</p>
    </div>
  )

  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-xs border-collapse">
        <thead className="sticky top-0 z-10">
          <tr className="bg-gray-50 border-b border-border">
            <th className="text-left px-3 py-2.5 font-semibold text-text-secondary whitespace-nowrap"><Calendar size={11} className="inline mr-1" />Date</th>
            <th className="text-left px-3 py-2.5 font-semibold text-text-secondary whitespace-nowrap"><Clock size={11} className="inline mr-1" />Heure</th>
            <th className="text-left px-3 py-2.5 font-semibold text-text-secondary">Type</th>
            <th className="text-left px-3 py-2.5 font-semibold text-text-secondary">Catégorie</th>
            <th className="text-left px-3 py-2.5 font-semibold text-text-secondary max-w-[200px]">Description / Note</th>
            <th className="text-left px-3 py-2.5 font-semibold text-text-secondary whitespace-nowrap"><Hash size={11} className="inline mr-1" />Référence</th>
            <th className="text-left px-3 py-2.5 font-semibold text-text-secondary whitespace-nowrap"><User size={11} className="inline mr-1" />Agent</th>
            <th className="text-right px-3 py-2.5 font-semibold text-text-secondary whitespace-nowrap">Montant</th>
            <th className="text-right px-3 py-2.5 font-semibold text-text-secondary whitespace-nowrap">Solde courant</th>
          </tr>
        </thead>
        <tbody>
          {[...mouvements].reverse().map((m, i) => {
            const dt = new Date(m.created_at)
            return (
              <tr key={m.id}
                className={cn('border-b border-border transition-colors hover:bg-accent-50',
                  i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50')}>
                <td className="px-3 py-2.5 whitespace-nowrap font-mono text-text-secondary">
                  {dt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap font-mono text-text-secondary">
                  {dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </td>
                <td className="px-3 py-2.5">
                  <span className={cn('inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-bold',
                    m.type === 'ENTREE' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800')}>
                    {m.type === 'ENTREE' ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                    {m.type === 'ENTREE' ? 'Entrée' : 'Sortie'}
                  </span>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <span className={cn('inline-block px-2 py-0.5 rounded-md text-[11px] font-medium',
                    CAT_COLORS[m.categorie] ?? 'bg-gray-100 text-gray-700')}>
                    {CAT_LABELS[m.categorie] ?? m.categorie}
                  </span>
                </td>
                <td className="px-3 py-2.5 max-w-[220px]">
                  {m.note
                    ? <span className="text-text-secondary truncate block" title={m.note}>{m.note}</span>
                    : <span className="text-text-muted italic">—</span>
                  }
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {m.reference_id
                    ? <span className="font-mono text-[10px] text-text-secondary bg-muted px-1.5 py-0.5 rounded">{m.reference_id.slice(0, 16)}{m.reference_id.length > 16 ? '…' : ''}</span>
                    : <span className="text-text-muted">—</span>
                  }
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <span className="flex items-center gap-1">
                    <span className="w-6 h-6 rounded-full bg-accent-100 text-text-primary font-bold text-[11px] flex items-center justify-center flex-shrink-0">
                      {(m.operateur ?? '?').slice(0, 2).toUpperCase()}
                    </span>
                    <span className="text-text-secondary capitalize">{m.operateur ?? '—'}</span>
                  </span>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-right">
                  <span className={cn('font-price font-bold', m.type === 'ENTREE' ? 'text-green-700' : 'text-red-700')}>
                    {m.type === 'ENTREE' ? '+' : '-'}{formatPrice(m.montant)}
                  </span>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-right">
                  <span className={cn('font-price font-semibold text-[11px]',
                    m.running >= 0 ? 'text-blue-700' : 'text-orange-700')}>
                    {formatPrice(m.running)}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Stats view ────────────────────────────────────────────────────────────────
function StatsView({ stats, dateFrom, dateTo }: {
  stats: { byAgent: StatAgent[]; byCategorie: StatCategorie[]; byDay: StatDay[]; agents: { operateur: string }[] } | null
  dateFrom: string; dateTo: string
}) {
  if (!stats) return (
    <div className="flex items-center justify-center h-full text-text-muted text-sm">
      <RefreshCw size={16} className="animate-spin mr-2" /> Chargement...
    </div>
  )

  // Regroup byCategorie
  type CatRow = { categorie: string; entrees: number; sorties: number; count: number }
  const catMap: Record<string, CatRow> = {}
  for (const r of stats.byCategorie) {
    if (!catMap[r.categorie]) catMap[r.categorie] = { categorie: r.categorie, entrees: 0, sorties: 0, count: 0 }
    if (r.type === 'ENTREE') catMap[r.categorie].entrees += r.total
    else catMap[r.categorie].sorties += r.total
    catMap[r.categorie].count += r.count
  }
  const catRows = Object.values(catMap).sort((a, b) => (b.entrees + b.sorties) - (a.entrees + a.sorties))

  const maxDayVal = Math.max(...stats.byDay.map(d => d.entrees + d.sorties), 1)

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {/* Date range info */}
      <div className="text-xs text-text-muted flex items-center gap-1">
        <Calendar size={11} /> Période : <strong>{dateFrom}</strong> → <strong>{dateTo}</strong>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* By Agent */}
        <div className="bg-white rounded-xl border border-border shadow-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <User size={13} className="text-text-muted" />
            <h3 className="font-bold text-sm">Par Agent</h3>
            <span className="ml-auto text-xs text-text-muted">{stats.byAgent.length} agent(s)</span>
          </div>
          {stats.byAgent.length === 0 ? (
            <div className="py-8 text-center text-text-muted text-sm">Aucun mouvement</div>
          ) : (
            <div className="divide-y divide-border">
              {stats.byAgent.map(a => (
                <div key={a.operateur} className="px-4 py-3 hover:bg-muted transition-colors">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-7 h-7 rounded-full bg-accent-100 text-text-primary font-bold text-[11px] flex items-center justify-center">
                      {(a.operateur ?? '?').slice(0, 2).toUpperCase()}
                    </span>
                    <span className="font-semibold text-sm capitalize">{a.operateur ?? 'Inconnu'}</span>
                    <span className="ml-auto text-xs text-text-muted">{a.count} mvt</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="bg-green-50 rounded-lg p-2">
                      <div className="text-green-600 font-semibold">Entrées</div>
                      <div className="font-price font-bold text-green-800">{formatPrice(a.total_entrees)}</div>
                    </div>
                    <div className="bg-red-50 rounded-lg p-2">
                      <div className="text-red-600 font-semibold">Sorties</div>
                      <div className="font-price font-bold text-red-800">{formatPrice(a.total_sorties)}</div>
                    </div>
                    <div className={cn('rounded-lg p-2', (a.total_entrees - a.total_sorties) >= 0 ? 'bg-blue-50' : 'bg-orange-50')}>
                      <div className={cn('font-semibold', (a.total_entrees - a.total_sorties) >= 0 ? 'text-blue-600' : 'text-orange-600')}>Net</div>
                      <div className={cn('font-price font-bold', (a.total_entrees - a.total_sorties) >= 0 ? 'text-blue-800' : 'text-orange-800')}>
                        {formatPrice(a.total_entrees - a.total_sorties)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* By Catégorie */}
        <div className="bg-white rounded-xl border border-border shadow-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Tag size={13} className="text-text-muted" />
            <h3 className="font-bold text-sm">Par Catégorie</h3>
          </div>
          {catRows.length === 0 ? (
            <div className="py-8 text-center text-text-muted text-sm">Aucun mouvement</div>
          ) : (
            <div className="divide-y divide-border">
              {catRows.map(c => {
                const pctE = (c.entrees + c.sorties) > 0 ? (c.entrees / (c.entrees + c.sorties)) * 100 : 0
                return (
                  <div key={c.categorie} className="px-4 py-3 hover:bg-muted transition-colors">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={cn('px-2 py-0.5 rounded-md text-[11px] font-medium', CAT_COLORS[c.categorie] ?? 'bg-gray-100 text-gray-700')}>
                        {CAT_LABELS[c.categorie] ?? c.categorie}
                      </span>
                      <span className="ml-auto text-xs text-text-muted">{c.count} mvt</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      {c.entrees > 0 && <span className="text-green-700 font-price">+{formatPrice(c.entrees)}</span>}
                      {c.sorties > 0 && <span className="text-red-700 font-price">-{formatPrice(c.sorties)}</span>}
                    </div>
                    {/* mini bar */}
                    <div className="mt-1.5 h-1.5 bg-red-100 rounded-full overflow-hidden">
                      <div className="h-full bg-green-500 rounded-full" style={{ width: `${pctE}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Daily timeline */}
      {stats.byDay.length > 0 && (
        <div className="bg-white rounded-xl border border-border shadow-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <BarChart3 size={13} className="text-text-muted" />
            <h3 className="font-bold text-sm">Évolution journalière</h3>
          </div>
          <div className="p-4 overflow-x-auto">
            <div className="flex items-end gap-2 min-h-[80px]" style={{ minWidth: `${stats.byDay.length * 48}px` }}>
              {stats.byDay.map(d => {
                const eH = Math.max(4, (d.entrees / maxDayVal) * 72)
                const sH = Math.max(4, (d.sorties / maxDayVal) * 72)
                return (
                  <div key={d.date_journal} className="flex flex-col items-center gap-1 flex-1 min-w-[40px]">
                    <div className="flex items-end gap-0.5 w-full justify-center" style={{ height: '72px' }}>
                      {d.entrees > 0 && (
                        <div title={`Entrées: ${formatPrice(d.entrees)}`}
                          className="w-4 bg-green-400 rounded-t transition-all hover:bg-green-500 cursor-default"
                          style={{ height: `${eH}px` }} />
                      )}
                      {d.sorties > 0 && (
                        <div title={`Sorties: ${formatPrice(d.sorties)}`}
                          className="w-4 bg-red-400 rounded-t transition-all hover:bg-red-500 cursor-default"
                          style={{ height: `${sH}px` }} />
                      )}
                    </div>
                    <div className="text-[10px] text-text-muted text-center whitespace-nowrap">
                      {new Date(d.date_journal + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}
                    </div>
                    <div className="text-[9px] text-text-muted text-center">{d.count} mvt</div>
                  </div>
                )
              })}
            </div>
            <div className="flex items-center gap-4 mt-3 text-[11px] text-text-muted">
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-400 rounded inline-block" /> Entrées</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-400 rounded inline-block" /> Sorties</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Add Mouvement Modal ───────────────────────────────────────────────────────
function AddMouvementModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState<'ENTREE' | 'SORTIE'>('ENTREE')
  const [categorie, setCategorie] = useState('ENTREE_MANUELLE')
  const [montant, setMontant] = useState('')
  const [note, setNote] = useState('')
  const [operateur, setOperateur] = useState('')
  const [loading, setLoading] = useState(false)
  const montantNum = parseFloat(montant.replace(',', '.')) || 0

  const CATEGORIES_ENTREE = ['ENTREE_MANUELLE', 'VENTE_EN_LIGNE', 'AUTRE']
  const CATEGORIES_SORTIE = ['SORTIE_INTERNE', 'AUTRE']

  const handleSave = async () => {
    if (montantNum <= 0) return
    const ok = await runAction('Enregistrement mouvement caisse', async () => {
      const today = new Date().toISOString().slice(0, 10)
      await api.caisseInterneAddMouvement({
        id: generateId(), date_journal: today,
        type, categorie, montant: montantNum,
        reference_id: null,
        note: note || null,
        operateur: operateur.trim() || 'superadmin',
        created_at: new Date().toISOString(),
      })
    }, {
      setLoading,
      successMessage: 'Mouvement enregistré',
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
          <h2 className="font-bold text-base">Nouveau Mouvement</h2>
          <button onClick={onClose}><X size={18} className="text-text-muted" /></button>
        </div>
        <div className="p-6 space-y-4">
          {/* Type */}
          <div className="grid grid-cols-2 gap-2">
            {(['ENTREE', 'SORTIE'] as const).map(t => (
              <button key={t} onClick={() => { setType(t); setCategorie(t === 'ENTREE' ? 'ENTREE_MANUELLE' : 'SORTIE_INTERNE') }}
                className={cn('py-2.5 rounded-xl border-2 text-sm font-bold transition-all',
                  type === t ? (t === 'ENTREE' ? 'border-green-500 bg-green-50 text-green-700' : 'border-red-500 bg-red-50 text-red-700')
                    : 'border-border hover:bg-muted text-text-secondary')}>
                {t === 'ENTREE' ? '↑ Entrée' : '↓ Sortie'}
              </button>
            ))}
          </div>
          {/* Catégorie */}
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">Catégorie</label>
            <select value={categorie} onChange={e => setCategorie(e.target.value)}
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent-500">
              {(type === 'ENTREE' ? CATEGORIES_ENTREE : CATEGORIES_SORTIE).map(c => (
                <option key={c} value={c}>{CAT_LABELS[c] ?? c}</option>
              ))}
            </select>
          </div>
          {/* Agent */}
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">Agent / Opérateur</label>
            <input value={operateur} onChange={e => setOperateur(e.target.value)}
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent-500"
              placeholder="Nom de l'agent (optionnel)" />
          </div>
          {/* Montant */}
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">Montant (DT) *</label>
            <div className="relative">
              <input type="text" inputMode="decimal" value={montant} onChange={e => setMontant(e.target.value.replace(/[^0-9.,]/g, ''))} autoFocus
                className="w-full border border-border rounded-xl px-4 py-3 font-price text-2xl font-bold outline-none focus:border-accent-500 text-center pr-16" placeholder="0.000" />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-text-muted font-semibold text-sm">DT</span>
            </div>
          </div>
          {/* Note */}
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">Note / Description</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent-500 resize-none"
              placeholder="Détail du mouvement..." />
          </div>
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-border">
          <button type="button" onClick={onClose} className="flex-1 bg-muted hover:bg-border font-semibold py-2.5 rounded-xl text-sm transition-colors">Annuler</button>
          <button type="button" onClick={handleSave} disabled={loading || montantNum <= 0}
            className={cn('flex-1 font-bold py-2.5 rounded-xl text-sm transition-colors disabled:bg-gray-200 disabled:text-gray-400',
              type === 'ENTREE' ? 'bg-green-500 hover:bg-green-600 text-white' : 'bg-red-500 hover:bg-red-600 text-white')}>
            {loading ? 'Enregistrement...' : `${type === 'ENTREE' ? '↑ Entrée' : '↓ Sortie'} ${formatPrice(montantNum)}`}
          </button>
        </div>
      </div>
    </div>
  )
}

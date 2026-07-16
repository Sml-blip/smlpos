import { useState, useEffect, useCallback, useRef } from 'react'
import { formatPrice, generateId } from '../../lib/utils'
import { cn } from '../../lib/utils'
import { useAppStore } from '../../store/appStore'
import {
  Users, X, Search, RefreshCw, CreditCard, UserPlus,
  ArrowUpCircle, ArrowDownCircle, DollarSign, Clock, User,
  FileText, TrendingDown, CheckCircle, Phone, Hash, Building2, Plus, Download
} from 'lucide-react'
import type { Organisation } from '../../lib/types'
import { runAction, loadData } from '../../lib/apiCall'
import { saveBalanceReport } from '../../lib/reportPdf'

const api = window.api

type SubTab = 'clients' | 'organisations'

interface Client {
  id: string; nom: string; telephone?: string; email?: string
  adresse?: string; solde_credit: number; credit_limite?: number; organisation_id?: string; notes?: string; created_at: string
}
type OrganisationSummary = Organisation & { client_count?: number; credit_live?: number }
interface CreditLigne {
  id: string; client_id: string; client_nom: string; shift_id?: string
  type: 'CREDIT' | 'PAIEMENT'; montant: number; reference?: string
  note?: string; operateur?: string; created_at: string
}
interface CreditWithBalance extends CreditLigne {
  balance: number
}

export default function CreditsTab() {
  const { currentShift } = useAppStore()
  const [subTab, setSubTab] = useState<SubTab>('clients')
  const [clients, setClients] = useState<Client[]>([])
  const [organisations, setOrganisations] = useState<OrganisationSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Client | null>(null)
  const [history, setHistory] = useState<CreditLigne[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [showNewClient, setShowNewClient] = useState(false)
  const [showAddTranche, setShowAddTranche] = useState<'CREDIT' | 'PAIEMENT' | null>(null)
  const [showAddOrg, setShowAddOrg] = useState(false)
  const [assignOrg, setAssignOrg] = useState<OrganisationSummary | null>(null)
  const [filterOrgId, setFilterOrgId] = useState<string | null>(null)

  // Use a ref to avoid including `selected` in load deps (prevents infinite reload loop)
  const selectedIdRef = useRef<string | null>(null)
  selectedIdRef.current = selected?.id ?? null

  const load = useCallback(async () => {
    const data = await loadData('Chargement crédits', async () => {
      const [cl, orgs] = await Promise.all([
        api.clientsList({ ...(search ? { search } : {}), ...(filterOrgId ? { organisation_id: filterOrgId } : {}) }) as Promise<Client[]>,
        api.organisationsList() as Promise<OrganisationSummary[]>,
      ])
      return { cl, orgs }
    }, { setLoading })
    if (data) {
      setClients(data.cl)
      setOrganisations(data.orgs ?? [])
      if (selectedIdRef.current) {
        const updated = data.cl.find(c => c.id === selectedIdRef.current)
        if (updated) setSelected(updated)
      }
    }
  }, [search, filterOrgId])

  useEffect(() => { load() }, [load])

  const loadHistory = useCallback(async (clientId: string) => {
    const rows = await loadData('Chargement historique crédit', async () =>
      api.creditsList(clientId) as Promise<CreditLigne[]>
    , { setLoading: setHistoryLoading })
    if (rows) setHistory(rows)
  }, [])

  const selectClient = useCallback((client: Client) => {
    setSelected(client)
    loadHistory(client.id)
  }, [loadHistory])

  const handleSaved = useCallback(() => {
    load()
    if (selected) loadHistory(selected.id)
  }, [load, selected, loadHistory])

  // KPIs
  const totalCredit = clients.reduce((s, c) => s + (c.solde_credit > 0 ? c.solde_credit : 0), 0)
  const totalDebtors = clients.filter(c => c.solde_credit > 0).length
  const totalClients = clients.length

  // Filter clients list
  const filteredClients = (filterOrgId
    ? clients.filter(c => c.organisation_id === filterOrgId)
    : clients.filter(c => !c.organisation_id))
    .filter(c => !search || `${c.nom} ${c.telephone ?? ''}`.toLowerCase().includes(search.toLowerCase()))

  // Compute running balances for history (oldest → newest, then reverse for display)
  const historyWithBalance: CreditWithBalance[] = (() => {
    const asc = [...history].reverse() // history comes DESC from API
    let running = 0
    const computed = asc.map(row => {
      running += row.type === 'CREDIT' ? row.montant : -row.montant
      return { ...row, balance: running }
    })
    return computed.reverse() // display newest first
  })()

  return (
    <div className="h-full flex flex-col overflow-hidden bg-surface">
      {/* Sub-tabs */}
      <div className="flex items-center gap-0 bg-white border-b border-border px-4 flex-shrink-0">
        {([
          { id: 'clients' as SubTab, label: 'Crédits Clients', icon: <CreditCard size={13} /> },
          { id: 'organisations' as SubTab, label: 'Organisations', icon: <Building2 size={13} /> },
        ]).map(t => (
          <button key={t.id} onClick={() => { setSubTab(t.id); if (t.id === 'organisations') setFilterOrgId(null) }}
            className={cn('flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-all',
              subTab === t.id ? 'border-accent-500 text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary')}>
            {t.icon}{t.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 pb-1">
          {subTab === 'organisations' && (
            <button onClick={() => setShowAddOrg(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-500 hover:bg-accent-400 text-black text-xs font-semibold rounded-lg">
              <Plus size={12} /> Nouvelle org
            </button>
          )}
          <button onClick={load} disabled={loading} className="p-1.5 text-text-muted hover:text-text-primary rounded-lg hover:bg-muted">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {subTab === 'organisations' ? (
        /* ── ORGANISATIONS VIEW ── */
        <div className="flex-1 overflow-auto p-6">
          {filterOrgId && (
            <div className="mb-3 flex items-center gap-2 text-xs text-accent-700 bg-accent-50 border border-accent-200 rounded-lg px-3 py-2">
              <Building2 size={12} />
              <span>Filtre actif : {organisations.find(o => o.id === filterOrgId)?.nom}</span>
              <button onClick={() => { setFilterOrgId(null); setSubTab('clients') }} className="ml-auto text-text-muted hover:text-text-primary">
                <X size={12} />
              </button>
            </div>
          )}
          {organisations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-text-muted">
              <Building2 size={40} className="mb-3 opacity-20" />
              <p className="text-sm">Aucune organisation</p>
              <button onClick={() => setShowAddOrg(true)}
                className="mt-2 px-3 py-1.5 bg-accent-500 hover:bg-accent-400 rounded-lg text-xs font-bold text-black">
                Créer une organisation
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {organisations.map(org => {
                const orgClients = clients.filter(c => c.organisation_id === org.id)
                const orgCredit = org.credit_live ?? orgClients.reduce((s, c) => s + (c.solde_credit > 0 ? c.solde_credit : 0), 0)
                const orgClientCount = org.client_count ?? orgClients.length
                return (
                  <div key={org.id} className="bg-white rounded-xl border border-border p-4 flex flex-col gap-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold text-text-primary">{org.nom}</p>
                        {org.telephone && <p className="text-xs text-text-muted flex items-center gap-1"><Phone size={10} />{org.telephone}</p>}
                        {org.matricule_fiscal && <p className="text-xs text-text-muted">MF: {org.matricule_fiscal}</p>}
                      </div>
                      <span className="text-xs bg-muted text-text-secondary px-2 py-0.5 rounded-full">{orgClientCount} client{orgClientCount !== 1 ? 's' : ''}</span>
                    </div>
                    {orgCredit > 0 && (
                      <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                        <p className="text-xs text-text-muted">Crédit total</p>
                        <p className="font-price font-bold text-red-600">{formatPrice(orgCredit)}</p>
                      </div>
                    )}
                    <button onClick={() => { setFilterOrgId(org.id); setSubTab('clients') }}
                      className="text-xs text-accent-600 hover:underline text-left">
                      Voir les clients →
                    </button>
                    <button onClick={() => setAssignOrg(org)}
                      className="flex items-center justify-center gap-1.5 border border-border hover:border-accent-400 hover:bg-accent-50 rounded-lg px-3 py-2 text-xs font-semibold text-text-secondary hover:text-text-primary">
                      <UserPlus size={12} /> Assigner un client existant
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        /* ── CLIENTS VIEW ── */
        <div className="flex flex-1 overflow-hidden">
        {/* ── LEFT PANEL: Client list ── */}
      <div className="w-80 flex-shrink-0 flex flex-col border-r border-border bg-white">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="font-bold text-sm flex items-center gap-2">
            <CreditCard size={14} /> Crédits Clients
          </h2>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowNewClient(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-accent-500 hover:bg-accent-600 rounded-lg text-xs font-bold transition-colors"
            >
              <UserPlus size={12} /> Nouveau
            </button>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-2 px-3 py-3 border-b border-border">
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-2.5">
            <div className="text-[10px] font-semibold text-orange-700 flex items-center gap-1 mb-0.5">
              <Users size={10} /> Débiteurs
            </div>
            <div className="font-bold text-lg text-orange-800">{totalDebtors}</div>
            <div className="text-[10px] text-orange-600">/ {totalClients} clients</div>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-xl p-2.5">
            <div className="text-[10px] font-semibold text-red-700 flex items-center gap-1 mb-0.5">
              <TrendingDown size={10} /> Total dû
            </div>
            <div className="font-bold font-price text-sm text-red-800">{formatPrice(totalCredit)}</div>
            <div className="text-[10px] text-red-600">cumul</div>
          </div>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-border">
          <div className="flex items-center gap-2 border border-border rounded-lg px-2.5 py-1.5 bg-muted focus-within:border-accent-500 transition-colors">
            <Search size={12} className="text-text-muted flex-shrink-0" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-xs outline-none"
              placeholder="Nom ou téléphone..."
            />
            {search && <button onClick={() => setSearch('')}><X size={11} className="text-text-muted" /></button>}
          </div>
        </div>

        {/* Client list */}
        <div className="flex-1 overflow-y-auto">
          {filterOrgId && (
            <div className="px-3 py-1.5 bg-accent-50 border-b border-accent-200 flex items-center justify-between text-xs">
              <span className="text-accent-700">{organisations.find(o => o.id === filterOrgId)?.nom}</span>
              <button onClick={() => setFilterOrgId(null)} className="text-text-muted hover:text-text-primary"><X size={11} /></button>
            </div>
          )}
          {filteredClients.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-text-muted px-4">
              <Users size={32} className="mb-2 opacity-25" />
              <p className="text-xs text-center">Aucun client</p>
              <button
                onClick={() => setShowNewClient(true)}
                className="mt-2 px-3 py-1.5 bg-accent-500 hover:bg-accent-600 rounded-lg text-xs font-bold"
              >
                Créer un client
              </button>
            </div>
          ) : filteredClients.map(client => {
            const hasDebt = client.solde_credit > 0
            const isSelected = selected?.id === client.id
            return (
              <button
                key={client.id}
                onClick={() => selectClient(client)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2.5 border-b border-border text-left transition-colors',
                  isSelected
                    ? 'bg-accent-50 border-l-2 border-l-accent-500'
                    : 'hover:bg-muted border-l-2 border-l-transparent'
                )}
              >
                <div className={cn(
                  'w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs flex-shrink-0',
                  hasDebt ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'
                )}>
                  {client.nom.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-xs truncate">{client.nom}</div>
                  {client.telephone && (
                    <div className="text-[10px] text-text-muted flex items-center gap-1">
                      <Phone size={9} /> {client.telephone}
                    </div>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <div className={cn(
                    'font-price font-bold text-xs',
                    hasDebt ? 'text-red-600' : 'text-green-600'
                  )}>
                    {formatPrice(client.solde_credit)}
                  </div>
                  {client.credit_limite != null && hasDebt && (
                    <div className="text-[10px] text-text-muted">/ {formatPrice(client.credit_limite)}</div>
                  )}
                  <div className={cn('text-[10px]', hasDebt ? 'text-orange-600' : 'text-text-muted')}>
                    {hasDebt ? 'Doit' : 'Soldé'}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── RIGHT PANEL: Client detail ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-full text-text-muted">
            <CreditCard size={48} className="mb-3 opacity-15" />
            <p className="text-sm font-semibold">Sélectionnez un client</p>
            <p className="text-xs mt-1">pour voir son historique de crédit</p>
          </div>
        ) : (
          <>
            {/* Client header */}
            <div className="flex items-center gap-4 px-5 py-4 bg-white border-b border-border flex-shrink-0">
              <div className={cn(
                'w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-base flex-shrink-0',
                selected.solde_credit > 0 ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'
              )}>
                {selected.nom.slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-base">{selected.nom}</div>
                <div className="flex items-center gap-3 mt-0.5">
                  {selected.telephone && (
                    <span className="text-xs text-text-muted flex items-center gap-1">
                      <Phone size={10} /> {selected.telephone}
                    </span>
                  )}
                  {selected.email && (
                    <span className="text-xs text-text-muted">{selected.email}</span>
                  )}
                  <span className="text-xs text-text-muted flex items-center gap-1">
                    <Clock size={10} /> Depuis {new Date(selected.created_at).toLocaleDateString('fr-FR')}
                  </span>
                </div>
              </div>
              {/* Solde badge */}
              <div className={cn(
                'text-right flex-shrink-0 rounded-xl px-4 py-2.5 border',
                selected.solde_credit > 0
                  ? 'bg-red-50 border-red-200'
                  : 'bg-green-50 border-green-200'
              )}>
                <div className="text-xs font-semibold text-text-secondary mb-0.5">Solde crédit</div>
                <div className={cn(
                  'font-price font-bold text-xl',
                  selected.solde_credit > 0 ? 'text-red-700' : 'text-green-700'
                )}>
                  {formatPrice(selected.solde_credit)}
                </div>
                {selected.credit_limite != null && (
                  <div className="text-[10px] text-text-muted mt-0.5">
                    Limite : <span className="font-price font-semibold">{formatPrice(selected.credit_limite)}</span>
                  </div>
                )}
                {selected.credit_limite != null && selected.credit_limite > 0 && (
                  <div className="mt-1.5 h-1.5 w-28 overflow-hidden rounded-full bg-gray-200">
                    <div className={cn('h-full rounded-full', selected.solde_credit >= selected.credit_limite ? 'bg-red-500' : 'bg-accent-500')} style={{ width: `${Math.min(100, Math.max(0, (selected.solde_credit / selected.credit_limite) * 100))}%` }} />
                  </div>
                )}
                <div className={cn('text-xs', selected.solde_credit > 0 ? 'text-red-500' : 'text-green-500')}>
                  {selected.solde_credit > 0 ? 'À rembourser' : 'Soldé ✓'}
                </div>
              </div>
              {/* Action buttons */}
              <div className="flex flex-col gap-2 flex-shrink-0">
                <button onClick={() => void saveBalanceReport('Historique crédit client', selected.nom, [['Solde actuel', `${formatPrice(selected.solde_credit)} DT`], ['Limite', selected.credit_limite == null ? '—' : `${formatPrice(selected.credit_limite)} DT`], ['Mouvements', String(history.length)]], history.map(row => ({ date: row.created_at, type: row.type === 'CREDIT' ? 'Crédit' : 'Paiement', amount: row.montant, operator: row.operateur, note: row.note || row.reference })), `credit-${selected.nom}`)} className="flex items-center justify-center gap-1.5 px-3 py-1.5 border border-border text-text-secondary hover:bg-muted rounded-xl text-xs font-semibold"><Download size={12} /> PDF</button>
                <button
                  onClick={() => setShowAddTranche('CREDIT')}
                  className="flex items-center gap-1.5 px-3 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl text-xs font-bold transition-colors"
                >
                  <ArrowUpCircle size={13} /> Accorder crédit
                </button>
                <button
                  onClick={() => setShowAddTranche('PAIEMENT')}
                  className="flex items-center gap-1.5 px-3 py-2 bg-green-500 hover:bg-green-600 text-white rounded-xl text-xs font-bold transition-colors"
                >
                  <ArrowDownCircle size={13} /> Encaisser paiement
                </button>
              </div>
            </div>

            {/* History table */}
            <div className="flex-1 overflow-hidden flex flex-col">
              <div className="px-5 py-2.5 bg-surface border-b border-border flex items-center gap-2 flex-shrink-0">
                <FileText size={12} className="text-text-muted" />
                <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                  Historique des mouvements
                </span>
                <span className="ml-auto text-xs text-text-muted">{history.length} mouvement{history.length > 1 ? 's' : ''}</span>
              </div>

              {historyLoading ? (
                <div className="flex items-center justify-center flex-1 text-text-muted text-sm">
                  <RefreshCw size={16} className="animate-spin mr-2" /> Chargement...
                </div>
              ) : historyWithBalance.length === 0 ? (
                <div className="flex flex-col items-center justify-center flex-1 text-text-muted">
                  <FileText size={36} className="mb-2 opacity-20" />
                  <p className="text-sm">Aucun mouvement</p>
                </div>
              ) : (
                <div className="flex-1 overflow-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-gray-50 border-b border-border">
                        <th className="text-left px-4 py-2.5 font-semibold text-text-secondary whitespace-nowrap">
                          <Clock size={10} className="inline mr-1" />Date
                        </th>
                        <th className="text-left px-3 py-2.5 font-semibold text-text-secondary whitespace-nowrap">Heure</th>
                        <th className="text-left px-3 py-2.5 font-semibold text-text-secondary">Type</th>
                        <th className="text-right px-3 py-2.5 font-semibold text-text-secondary whitespace-nowrap">Montant</th>
                        <th className="text-left px-3 py-2.5 font-semibold text-text-secondary whitespace-nowrap">
                          <User size={10} className="inline mr-1" />Agent
                        </th>
                        <th className="text-left px-3 py-2.5 font-semibold text-text-secondary">Note / Référence</th>
                        <th className="text-right px-3 py-2.5 font-semibold text-text-secondary whitespace-nowrap">
                          <Hash size={10} className="inline mr-1" />Solde courant
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyWithBalance.map((row, i) => {
                        const dt = new Date(row.created_at)
                        const isCredit = row.type === 'CREDIT'
                        return (
                          <tr
                            key={row.id}
                            className={cn(
                              'border-b border-border hover:bg-accent-50 transition-colors',
                              i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'
                            )}
                          >
                            {/* Date */}
                            <td className="px-4 py-2.5 whitespace-nowrap font-mono text-text-secondary">
                              {dt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                            </td>
                            {/* Heure */}
                            <td className="px-3 py-2.5 whitespace-nowrap font-mono text-text-secondary">
                              {dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </td>
                            {/* Type badge */}
                            <td className="px-3 py-2.5">
                              <span className={cn(
                                'inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap',
                                isCredit
                                  ? 'bg-red-100 text-red-800'
                                  : 'bg-green-100 text-green-800'
                              )}>
                                {isCredit
                                  ? <><ArrowUpCircle size={9} /> Crédit</>
                                  : <><ArrowDownCircle size={9} /> Paiement</>
                                }
                              </span>
                              {!isCredit && row.shift_id && (
                                <span className="ml-1 text-[10px] text-green-600 font-medium">→ caisse</span>
                              )}
                            </td>
                            {/* Montant */}
                            <td className="px-3 py-2.5 whitespace-nowrap text-right">
                              <span className={cn('font-price font-bold', isCredit ? 'text-red-700' : 'text-green-700')}>
                                {isCredit ? '+' : '-'}{formatPrice(row.montant)}
                              </span>
                            </td>
                            {/* Agent */}
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              {row.operateur ? (
                                <span className="flex items-center gap-1.5">
                                  <span className="w-5 h-5 rounded-full bg-accent-100 text-text-primary font-bold text-[10px] flex items-center justify-center flex-shrink-0">
                                    {row.operateur.slice(0, 2).toUpperCase()}
                                  </span>
                                  <span className="text-text-secondary capitalize">{row.operateur}</span>
                                </span>
                              ) : (
                                <span className="text-text-muted italic">—</span>
                              )}
                            </td>
                            {/* Note + Reference */}
                            <td className="px-3 py-2.5 max-w-[200px]">
                              {row.note ? (
                                <span className="text-text-secondary truncate block" title={row.note}>{row.note}</span>
                              ) : row.reference ? (
                                <span className="font-mono text-[10px] text-text-secondary bg-muted px-1.5 py-0.5 rounded">{row.reference}</span>
                              ) : (
                                <span className="text-text-muted italic">—</span>
                              )}
                            </td>
                            {/* Running balance */}
                            <td className="px-3 py-2.5 whitespace-nowrap text-right">
                              <span className={cn(
                                'font-price font-semibold text-[11px]',
                                row.balance > 0 ? 'text-red-600' : row.balance < 0 ? 'text-orange-600' : 'text-green-600'
                              )}>
                                {formatPrice(row.balance)}
                              </span>
                              {row.balance <= 0 && (
                                <CheckCircle size={10} className="text-green-500 inline ml-1" />
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      </div>
      )}

      {/* Modals */}
      {showNewClient && (
        <NewClientModal
          organisations={organisations}
          currentShift={currentShift as { operateur_nom?: string } | null}
          onClose={() => setShowNewClient(false)}
          onSaved={() => { load(); setShowNewClient(false) }}
        />
      )}
      {showAddTranche && selected && (
        <AddTrancheModal
          client={selected}
          defaultType={showAddTranche}
          currentShift={currentShift as { id?: string; operateur_nom?: string } | null}
          onClose={() => setShowAddTranche(null)}
          onSaved={() => { setShowAddTranche(null); handleSaved() }}
        />
      )}
      {showAddOrg && (
        <AddOrgModal
          onClose={() => setShowAddOrg(false)}
          onSaved={() => { setShowAddOrg(false); load() }}
        />
      )}
      {assignOrg && (
        <AssignOrganisationClientModal
          organisation={assignOrg}
          onClose={() => setAssignOrg(null)}
          onSaved={() => { setAssignOrg(null); load() }}
        />
      )}
    </div>
  )
}

// ── New Client Modal ──────────────────────────────────────────────────────────
function NewClientModal({
  organisations,
  currentShift,
  onClose,
  onSaved,
}: {
  organisations: Organisation[]
  currentShift: { operateur_nom?: string } | null
  onClose: () => void
  onSaved: () => void
}) {
  const [nom, setNom] = useState('')
  const [tel, setTel] = useState('')
  const [organisationId, setOrganisationId] = useState('')
  const [montantBrut, setMontantBrut] = useState('')    // before interest
  const [montantApres, setMontantApres] = useState('')  // after interest = actual debt
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const agent = currentShift?.operateur_nom ?? 'superadmin'
  const brutNum = parseFloat(montantBrut.replace(',', '.')) || 0
  const apresNum = parseFloat(montantApres.replace(',', '.')) || 0
  const interetPct = brutNum > 0 && apresNum > brutNum
    ? (((apresNum - brutNum) / brutNum) * 100).toFixed(1)
    : null

  const handleSave = async () => {
    if (!nom.trim()) return
    setError('')
    const ok = await runAction('Création client crédit', async () => {
      const noteCredit = brutNum > 0 && apresNum > 0
        ? `Brut: ${brutNum.toFixed(3)} DT → Après intérêt: ${apresNum.toFixed(3)} DT`
        : null
      await api.clientsCreate({
        id: generateId(),
        nom: nom.trim(),
        telephone: tel || null,
        organisation_id: organisationId || null,
        created_at: new Date().toISOString(),
        montant_credit_initial: apresNum > 0 ? apresNum : (brutNum > 0 ? brutNum : 0),
        agent_initial: agent,
        note_credit: noteCredit,
      })
    }, {
      setLoading,
      successMessage: 'Client créé',
      onError: msg => setError(msg.replace(/^Création client crédit : /, '')),
    })
    if (ok) onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-[440px] animate-slide-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-bold text-base flex items-center gap-2">
            <UserPlus size={15} /> Nouveau Client
          </h2>
          <button onClick={onClose}><X size={18} className="text-text-muted" /></button>
        </div>
        <div className="p-6 space-y-3">
          {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
          {/* Nom */}
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">Nom *</label>
            <input
              value={nom}
              onChange={e => setNom(e.target.value)}
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent-500"
              placeholder="Nom complet du client"
            />
          </div>
          {/* Téléphone */}
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">Téléphone</label>
            <input
              value={tel}
              onChange={e => setTel(e.target.value)}
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent-500"
              placeholder="XX XXX XXX"
            />
          </div>

          {/* Crédit initial with before/after interest */}
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">Organisation (optionnel)</label>
            <select value={organisationId} onChange={e => setOrganisationId(e.target.value)} className="w-full border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent-500">
              <option value="">Client général</option>
              {organisations.map(org => <option key={org.id} value={org.id}>{org.nom}</option>)}
            </select>
          </div>
          <div className="border-t border-border pt-3">
            <div className="text-xs font-semibold text-text-secondary mb-3 uppercase tracking-wider flex items-center gap-1.5">
              <CreditCard size={11} /> Crédit initial (optionnel)
            </div>

            {/* Agent (auto-assigned, read-only) */}
            <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-accent-50 border border-accent-200 rounded-lg">
              <User size={12} className="text-text-secondary flex-shrink-0" />
              <span className="text-xs text-text-secondary">Agent : </span>
              <span className="text-xs font-bold text-text-primary">{agent}</span>
              <span className="text-[10px] text-text-muted ml-auto">(shift actuel)</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1">
                  Montant brut (DT)
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={montantBrut}
                    onChange={e => setMontantBrut(e.target.value.replace(/[^0-9.,]/g, ''))}
                    className="w-full border border-border rounded-xl px-3 py-2.5 text-sm font-price outline-none focus:border-accent-500 pr-10"
                    placeholder="0.000"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-muted">DT</span>
                </div>
                <p className="text-[10px] text-text-muted mt-0.5">Avant intérêt</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1">
                  Montant dû (DT) *
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={montantApres}
                    onChange={e => setMontantApres(e.target.value.replace(/[^0-9.,]/g, ''))}
                    className="w-full border border-border rounded-xl px-3 py-2.5 text-sm font-price outline-none focus:border-red-400 pr-10 border-orange-300 bg-orange-50"
                    placeholder="0.000"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-muted">DT</span>
                </div>
                <p className="text-[10px] text-orange-600 mt-0.5 font-semibold">Après intérêt — utilisé pour calcul</p>
              </div>
            </div>

            {interetPct && (
              <div className="mt-2 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-800 flex items-center gap-2">
                <TrendingDown size={12} />
                Intérêt détecté : <strong>{interetPct}%</strong>
                <span className="ml-auto">({formatPrice(brutNum)} → {formatPrice(apresNum)})</span>
              </div>
            )}
            {apresNum > 0 && (
              <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-orange-50 border border-orange-200 rounded-lg text-xs text-orange-800">
                <ArrowUpCircle size={12} />
                Crédit de <strong className="font-price">{formatPrice(apresNum)}</strong> accordé à la création.
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-border">
          <button type="button" onClick={onClose} className="flex-1 bg-muted hover:bg-border font-semibold py-2.5 rounded-xl text-sm transition-colors">
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={loading}
            className="flex-1 bg-accent-500 hover:bg-accent-600 disabled:bg-gray-200 disabled:text-gray-400 font-bold py-2.5 rounded-xl text-sm transition-colors"
          >
            {loading ? 'Enregistrement...' : 'Créer le client'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Add Tranche Modal ─────────────────────────────────────────────────────────
function AddTrancheModal({
  client,
  defaultType,
  currentShift,
  onClose,
  onSaved,
}: {
  client: Client
  defaultType: 'CREDIT' | 'PAIEMENT'
  currentShift: { id?: string; operateur_nom?: string } | null
  onClose: () => void
  onSaved: () => void
}) {
  const [type, setType] = useState<'CREDIT' | 'PAIEMENT'>(defaultType)
  const [montant, setMontant] = useState('')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [agent, setAgent] = useState(currentShift?.operateur_nom ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const montantNum = parseFloat(montant.replace(',', '.')) || 0
  const newSolde = type === 'CREDIT'
    ? client.solde_credit + montantNum
    : Math.max(0, client.solde_credit - montantNum)

  const handleSave = async () => {
    if (montantNum <= 0) return
    setError('')
    const label = type === 'CREDIT' ? 'Accord crédit' : 'Encaissement paiement'
    const ok = await runAction(label, async () => {
      await api.creditsCreate({
        id: generateId(),
        client_id: client.id,
        client_nom: client.nom,
        shift_id: currentShift?.id ?? null,
        type,
        montant: montantNum,
        reference: reference.trim() || null,
        note: note.trim() || null,
        operateur: agent.trim() || 'superadmin',
        created_at: new Date().toISOString(),
      })
    }, {
      setLoading,
      successMessage: type === 'CREDIT' ? 'Crédit enregistré' : 'Paiement enregistré',
      onError: msg => setError(msg.replace(new RegExp(`^${label} : `), '')),
    })
    if (ok) onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-[440px] animate-slide-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="font-bold text-base">Mouvement Crédit</h2>
            <p className="text-xs text-text-muted mt-0.5">{client.nom}</p>
          </div>
          <button onClick={onClose}><X size={18} className="text-text-muted" /></button>
        </div>
        <div className="p-6 space-y-4">
          {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
          {/* Current balance */}
          <div className={cn(
            'rounded-xl p-3 flex justify-between items-center border',
            client.solde_credit > 0 ? 'bg-orange-50 border-orange-200' : 'bg-green-50 border-green-200'
          )}>
            <span className="text-sm font-semibold text-text-secondary">Solde actuel</span>
            <span className={cn('font-price font-bold text-base', client.solde_credit > 0 ? 'text-orange-700' : 'text-green-700')}>
              {formatPrice(client.solde_credit)}
            </span>
          </div>

          {/* Type selector */}
          <div className="grid grid-cols-2 gap-2">
            {(['CREDIT', 'PAIEMENT'] as const).map(t => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={cn(
                  'py-2.5 rounded-xl border-2 text-sm font-bold transition-all flex items-center justify-center gap-2',
                  type === t
                    ? (t === 'CREDIT' ? 'border-red-500 bg-red-50 text-red-700' : 'border-green-500 bg-green-50 text-green-700')
                    : 'border-border hover:bg-muted text-text-secondary'
                )}
              >
                {t === 'CREDIT'
                  ? <><ArrowUpCircle size={14} /> Crédit accordé</>
                  : <><ArrowDownCircle size={14} /> Paiement reçu</>
                }
              </button>
            ))}
          </div>

          {type === 'PAIEMENT' && (
            <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-2.5 text-xs text-green-800 flex items-start gap-2">
              <DollarSign size={13} className="mt-0.5 flex-shrink-0" />
              <span>
                Ce paiement sera enregistré sur le <strong>shift en cours</strong> (caisse externe).
                {currentShift?.operateur_nom && ` Opérateur : ${currentShift.operateur_nom}.`}
              </span>
            </div>
          )}

          {/* Montant */}
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">Montant (DT) *</label>
            <div className="relative">
              <input
                type="text"
                inputMode="decimal"
                value={montant}
                onChange={e => setMontant(e.target.value.replace(/[^0-9.,]/g, ''))}
                autoFocus
                className="w-full border border-border rounded-xl px-4 py-3 font-price text-2xl font-bold outline-none focus:border-accent-500 text-center pr-14"
                placeholder="0.000"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-text-muted font-semibold text-sm">DT</span>
            </div>
          </div>

          {/* Agent + Référence */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1">
                <User size={10} className="inline mr-1" />Agent *
              </label>
              <input
                value={agent}
                onChange={e => setAgent(e.target.value)}
                className="w-full border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent-500"
                placeholder="Nom de l'agent"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1">Référence</label>
              <input
                value={reference}
                onChange={e => setReference(e.target.value)}
                className="w-full border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent-500"
                placeholder="N° facture, chèque..."
              />
            </div>
          </div>

          {/* Note */}
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">Note</label>
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent-500"
              placeholder="Description du mouvement..."
            />
          </div>

          {/* Preview new solde */}
          {montantNum > 0 && (
            <div className={cn(
              'rounded-xl px-4 py-3 border flex items-center justify-between',
              newSolde > 0 ? 'bg-orange-50 border-orange-200' : 'bg-green-50 border-green-200'
            )}>
              <div>
                <div className="text-xs text-text-secondary">Nouveau solde après opération</div>
                <div className="text-[10px] text-text-muted mt-0.5">
                  {formatPrice(client.solde_credit)} {type === 'CREDIT' ? `+ ${formatPrice(montantNum)}` : `− ${formatPrice(montantNum)}`}
                </div>
              </div>
              <div className={cn('font-price font-bold text-lg', newSolde > 0 ? 'text-orange-700' : 'text-green-700')}>
                {formatPrice(newSolde)}
                {newSolde <= 0 && <CheckCircle size={14} className="text-green-500 inline ml-1.5" />}
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-border">
          <button type="button" onClick={onClose} className="flex-1 bg-muted hover:bg-border font-semibold py-2.5 rounded-xl text-sm transition-colors">
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={loading || montantNum <= 0}
            className={cn(
              'flex-1 text-white font-bold py-2.5 rounded-xl text-sm transition-colors disabled:bg-gray-200 disabled:text-gray-400 flex items-center justify-center gap-2',
              type === 'CREDIT' ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'
            )}
          >
            {loading ? 'Enregistrement...' : (
              type === 'CREDIT'
                ? <><ArrowUpCircle size={14} /> Accorder {formatPrice(montantNum)}</>
                : <><ArrowDownCircle size={14} /> Encaisser {formatPrice(montantNum)}</>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Add Organisation Modal ────────────────────────────────────────────────────
function AssignOrganisationClientModal({ organisation, onClose, onSaved }: {
  organisation: OrganisationSummary
  onClose: () => void
  onSaved: () => void
}) {
  const [clients, setClients] = useState<Client[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    api.clientsList({}).then(rows => {
      if (!cancelled) setClients((rows as Client[]).filter(c => c.organisation_id !== organisation.id))
    }).catch(() => {
      if (!cancelled) setError('Impossible de charger les clients')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [organisation.id])

  const visible = clients.filter(c => `${c.nom} ${c.telephone ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()))

  const toggleClient = (id: string) => {
    setSelectedIds(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const assignSelected = async () => {
    setError('')
    const selected = clients.filter(client => selectedIds.has(client.id))
    if (selected.length === 0) return
    setSaving(true)
    try {
      const results = await Promise.all(selected.map(client => api.clientsUpdate(client.id, { organisation_id: organisation.id }) as Promise<{ success?: boolean; error?: string }>))
      const failed = results.find(result => result?.success === false || result?.error)
      if (failed) throw new Error(failed.error || 'Affectation impossible')
      setClients(current => current.filter(client => !selectedIds.has(client.id)))
      setSelectedIds(new Set())
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Affectation impossible')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-[460px] max-w-full animate-slide-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="font-bold text-base flex items-center gap-2"><Building2 size={15} /> Assigner des clients</h2>
            <p className="text-xs text-text-muted mt-1">Organisation : {organisation.nom}</p>
          </div>
          <button onClick={onClose} aria-label="Fermer"><X size={18} className="text-text-muted" /></button>
        </div>
        {error && <p className="mx-6 mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        <div className="p-6">
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-3 text-text-muted" />
            <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher un client..."
              className="w-full border border-border rounded-xl pl-9 pr-3 py-2.5 text-sm outline-none focus:border-accent-500" />
          </div>
          <div className="max-h-64 overflow-auto border border-border rounded-xl divide-y divide-border">
            {loading ? <p className="p-4 text-sm text-text-muted text-center">Chargement...</p> : visible.length === 0 ? (
              <p className="p-5 text-sm text-text-muted text-center">Aucun client disponible</p>
            ) : visible.map(client => (
              <label key={client.id} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/50">
                <input type="checkbox" checked={selectedIds.has(client.id)} onChange={() => toggleClient(client.id)} disabled={saving}
                  className="h-4 w-4 accent-accent-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{client.nom}</p>
                  <p className="text-xs text-text-muted truncate">{client.telephone || 'Sans téléphone'}{client.organisation_id ? ' · autre organisation' : ' · client général'}</p>
                </div>
              </label>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-border">
          <span className="text-xs text-text-muted">{selectedIds.size} sélectionné{selectedIds.size !== 1 ? 's' : ''}</span>
          <div className="flex gap-2">
          <button onClick={onClose} className="px-4 py-2.5 bg-muted hover:bg-border rounded-xl text-sm font-semibold">Fermer</button>
          <button onClick={assignSelected} disabled={saving || selectedIds.size === 0} className="px-4 py-2.5 bg-accent-500 hover:bg-accent-400 disabled:bg-gray-200 disabled:text-gray-400 rounded-xl text-sm font-bold">{saving ? 'Affectation...' : 'Assigner la sélection'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AddOrgModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ nom: '', telephone: '', email: '', adresse: '', matricule_fiscal: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    if (!form.nom.trim()) { setError('Nom requis'); return }
    setError('')
    const ok = await runAction('Création organisation', async () => {
      await api.organisationsCreate({ id: generateId(), ...form, credit_total: 0, actif: 1, created_at: new Date().toISOString() })
    }, {
      setSaving,
      successMessage: 'Organisation ajoutée',
      onError: msg => setError(msg.replace(/^Création organisation : /, '')),
    })
    if (ok) onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-[420px] animate-slide-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-bold text-base flex items-center gap-2"><Building2 size={15} /> Nouvelle organisation</h2>
          <button onClick={onClose}><X size={18} className="text-text-muted" /></button>
        </div>
        {error && <p className="mx-6 mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        <div className="p-6 flex flex-col gap-3">
          {[
            { key: 'nom', label: 'Nom *' }, { key: 'telephone', label: 'Téléphone' },
            { key: 'email', label: 'Email' }, { key: 'adresse', label: 'Adresse' },
            { key: 'matricule_fiscal', label: 'Matricule fiscal' },
          ].map(f => (
            <div key={f.key} className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-text-secondary">{f.label}</label>
              <input value={form[f.key as keyof typeof form]} onChange={e => setForm(v => ({ ...v, [f.key]: e.target.value }))}
                className="border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent-500" />
            </div>
          ))}
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-border">
          <button type="button" onClick={onClose} className="flex-1 bg-muted hover:bg-border font-semibold py-2.5 rounded-xl text-sm">Annuler</button>
          <button type="button" onClick={handleSave} disabled={saving} className="flex-1 bg-accent-500 hover:bg-accent-400 disabled:bg-gray-200 text-black font-bold py-2.5 rounded-xl text-sm">
            {saving ? 'Enregistrement...' : 'Ajouter'}
          </button>
        </div>
      </div>
    </div>
  )
}

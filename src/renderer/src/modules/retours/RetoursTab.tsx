import { useState, useEffect, useCallback } from 'react'
import type { Retour } from '../../lib/types'
import { formatPrice } from '../../lib/utils'
import { cn } from '../../lib/utils'
import { loadData, runAction } from '../../lib/apiCall'
import {
  RotateCcw, RefreshCw, Search, X, AlertTriangle, CheckCircle,
  Package, Banknote, Clock, Filter
} from 'lucide-react'

const api = window.api

type StatutFilter = 'TOUS' | 'EN_ATTENTE' | 'RESOLU' | 'REMBOURSE' | 'ECHANGE'

const STATUT_CONFIG: Record<string, { label: string; color: string }> = {
  EN_ATTENTE:   { label: 'En attente',    color: 'bg-yellow-100 text-yellow-800 border border-yellow-200' },
  RESOLU:       { label: 'Résolu',        color: 'bg-green-100 text-green-800 border border-green-200' },
  REMBOURSE:    { label: 'Remboursé',     color: 'bg-blue-100 text-blue-800 border border-blue-200' },
  ECHANGE:      { label: 'Échangé',       color: 'bg-purple-100 text-purple-800 border border-purple-200' },
}

const TYPE_CONFIG = {
  DEFECTUEUX:    { label: 'Défectueux', color: 'bg-red-100 text-red-800 border border-red-200', icon: <AlertTriangle size={10} /> },
  SANS_PROBLEME: { label: 'Sans problème', color: 'bg-green-100 text-green-800 border border-green-200', icon: <CheckCircle size={10} /> },
}

export default function RetoursTab() {
  const [retours, setRetours] = useState<Retour[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [statutFilter, setStatutFilter] = useState<StatutFilter>('TOUS')
  const [selected, setSelected] = useState<Retour | null>(null)
  const [resolving, setResolving] = useState(false)
  const [newStatut, setNewStatut] = useState('')
  const [resolution, setResolution] = useState('')

  const load = useCallback(async () => {
    const filters = statutFilter !== 'TOUS' ? { statut: statutFilter } : {}
    const r = await loadData('Chargement retours', () => api.retoursList(filters) as Promise<Retour[]>, { setLoading })
    if (r) setRetours(r)
  }, [statutFilter])

  useEffect(() => { load() }, [load])

  const filtered = retours.filter(r => {
    if (!search.trim()) return true
    const s = search.toLowerCase()
    return r.designation.toLowerCase().includes(s) ||
      (r.vente_numero?.toLowerCase().includes(s)) ||
      (r.operateur?.toLowerCase().includes(s))
  })

  // KPIs
  const enAttente = retours.filter(r => r.statut === 'EN_ATTENTE').length
  const totalRembourse = retours.filter(r => r.statut === 'REMBOURSE').reduce((s, r) => s + r.montant_rembourse, 0)
  const defectueux = retours.filter(r => r.type_retour === 'DEFECTUEUX').length

  const handleResolve = async () => {
    if (!selected || !newStatut) return
    await runAction('Mise à jour retour', async () => {
      await api.retoursUpdateStatut(selected.id, newStatut, { resolution: resolution.trim() || null })
      setSelected(null)
      setNewStatut('')
      setResolution('')
      load()
    }, { setSaving: setResolving, successMessage: 'Statut mis à jour' })
  }

  return (
    <div className="h-full flex overflow-hidden bg-surface">
      {/* ── LEFT PANEL ── */}
      <div className="w-96 flex-shrink-0 flex flex-col border-r border-border bg-white">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="font-bold text-sm flex items-center gap-2">
            <RotateCcw size={14} className="text-red-500" /> Retours Produits
          </h2>
          <button onClick={load} disabled={loading} className="p-1.5 text-text-muted hover:text-text-primary rounded-lg hover:bg-muted">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-3 gap-2 px-3 py-3 border-b border-border">
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-2.5 text-center">
            <div className="text-[10px] font-semibold text-yellow-700 flex items-center justify-center gap-1 mb-0.5">
              <Clock size={9} /> En attente
            </div>
            <div className="font-bold text-xl text-yellow-800">{enAttente}</div>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-xl p-2.5 text-center">
            <div className="text-[10px] font-semibold text-red-700 flex items-center justify-center gap-1 mb-0.5">
              <AlertTriangle size={9} /> Défectueux
            </div>
            <div className="font-bold text-xl text-red-800">{defectueux}</div>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-2.5 text-center">
            <div className="text-[10px] font-semibold text-blue-700 flex items-center justify-center gap-1 mb-0.5">
              <Banknote size={9} /> Remboursé
            </div>
            <div className="font-bold font-price text-xs text-blue-800">{formatPrice(totalRembourse)}</div>
          </div>
        </div>

        {/* Search + filter */}
        <div className="px-3 py-2 border-b border-border space-y-2">
          <div className="flex items-center gap-2 border border-border rounded-lg px-2.5 py-1.5 bg-muted focus-within:border-accent-500 transition-colors">
            <Search size={12} className="text-text-muted" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-xs outline-none"
              placeholder="Désignation, vente, opérateur..."
            />
            {search && <button onClick={() => setSearch('')}><X size={11} className="text-text-muted" /></button>}
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            <Filter size={10} className="text-text-muted" />
            {(['TOUS', 'EN_ATTENTE', 'RESOLU', 'REMBOURSE', 'ECHANGE'] as StatutFilter[]).map(s => (
              <button
                key={s}
                onClick={() => setStatutFilter(s)}
                className={cn(
                  'px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors',
                  statutFilter === s ? 'bg-accent-500 border-accent-500' : 'border-border hover:bg-muted text-text-secondary'
                )}
              >
                {s === 'TOUS' ? 'Tous' : STATUT_CONFIG[s]?.label ?? s}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-text-muted">
              <Package size={32} className="mb-2 opacity-25" />
              <p className="text-xs">Aucun retour</p>
            </div>
          ) : filtered.map(r => {
            const typeConf = TYPE_CONFIG[r.type_retour]
            const statutConf = STATUT_CONFIG[r.statut]
            return (
              <button
                key={r.id}
                onClick={() => { setSelected(r); setNewStatut(''); setResolution('') }}
                className={cn(
                  'w-full flex items-start gap-2.5 px-3 py-2.5 border-b border-border text-left transition-colors',
                  selected?.id === r.id
                    ? 'bg-accent-50 border-l-2 border-l-accent-500'
                    : 'hover:bg-muted border-l-2 border-l-transparent'
                )}
              >
                <div className={cn('w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 text-xs font-bold', r.type_retour === 'DEFECTUEUX' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700')}>
                  <RotateCcw size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-xs truncate">{r.designation}</div>
                  <div className="text-[10px] text-text-muted mt-0.5">
                    {r.vente_numero && `${r.vente_numero} · `}
                    {new Date(r.created_at).toLocaleDateString('fr-FR')}
                  </div>
                  <div className="flex items-center gap-1 mt-1 flex-wrap">
                    <span className={cn('inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold', typeConf.color)}>
                      {typeConf.icon} {typeConf.label}
                    </span>
                    <span className={cn('px-1.5 py-0.5 rounded-full text-[10px] font-semibold', statutConf.color)}>
                      {statutConf.label}
                    </span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-[10px] text-text-muted">×{r.quantite}</div>
                  {r.montant_rembourse > 0 && (
                    <div className="font-price text-xs text-blue-700 font-bold">{formatPrice(r.montant_rembourse)}</div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── RIGHT PANEL ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-full text-text-muted">
            <RotateCcw size={48} className="mb-3 opacity-15" />
            <p className="text-sm font-semibold">Sélectionnez un retour</p>
            <p className="text-xs mt-1">pour voir les détails et gérer la résolution</p>
          </div>
        ) : (
          <>
            {/* Detail header */}
            <div className="flex items-start gap-4 px-5 py-4 bg-white border-b border-border flex-shrink-0">
              <div className={cn('w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0', selected.type_retour === 'DEFECTUEUX' ? 'bg-red-100' : 'bg-green-100')}>
                {selected.type_retour === 'DEFECTUEUX' ? <AlertTriangle size={22} className="text-red-600" /> : <CheckCircle size={22} className="text-green-600" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-base truncate">{selected.designation}</div>
                <div className="text-sm text-text-secondary mt-0.5">
                  Quantité : {selected.quantite} · Prix unitaire : {formatPrice(selected.prix_unitaire)}
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className={cn('px-2 py-0.5 rounded-full text-xs font-bold', TYPE_CONFIG[selected.type_retour].color)}>
                    {TYPE_CONFIG[selected.type_retour].label}
                  </span>
                  <span className={cn('px-2 py-0.5 rounded-full text-xs font-bold', STATUT_CONFIG[selected.statut]?.color)}>
                    {STATUT_CONFIG[selected.statut]?.label ?? selected.statut}
                  </span>
                </div>
              </div>
              {selected.montant_rembourse > 0 && (
                <div className="text-right flex-shrink-0">
                  <div className="text-xs text-text-muted">Remboursé</div>
                  <div className="font-price font-bold text-lg text-blue-700">{formatPrice(selected.montant_rembourse)}</div>
                </div>
              )}
            </div>

            {/* Details */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: 'N° Vente', value: selected.vente_numero ?? '—' },
                  { label: 'Opérateur', value: selected.operateur ?? '—' },
                  { label: 'Date', value: new Date(selected.created_at).toLocaleString('fr-FR') },
                  { label: 'Résolution', value: selected.resolution ?? '—' },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-surface rounded-xl p-3 border border-border">
                    <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-0.5">{label}</div>
                    <div className="text-sm font-medium text-text-primary">{value}</div>
                  </div>
                ))}
              </div>

              {selected.motif && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3">
                  <div className="text-[10px] font-semibold text-yellow-700 uppercase tracking-wider mb-0.5">Motif</div>
                  <div className="text-sm text-yellow-800">{selected.motif}</div>
                </div>
              )}

              {/* Update status */}
              {selected.statut === 'EN_ATTENTE' && (
                <div className="bg-white border border-border rounded-xl p-4 space-y-3">
                  <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Mettre à jour le statut</div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'RESOLU', label: 'Résolu', color: 'border-green-400 bg-green-50 text-green-700' },
                      { id: 'REMBOURSE', label: 'Remboursé', color: 'border-blue-400 bg-blue-50 text-blue-700' },
                      { id: 'ECHANGE', label: 'Échangé', color: 'border-purple-400 bg-purple-50 text-purple-700' },
                    ].map(opt => (
                      <button
                        key={opt.id}
                        onClick={() => setNewStatut(opt.id)}
                        className={cn(
                          'py-2 rounded-xl border-2 text-xs font-bold transition-all',
                          newStatut === opt.id ? opt.color : 'border-border hover:bg-muted text-text-secondary'
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <input
                    value={resolution}
                    onChange={e => setResolution(e.target.value)}
                    className="w-full border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-accent-500"
                    placeholder="Note de résolution (optionnel)..."
                  />
                  <button
                    type="button"
                    onClick={handleResolve}
                    disabled={!newStatut || resolving}
                    className="w-full bg-accent-500 hover:bg-accent-600 disabled:bg-gray-200 disabled:text-gray-400 font-bold py-2.5 rounded-xl text-sm transition-colors"
                  >
                    {resolving ? 'Mise à jour...' : 'Appliquer'}
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

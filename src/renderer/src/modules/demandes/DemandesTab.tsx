import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, BellRing, CalendarClock, Check, CheckCircle2, ClipboardList,
  Clock3, PackageSearch, Phone, Plus, RefreshCw, RotateCcw, Search, UserRound, Wrench, X,
} from 'lucide-react'
import type { DemandeClient, Operateur, StatutDemandeClient, TypeDemandeClient } from '../../lib/types'
import { cn, formatPrice, generateId } from '../../lib/utils'
import { loadData, runAction } from '../../lib/apiCall'
import { useAppStore } from '../../store/appStore'

const api = window.api

const TYPE_CONFIG: Record<TypeDemandeClient, { label: string; icon: typeof PackageSearch; style: string }> = {
  PRODUIT: { label: 'Produit sur commande', icon: PackageSearch, style: 'bg-blue-50 text-blue-700 border-blue-200' },
  PIECE: { label: 'Pièce', icon: Wrench, style: 'bg-violet-50 text-violet-700 border-violet-200' },
  RAPPEL: { label: 'Rappel', icon: BellRing, style: 'bg-amber-50 text-amber-700 border-amber-200' },
}

function announceDemandesChanged() {
  window.dispatchEvent(new CustomEvent('smlpos:demandes-changed'))
}

function toDateTimeLocal(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function dueState(demande: DemandeClient) {
  if (demande.statut !== 'A_FAIRE' || !demande.echeance) return 'none'
  const due = new Date(demande.echeance).getTime()
  if (!Number.isFinite(due)) return 'none'
  const now = Date.now()
  if (due < now) return 'overdue'
  if (due - now <= 24 * 60 * 60 * 1000) return 'soon'
  return 'future'
}

export function DemandeClientModal({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const { currentOperateur } = useAppStore()
  const [operateurs, setOperateurs] = useState<Operateur[]>([])
  const [typeDemande, setTypeDemande] = useState<TypeDemandeClient>('PRODUIT')
  const [titre, setTitre] = useState('')
  const [details, setDetails] = useState('')
  const [clientNom, setClientNom] = useState('')
  const [clientTel, setClientTel] = useState('')
  const [avance, setAvance] = useState('')
  const [responsableId, setResponsableId] = useState(currentOperateur?.id ?? '')
  const [echeance, setEcheance] = useState(() => {
    const date = new Date()
    date.setDate(date.getDate() + 1)
    date.setHours(10, 0, 0, 0)
    return toDateTimeLocal(date)
  })
  const [priorite, setPriorite] = useState<'NORMALE' | 'URGENTE'>('NORMALE')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    void loadData('Chargement agents', () => api.operateursList() as Promise<Operateur[]>, { silent: true })
      .then(rows => {
        const list = rows ?? []
        setOperateurs(list)
        if (!responsableId && list.length) setResponsableId(list[0].id)
      })
  }, [])

  const responsable = operateurs.find(op => op.id === responsableId)
    ?? (currentOperateur?.id === responsableId ? currentOperateur : undefined)
  const canSave = titre.trim().length > 0 && !!responsable

  const save = async () => {
    if (!canSave || !responsable) return
    const succeeded = await runAction('Nouvelle demande', async () => {
      await api.demandesClientsCreate({
        id: generateId(),
        type_demande: typeDemande,
        titre: titre.trim(),
        details: details.trim() || null,
        client_nom: clientNom.trim() || null,
        client_tel: clientTel.trim() || null,
        avance: Math.max(0, parseFloat(avance.replace(',', '.')) || 0),
        responsable_id: responsable.id,
        responsable_nom: responsable.nom,
        echeance: echeance ? new Date(echeance).toISOString() : null,
        priorite,
        created_by: currentOperateur?.nom ?? 'superadmin',
      })
    }, {
      setLoading,
      successMessage: 'Demande enregistrée',
      feedback: 'success',
    })
    if (!succeeded) return
    announceDemandesChanged()
    onSaved?.()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl animate-slide-in">
        <div className="flex items-center justify-between border-b border-border bg-gradient-to-r from-amber-50 to-accent-50 px-6 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold text-text-primary">
              <ClipboardList size={18} className="text-amber-600" />
              Demande client / Rappel
            </h2>
            <p className="mt-0.5 text-xs text-text-secondary">Commande produit, pièce à chercher ou tâche à ne pas oublier.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-text-muted hover:bg-white hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[72vh] space-y-5 overflow-y-auto p-6">
          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-text-secondary">Type</label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(TYPE_CONFIG) as TypeDemandeClient[]).map(type => {
                const config = TYPE_CONFIG[type]
                const Icon = config.icon
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setTypeDemande(type)}
                    className={cn(
                      'flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 px-3 text-xs font-bold transition-all',
                      typeDemande === type ? config.style : 'border-border bg-white text-text-secondary hover:bg-muted',
                    )}
                  >
                    <Icon size={15} /> {config.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-semibold">Demande / Objet <span className="text-danger">*</span></label>
            <input
              autoFocus
              value={titre}
              onChange={event => setTitre(event.target.value)}
              placeholder={typeDemande === 'PRODUIT' ? 'Ex : Commander chargeur HP 65W' : typeDemande === 'PIECE' ? 'Ex : Chercher écran Samsung A52' : 'Ex : Appeler le fournisseur'}
              className="w-full rounded-xl border border-border px-4 py-3 text-sm outline-none focus:border-accent-500"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-semibold">Détails</label>
            <textarea
              value={details}
              onChange={event => setDetails(event.target.value)}
              placeholder="Couleur, référence, quantité, information importante…"
              rows={3}
              className="w-full resize-none rounded-xl border border-border px-4 py-3 text-sm outline-none focus:border-accent-500"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-semibold">Nom du client</label>
              <input value={clientNom} onChange={event => setClientNom(event.target.value)} placeholder="Optionnel pour un rappel" className="w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none focus:border-accent-500" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold">Téléphone</label>
              <input value={clientTel} onChange={event => setClientTel(event.target.value)} placeholder="2x xxx xxx" className="w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none focus:border-accent-500" />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-sm font-semibold">Avance client</label>
              <div className="flex items-center rounded-xl border border-border px-3 focus-within:border-accent-500">
                <input value={avance} onChange={event => setAvance(event.target.value.replace(/[^0-9.,]/g, ''))} inputMode="decimal" placeholder="0.000" className="min-w-0 flex-1 py-2.5 font-price text-sm outline-none" />
                <span className="text-xs font-semibold text-text-muted">DT</span>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold">Agent responsable <span className="text-danger">*</span></label>
              <select value={responsableId} onChange={event => setResponsableId(event.target.value)} className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm outline-none focus:border-accent-500">
                <option value="">Choisir…</option>
                {operateurs.map(op => <option key={op.id} value={op.id}>{op.nom}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold">Échéance / rappel</label>
              <input type="datetime-local" value={echeance} onChange={event => setEcheance(event.target.value)} className="w-full rounded-xl border border-border px-3 py-2.5 text-xs outline-none focus:border-accent-500" />
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <input type="checkbox" checked={priorite === 'URGENTE'} onChange={event => setPriorite(event.target.checked ? 'URGENTE' : 'NORMALE')} className="h-4 w-4 accent-red-600" />
            <AlertTriangle size={15} className="text-red-600" />
            <span className="text-sm font-semibold text-red-800">Demande urgente</span>
          </label>
        </div>

        <div className="flex gap-3 border-t border-border px-6 py-4">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl bg-muted py-2.5 text-sm font-semibold hover:bg-border">Annuler</button>
          <button type="button" onClick={() => void save()} disabled={!canSave || loading} className="flex-1 rounded-xl bg-accent-500 py-2.5 text-sm font-bold hover:bg-accent-600 disabled:bg-gray-200 disabled:text-gray-400">
            {loading ? 'Enregistrement…' : 'Enregistrer la demande'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function DemandesTab() {
  const { currentOperateur } = useAppStore()
  const [demandes, setDemandes] = useState<DemandeClient[]>([])
  const [loading, setLoading] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'A_FAIRE' | 'TERMINE' | 'TOUT'>('A_FAIRE')
  const [typeFilter, setTypeFilter] = useState<TypeDemandeClient | 'TOUT'>('TOUT')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    const rows = await loadData('Chargement demandes', () => api.demandesClientsList() as Promise<DemandeClient[]>, { setLoading })
    if (rows) setDemandes(rows)
  }, [])

  useEffect(() => {
    void load()
    const handler = () => void load()
    window.addEventListener('smlpos:demandes-changed', handler)
    return () => window.removeEventListener('smlpos:demandes-changed', handler)
  }, [load])

  const stats = useMemo(() => {
    const pending = demandes.filter(d => d.statut === 'A_FAIRE')
    return {
      pending: pending.length,
      urgent: pending.filter(d => d.priorite === 'URGENTE').length,
      overdue: pending.filter(d => dueState(d) === 'overdue').length,
      completed: demandes.filter(d => d.statut === 'TERMINE').length,
    }
  }, [demandes])

  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('fr')
    return demandes.filter(d =>
      (statusFilter === 'TOUT' || d.statut === statusFilter)
      && (typeFilter === 'TOUT' || d.type_demande === typeFilter)
      && (!query || [d.titre, d.details, d.client_nom, d.client_tel, d.responsable_nom].some(value =>
        String(value ?? '').toLocaleLowerCase('fr').includes(query)
      ))
    )
  }, [demandes, search, statusFilter, typeFilter])

  const changeStatus = async (demande: DemandeClient, statut: StatutDemandeClient) => {
    const succeeded = await runAction('Mise à jour demande', () =>
      api.demandesClientsUpdateStatus(demande.id, statut, currentOperateur?.nom), {
      successMessage: statut === 'TERMINE' ? 'Demande terminée' : statut === 'A_FAIRE' ? 'Demande rouverte' : 'Demande annulée',
      feedback: statut === 'TERMINE' ? 'success' : 'click',
    })
    if (!succeeded) return
    announceDemandesChanged()
    await load()
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface">
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-white px-5 py-4">
        <div className="mr-auto">
          <h1 className="flex items-center gap-2 text-lg font-bold"><ClipboardList size={20} className="text-amber-600" /> Demandes clients / Rappels</h1>
          <p className="text-xs text-text-muted">Commandes, pièces et tâches confiées aux agents.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="rounded-xl border border-border bg-white p-2.5 text-text-secondary hover:bg-muted">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
        <button type="button" onClick={() => setShowNew(true)} className="flex items-center gap-2 rounded-xl bg-accent-500 px-4 py-2.5 text-sm font-bold hover:bg-accent-600">
          <Plus size={16} /> Nouvelle demande
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 border-b border-border px-5 py-4 md:grid-cols-4">
        {[
          { label: 'À faire', value: stats.pending, style: 'border-amber-200 bg-amber-50 text-amber-800', icon: Clock3 },
          { label: 'Urgentes', value: stats.urgent, style: 'border-red-200 bg-red-50 text-red-700', icon: AlertTriangle },
          { label: 'En retard', value: stats.overdue, style: 'border-orange-200 bg-orange-50 text-orange-800', icon: CalendarClock },
          { label: 'Terminées', value: stats.completed, style: 'border-green-200 bg-green-50 text-green-700', icon: CheckCircle2 },
        ].map(card => {
          const Icon = card.icon
          return <div key={card.label} className={cn('flex items-center gap-3 rounded-xl border px-4 py-3', card.style)}><Icon size={17} /><div><div className="text-xl font-bold font-price">{card.value}</div><div className="text-[11px] font-semibold">{card.label}</div></div></div>
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-white px-5 py-3">
        <div className="flex rounded-xl bg-muted p-1">
          {([
            ['A_FAIRE', `À faire (${stats.pending})`],
            ['TERMINE', 'Terminées'],
            ['TOUT', 'Tout'],
          ] as const).map(([value, label]) => (
            <button key={value} onClick={() => setStatusFilter(value)} className={cn('rounded-lg px-3 py-1.5 text-xs font-semibold', statusFilter === value ? 'bg-white text-text-primary shadow-sm' : 'text-text-secondary')}>{label}</button>
          ))}
        </div>
        <select value={typeFilter} onChange={event => setTypeFilter(event.target.value as TypeDemandeClient | 'TOUT')} className="rounded-xl border border-border bg-white px-3 py-2 text-xs">
          <option value="TOUT">Tous les types</option>
          <option value="PRODUIT">Produits</option>
          <option value="PIECE">Pièces</option>
          <option value="RAPPEL">Rappels</option>
        </select>
        <div className="ml-auto flex min-w-[240px] items-center gap-2 rounded-xl border border-border bg-white px-3 py-2">
          <Search size={14} className="text-text-muted" />
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Client, téléphone, demande, agent…" className="w-full bg-transparent text-xs outline-none" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {visible.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center text-text-muted">
            <ClipboardList size={38} className="mb-3 opacity-30" />
            <p className="font-semibold">Aucune demande dans ce filtre</p>
            <button onClick={() => setShowNew(true)} className="mt-3 text-xs font-bold text-amber-700 underline">Créer une demande</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {visible.map(demande => {
              const type = TYPE_CONFIG[demande.type_demande]
              const TypeIcon = type.icon
              const due = dueState(demande)
              return (
                <article key={demande.id} className={cn(
                  'rounded-2xl border bg-white p-4 shadow-sm transition-colors',
                  due === 'overdue' ? 'border-red-300 bg-red-50/30' : due === 'soon' ? 'border-amber-300' : 'border-border',
                  demande.statut !== 'A_FAIRE' && 'opacity-75',
                )}>
                  <div className="flex items-start gap-3">
                    <div className={cn('flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border', type.style)}><TypeIcon size={18} /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className={cn('font-bold text-text-primary', demande.statut === 'TERMINE' && 'line-through')}>{demande.titre}</h3>
                        {demande.priorite === 'URGENTE' && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">URGENT</span>}
                        {due === 'overdue' && <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white">EN RETARD</span>}
                      </div>
                      <div className="mt-0.5 text-[11px] font-semibold text-text-muted">{type.label}</div>
                      {demande.details && <p className="mt-2 whitespace-pre-wrap text-sm text-text-secondary">{demande.details}</p>}
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                    {(demande.client_nom || demande.client_tel) && <div className="rounded-xl bg-muted px-3 py-2"><div className="flex items-center gap-1 font-semibold"><UserRound size={12} /> {demande.client_nom || 'Client'}</div>{demande.client_tel && <div className="mt-1 flex items-center gap-1 text-text-muted"><Phone size={11} /> {demande.client_tel}</div>}</div>}
                    <div className="rounded-xl bg-muted px-3 py-2"><div className="text-[10px] text-text-muted">Responsable</div><div className="mt-0.5 font-bold">{demande.responsable_nom}</div></div>
                    {demande.avance > 0 && <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-green-700"><div className="text-[10px]">Avance</div><div className="font-price font-bold">{formatPrice(demande.avance)}</div></div>}
                    {demande.echeance && <div className={cn('rounded-xl border px-3 py-2', due === 'overdue' ? 'border-red-200 bg-red-50 text-red-700' : due === 'soon' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-border bg-white')}><div className="flex items-center gap-1 text-[10px]"><CalendarClock size={11} /> Échéance</div><div className="mt-0.5 font-semibold">{new Date(demande.echeance).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</div></div>}
                  </div>

                  <div className="mt-4 flex justify-end gap-2 border-t border-border pt-3">
                    {demande.statut === 'A_FAIRE' ? (
                      <>
                        <button onClick={() => void changeStatus(demande, 'ANNULE')} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-text-muted hover:bg-red-50 hover:text-red-600">Annuler</button>
                        <button onClick={() => void changeStatus(demande, 'TERMINE')} className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-green-700"><Check size={13} /> Terminer</button>
                      </>
                    ) : (
                      <button onClick={() => void changeStatus(demande, 'A_FAIRE')} className="flex items-center gap-1.5 rounded-lg bg-muted px-3 py-1.5 text-xs font-semibold hover:bg-border"><RotateCcw size={12} /> Rouvrir</button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>

      {showNew && <DemandeClientModal onClose={() => setShowNew(false)} onSaved={() => void load()} />}
    </div>
  )
}

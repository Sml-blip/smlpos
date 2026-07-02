import { useState, useEffect, useCallback } from 'react'
import type { Client } from '../lib/types'
import { cn, generateId } from '../lib/utils'
import { loadData, runAction } from '../lib/apiCall'
import { Search, User, X, Plus, Phone } from 'lucide-react'

const api = window.api

export interface ClientFormValue {
  clientId?: string
  nom: string
  tel: string
  adresse: string
  matricule: string
}

interface Props {
  value: ClientFormValue
  onChange: (value: ClientFormValue) => void
  allowPassager?: boolean
  allowCreate?: boolean
  compact?: boolean
  required?: boolean
  className?: string
}

export function clientFromRecord(c: Client): ClientFormValue {
  return {
    clientId: c.id,
    nom: c.nom,
    tel: c.telephone ?? '',
    adresse: c.adresse ?? '',
    matricule: c.matricule_fiscal ?? '',
  }
}

export function emptyClientForm(): ClientFormValue {
  return { nom: '', tel: '', adresse: '', matricule: '' }
}

export default function ClientPicker({
  value,
  onChange,
  allowPassager = true,
  allowCreate = true,
  compact = false,
  required = false,
  className,
}: Props) {
  const [search, setSearch] = useState('')
  const [clients, setClients] = useState<Client[]>([])
  const [showList, setShowList] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ nom: '', telephone: '', adresse: '', matricule_fiscal: '' })
  const [createError, setCreateError] = useState('')
  const [creating, setCreating] = useState(false)

  const loadClients = useCallback(async (q: string) => {
    const rows = await loadData('Chargement clients', () =>
      api.clientsList(q.length >= 2 ? { search: q } : {}) as Promise<Client[]>,
    { silent: true })
    if (rows) setClients((rows as Client[]).slice(0, compact ? 6 : 10))
  }, [compact])

  useEffect(() => {
    if (!showList) return
    const t = setTimeout(() => { void loadClients(search) }, search.length >= 2 ? 200 : 0)
    return () => clearTimeout(t)
  }, [search, showList, loadClients])

  const selectClient = (c: Client) => {
    onChange(clientFromRecord(c))
    setShowList(false)
    setSearch('')
  }

  const clearClient = () => {
    onChange(emptyClientForm())
    setSearch('')
  }

  const setPassager = () => {
    onChange({ nom: 'Client Passager', tel: '', adresse: '', matricule: '' })
    setShowList(false)
  }

  const handleCreate = async () => {
    if (!createForm.nom.trim()) {
      setCreateError('Nom requis')
      return
    }
    setCreateError('')
    const ok = await runAction('Enregistrement client', async () => {
      const id = generateId()
      await api.clientsCreate({
        id,
        nom: createForm.nom.trim(),
        telephone: createForm.telephone.trim() || null,
        adresse: createForm.adresse.trim() || null,
        matricule_fiscal: createForm.matricule_fiscal.trim() || null,
        credit_limite: 500,
        solde_credit: 0,
        actif: 1,
        created_at: new Date().toISOString(),
      })
      selectClient({
        id,
        nom: createForm.nom.trim(),
        telephone: createForm.telephone.trim(),
        adresse: createForm.adresse.trim(),
        matricule_fiscal: createForm.matricule_fiscal.trim(),
        solde_credit: 0,
        created_at: new Date().toISOString(),
      })
      setShowCreate(false)
      setCreateForm({ nom: '', telephone: '', adresse: '', matricule_fiscal: '' })
    }, { setLoading: setCreating, silent: true, onError: msg => setCreateError(msg.replace(/^Enregistrement client : /, '')) })
    if (!ok) return
  }

  const updateField = (key: keyof ClientFormValue, v: string) => {
    onChange({ ...value, [key === 'tel' ? 'tel' : key]: v, ...(key !== 'clientId' ? { clientId: undefined } : {}) })
  }

  return (
    <div className={cn('space-y-3', className)}>
      {value.clientId ? (
        <div className="flex items-center gap-2 p-2.5 bg-accent-50 border border-accent-200 rounded-xl">
          <User size={14} className="text-accent-600 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-text-primary truncate">{value.nom}</p>
            {value.tel && <p className="text-[10px] text-text-muted flex items-center gap-1"><Phone size={9} />{value.tel}</p>}
          </div>
          <button type="button" onClick={clearClient} className="p-1 text-text-muted hover:text-text-primary rounded-lg hover:bg-white">
            <X size={14} />
          </button>
        </div>
      ) : (
        <div className="relative">
          <div className="flex items-center gap-2 border border-border rounded-xl px-3 py-2 focus-within:border-accent-500 bg-white">
            <Search size={13} className="text-text-muted flex-shrink-0" />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setShowList(true) }}
              onFocus={() => { setShowList(true); void loadClients(search) }}
              placeholder="Rechercher un client enregistré..."
              className="flex-1 bg-transparent outline-none text-sm min-w-0"
            />
            {allowCreate && (
              <button type="button" onClick={() => setShowCreate(true)} className="text-accent-600 hover:text-accent-700 p-1" title="Nouveau client">
                <Plus size={15} />
              </button>
            )}
          </div>
          {showList && (
            <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-border rounded-xl shadow-lg max-h-48 overflow-auto">
              {allowPassager && (
                <button type="button" onClick={setPassager}
                  className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted border-b border-border text-text-secondary">
                  Client passager (sans fiche)
                </button>
              )}
              {clients.length === 0 ? (
                <p className="px-3 py-3 text-xs text-text-muted text-center">
                  {search.length >= 2 ? 'Aucun client trouvé' : 'Tapez pour rechercher…'}
                </p>
              ) : clients.map(c => (
                <button key={c.id} type="button" onClick={() => selectClient(c)}
                  className="w-full text-left px-3 py-2.5 hover:bg-accent-50 border-b border-border last:border-0">
                  <p className="text-sm font-medium text-text-primary">{c.nom}</p>
                  {c.telephone && <p className="text-[10px] text-text-muted">{c.telephone}</p>}
                </button>
              ))}
              <button type="button" onClick={() => setShowList(false)} className="w-full px-3 py-2 text-[10px] text-text-muted hover:bg-muted">
                Fermer
              </button>
            </div>
          )}
        </div>
      )}

      {(!value.clientId || !compact) && (
        <div className={cn('grid gap-2', compact ? 'grid-cols-1' : 'grid-cols-2')}>
          <div className={compact ? '' : 'col-span-2'}>
            <label className="block text-xs font-semibold text-text-secondary mb-1">
              Nom {required && !value.clientId ? '*' : ''}
            </label>
            <input type="text" value={value.nom} onChange={e => updateField('nom', e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent-500"
              placeholder="Nom ou raison sociale" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">Téléphone</label>
            <input type="text" value={value.tel} onChange={e => updateField('tel', e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent-500"
              placeholder="2x xxx xxx" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">Matricule fiscal</label>
            <input type="text" value={value.matricule} onChange={e => updateField('matricule', e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent-500"
              placeholder="MF optionnel" />
          </div>
          {!compact && (
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-text-secondary mb-1">Adresse</label>
              <input type="text" value={value.adresse} onChange={e => updateField('adresse', e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent-500"
                placeholder="Adresse (optionnel)" />
            </div>
          )}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm">Nouveau client</h3>
              <button type="button" onClick={() => setShowCreate(false)}><X size={16} className="text-text-muted" /></button>
            </div>
            {createError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{createError}</p>}
            {(['nom', 'telephone', 'matricule_fiscal'] as const).map(key => (
              <div key={key}>
                <label className="block text-xs font-semibold text-text-secondary mb-1">
                  {key === 'nom' ? 'Nom *' : key === 'telephone' ? 'Téléphone' : 'Matricule fiscal'}
                </label>
                <input value={createForm[key]} onChange={e => setCreateForm(f => ({ ...f, [key]: e.target.value }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent-500" />
              </div>
            ))}
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1">Adresse</label>
              <input value={createForm.adresse} onChange={e => setCreateForm(f => ({ ...f, adresse: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent-500" />
            </div>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setShowCreate(false)} className="flex-1 py-2.5 bg-muted rounded-xl text-sm font-semibold">Annuler</button>
              <button type="button" onClick={() => void handleCreate()} disabled={creating}
                className="flex-1 py-2.5 bg-accent-500 rounded-xl text-sm font-bold disabled:opacity-50">
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

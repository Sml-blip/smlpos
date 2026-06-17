import { useState, useEffect, useCallback, useRef } from 'react'
import { formatPrice, formatDate, generateId } from '../../lib/utils'
import { cn } from '../../lib/utils'
import { useAppStore } from '../../store/appStore'
import {
  Users, X, Plus, RefreshCw, Search,
  Phone, Mail, MapPin, FileText
} from 'lucide-react'
import { runAction, loadData } from '../../lib/apiCall'
import Fuse from 'fuse.js'
import type { Document } from '../../lib/types'

const api = window.api

type SubTab = 'clients' | 'documents'

interface Client {
  id: string; nom: string; telephone?: string; email?: string; adresse?: string
  organisation_id?: string; matricule_fiscal?: string
  solde_credit: number; credit_limite?: number; notes?: string; created_at: string
}

const TYPE_LABELS: Record<string, string> = {
  FACTURE_VENTE: 'Facture',
  DEVIS: 'Devis',
  BON_LIVRAISON: 'Bon de livraison',
  TICKET: 'Ticket',
}
const TYPE_COLORS: Record<string, string> = {
  FACTURE_VENTE: 'bg-blue-100 text-blue-800',
  DEVIS: 'bg-yellow-100 text-yellow-800',
  BON_LIVRAISON: 'bg-green-100 text-green-800',
  TICKET: 'bg-gray-100 text-gray-700',
}

export default function ClientsTab() {
  const { currentShift, currentOperateur } = useAppStore()
  const [subTab, setSubTab] = useState<SubTab>('clients')
  const [clients, setClients] = useState<Client[]>([])
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [showAddClient, setShowAddClient] = useState(false)
  const [docFilter, setDocFilter] = useState<string>('')

  const selectedRef = useRef<string | null>(null)
  selectedRef.current = selectedClient?.id ?? null

  const load = useCallback(async () => {
    const data = await loadData('Chargement clients', async () => {
      const [cl, docs] = await Promise.all([
        api.clientsList({}) as Promise<Client[]>,
        api.documentsList({ type_document: 'FACTURE_VENTE' }) as Promise<Document[]>,
      ])
      return { cl, docs }
    }, { setLoading })
    if (data) {
      setClients(data.cl ?? [])
      setDocuments(data.docs ?? [])
      if (selectedRef.current) {
        const updated = (data.cl ?? []).find(c => c.id === selectedRef.current)
        if (updated) setSelectedClient(updated)
      }
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Load documents for all types
  const loadAllDocs = useCallback(async () => {
    const docs = await loadData('Chargement documents', async () =>
      api.documentsList(docFilter ? { type_document: docFilter } : {}) as Promise<Document[]>
    )
    if (docs) setDocuments(docs ?? [])
  }, [docFilter])

  useEffect(() => {
    if (subTab === 'documents') loadAllDocs()
  }, [subTab, loadAllDocs])

  // Fuse search
  const fuseCl = clients.length ? new Fuse(clients, { keys: ['nom', 'telephone', 'email', 'matricule_fiscal'], threshold: 0.35 }) : null
  const filteredClients = search.length >= 2 && fuseCl
    ? fuseCl.search(search).map(r => r.item)
    : clients

  const clientDocuments = selectedClient
    ? documents.filter(d => d.client_id === selectedClient.id)
    : []

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-3 border-b border-border bg-white flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <Users size={18} className="text-accent-500" />
          <h1 className="text-base font-bold text-text-primary">Clients</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 text-text-muted hover:text-text-primary rounded-lg hover:bg-muted">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          {subTab === 'clients' && (
            <button onClick={() => setShowAddClient(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-500 hover:bg-accent-400 text-black text-xs font-semibold rounded-lg">
              <Plus size={13} /> Nouveau client
            </button>
          )}
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-0 bg-white border-b border-border px-4 flex-shrink-0">
        {([
          { id: 'clients' as SubTab, label: 'Clients', icon: <Users size={13} /> },
          { id: 'documents' as SubTab, label: 'Documents', icon: <FileText size={13} /> },
        ]).map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)}
            className={cn('flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-all',
              subTab === t.id ? 'border-accent-500 text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary')}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden flex">
        {/* ── Clients sub-tab ── */}
        {subTab === 'clients' && (
          <>
            {/* Left panel */}
            <div className="w-72 border-r border-border flex flex-col flex-shrink-0">
              <div className="p-3 border-b border-border">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Rechercher client..."
                    className="w-full pl-8 pr-3 py-2 border border-border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-accent-500/30" />
                </div>
              </div>
              <div className="flex-1 overflow-auto">
                {filteredClients.length === 0 ? (
                  <p className="text-center py-8 text-text-muted text-xs">Aucun client</p>
                ) : filteredClients.map(c => (
                  <button key={c.id} onClick={() => setSelectedClient(c)}
                    className={cn('w-full text-left px-4 py-3 border-b border-border hover:bg-muted/50 flex flex-col gap-0.5',
                      selectedClient?.id === c.id && 'bg-accent-50 border-l-2 border-l-accent-500')}>
                    <p className="text-sm font-medium text-text-primary">{c.nom}</p>
                    {c.telephone && <p className="text-xs text-text-muted flex items-center gap-1"><Phone size={10} />{c.telephone}</p>}
                    {(c.solde_credit ?? 0) > 0 && (
                      <p className="text-xs font-price text-red-600 font-semibold">Crédit : {formatPrice(c.solde_credit)}</p>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Right panel: Client detail */}
            <div className="flex-1 overflow-auto p-6">
              {!selectedClient ? (
                <div className="flex items-center justify-center h-full text-text-muted text-sm">
                  Sélectionner un client
                </div>
              ) : (
                <div className="flex flex-col gap-5 max-w-2xl">
                  {/* Client info */}
                  <div className="bg-white rounded-xl border border-border p-5">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h2 className="text-lg font-bold text-text-primary">{selectedClient.nom}</h2>
                        {selectedClient.telephone && <p className="text-sm text-text-secondary flex items-center gap-1.5"><Phone size={13} />{selectedClient.telephone}</p>}
                        {selectedClient.email && <p className="text-sm text-text-secondary flex items-center gap-1.5"><Mail size={13} />{selectedClient.email}</p>}
                        {selectedClient.adresse && <p className="text-sm text-text-secondary flex items-center gap-1.5"><MapPin size={13} />{selectedClient.adresse}</p>}
                        {selectedClient.matricule_fiscal && <p className="text-xs text-text-muted mt-1">MF: {selectedClient.matricule_fiscal}</p>}
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-text-muted">Solde crédit</p>
                        <p className={cn('text-2xl font-price font-bold', (selectedClient.solde_credit ?? 0) > 0 ? 'text-red-600' : 'text-green-600')}>
                          {formatPrice(selectedClient.solde_credit ?? 0)}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Client documents */}
                  <div className="bg-white rounded-xl border border-border overflow-hidden">
                    <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                      <p className="text-sm font-semibold text-text-primary">Documents du client</p>
                      <span className="text-xs text-text-muted">{clientDocuments.length} document{clientDocuments.length !== 1 ? 's' : ''}</span>
                    </div>
                    {clientDocuments.length === 0 ? (
                      <p className="text-center py-8 text-text-muted text-xs">Aucun document</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-muted text-xs text-text-secondary">
                            <th className="text-left px-4 py-2">Date</th>
                            <th className="text-left px-4 py-2">N°</th>
                            <th className="text-left px-4 py-2">Type</th>
                            <th className="text-right px-4 py-2">Total TTC</th>
                            <th className="text-left px-4 py-2">Statut</th>
                          </tr>
                        </thead>
                        <tbody>
                          {clientDocuments.map(d => (
                            <tr key={d.id} className="border-t border-border hover:bg-muted/50">
                              <td className="px-4 py-2.5 text-xs text-text-secondary">{formatDate(d.created_at)}</td>
                              <td className="px-4 py-2.5 text-xs font-mono">{d.numero}</td>
                              <td className="px-4 py-2.5">
                                <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', TYPE_COLORS[d.type_document] ?? 'bg-gray-100 text-gray-700')}>
                                  {TYPE_LABELS[d.type_document] ?? d.type_document}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-right font-price font-semibold">{formatPrice(d.total_ttc)}</td>
                              <td className="px-4 py-2.5 text-xs text-text-secondary">{d.statut}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Documents sub-tab ── */}
        {subTab === 'documents' && (
          <div className="flex-1 overflow-auto p-6 flex flex-col gap-4">
            {/* Filters */}
            <div className="flex items-center gap-3">
              <select value={docFilter} onChange={e => setDocFilter(e.target.value)}
                className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/30">
                <option value="">Tous les types</option>
                <option value="FACTURE_VENTE">Factures</option>
                <option value="DEVIS">Devis</option>
                <option value="BON_LIVRAISON">Bons de livraison</option>
              </select>
              <button onClick={loadAllDocs} className="px-3 py-2 bg-muted hover:bg-border rounded-lg text-xs font-medium">
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>

            {/* Documents table */}
            <div className="bg-white rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted text-xs text-text-secondary">
                    <th className="text-left px-4 py-2.5">Date</th>
                    <th className="text-left px-4 py-2.5">N°</th>
                    <th className="text-left px-4 py-2.5">Type</th>
                    <th className="text-left px-4 py-2.5">Client</th>
                    <th className="text-right px-4 py-2.5">Total TTC</th>
                    <th className="text-left px-4 py-2.5">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-8 text-text-muted text-xs">Aucun document</td></tr>
                  ) : documents.map(d => (
                    <tr key={d.id} className="border-t border-border hover:bg-muted/50">
                      <td className="px-4 py-2.5 text-xs text-text-secondary">{formatDate(d.created_at)}</td>
                      <td className="px-4 py-2.5 text-xs font-mono">{d.numero}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', TYPE_COLORS[d.type_document] ?? 'bg-gray-100 text-gray-700')}>
                          {TYPE_LABELS[d.type_document] ?? d.type_document}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-medium">{d.client_nom ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right font-price font-semibold">{formatPrice(d.total_ttc)}</td>
                      <td className="px-4 py-2.5 text-xs text-text-secondary">{d.statut}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Add Client Modal */}
      {showAddClient && (
        <AddClientModal
          onClose={() => setShowAddClient(false)}
          onSaved={() => { setShowAddClient(false); load() }}
        />
      )}
    </div>
  )
}

// ── Add Client Modal ──────────────────────────────────────────────────────────
function AddClientModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ nom: '', telephone: '', email: '', adresse: '', matricule_fiscal: '', credit_limite: '500' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    if (!form.nom.trim()) { setError('Nom requis'); return }
    setError('')
    const ok = await runAction('Enregistrement client', async () => {
      await api.clientsCreate({
        id: generateId(), ...form,
        credit_limite: parseFloat(form.credit_limite) || 500,
        solde_credit: 0,
        matricule_fiscal: form.matricule_fiscal || null,
        actif: 1,
        created_at: new Date().toISOString(),
      })
    }, {
      setSaving,
      successMessage: 'Client ajouté',
      onError: msg => setError(msg.replace(/^Enregistrement client : /, '')),
    })
    if (ok) onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-text-primary">Nouveau client</h2>
          <button onClick={onClose}><X size={18} className="text-text-muted" /></button>
        </div>
        {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          {[
            { key: 'nom', label: 'Nom *' }, { key: 'telephone', label: 'Téléphone' },
            { key: 'email', label: 'Email' }, { key: 'matricule_fiscal', label: 'Matricule fiscal' },
            { key: 'credit_limite', label: 'Limite crédit (DT)' },
          ].map(f => (
            <div key={f.key} className="flex flex-col gap-1">
              <label className="text-xs font-medium text-text-secondary">{f.label}</label>
              <input value={form[f.key as keyof typeof form]} onChange={e => setForm(v => ({ ...v, [f.key]: e.target.value }))}
                className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/30" />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-secondary">Adresse</label>
          <input value={form.adresse} onChange={e => setForm(v => ({ ...v, adresse: e.target.value }))}
            className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/30" />
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-text-secondary border border-border rounded-lg">Annuler</button>
          <button type="button" onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm bg-accent-500 hover:bg-accent-400 text-black font-semibold rounded-lg disabled:opacity-50">
            {saving ? 'Enregistrement...' : 'Ajouter'}
          </button>
        </div>
      </div>
    </div>
  )
}

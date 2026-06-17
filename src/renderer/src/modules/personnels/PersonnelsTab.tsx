import { useState, useEffect, useCallback } from 'react'
import type { Personnel, MouvementPersonnel, TypeMouvementPersonnel } from '../../lib/types'
import { formatPrice, formatDate, generateId } from '../../lib/utils'
import { useAppStore } from '../../store/appStore'
import {
  Users2, Plus, RefreshCw, X, CheckCircle,
  Wallet, Clock, TrendingDown, TrendingUp, ChevronDown, ChevronUp,
  Banknote, Calendar, Printer
} from 'lucide-react'
import { runAction, loadData } from '../../lib/apiCall'
import { showToast } from '../../lib/toast'

import { wrapPrintHtml } from '../../lib/printHtml'
import { printLabelHtml } from '../../lib/nativePrint'

const api = window.api

function printFichePersonnel(p: Personnel) {
  const inner = `
  <h2 style="font-size:18px;margin:0 0 4px">${p.nom}${p.prenom ? ' ' + p.prenom : ''}</h2>
  <div style="color:#555;font-size:11px;margin-bottom:16px">${p.poste ?? 'Employé'} — Fiche générée le ${new Date().toLocaleDateString('fr-TN')}</div>
  <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee"><span style="color:#666">Poste</span><span style="font-weight:bold">${p.poste ?? '—'}</span></div>
  ${p.cin ? `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee"><span style="color:#666">CIN</span><span style="font-weight:bold">${p.cin}</span></div>` : ''}
  ${p.telephone ? `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee"><span style="color:#666">Téléphone</span><span style="font-weight:bold">${p.telephone}</span></div>` : ''}
  ${p.date_embauche ? `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee"><span style="color:#666">Date embauche</span><span style="font-weight:bold">${p.date_embauche}</span></div>` : ''}
  <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee"><span style="color:#666">Salaire base</span><span style="font-weight:bold">${p.salaire_base.toFixed(3)} DT</span></div>
  <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee"><span style="color:#666">Avance en cours</span><span style="font-weight:bold">${p.avance_solde.toFixed(3)} DT</span></div>
  <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee"><span style="color:#666">Crédit personnel</span><span style="font-weight:bold">${p.credit_solde.toFixed(3)} DT</span></div>
  ${p.notes ? `<div style="margin-top:12px"><b>Notes :</b> ${p.notes}</div>` : ''}`
  void printLabelHtml(wrapPrintHtml(inner, 'A4'))
}
import { cn } from '../../lib/utils'
import Fuse from 'fuse.js'

type SubTab = 'equipe' | 'mouvements' | 'ce_mois'

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'equipe',     label: 'Équipe' },
  { id: 'mouvements', label: 'Mouvements' },
  { id: 'ce_mois',    label: 'Ce mois' },
]

const TYPE_LABELS: Record<TypeMouvementPersonnel, string> = {
  SALAIRE:               'Salaire',
  AVANCE:                'Avance',
  AVANCE_REMBOURSEMENT:  'Rembours. avance',
  CREDIT_PERSONNEL:      'Crédit personnel',
  CREDIT_REMBOURSEMENT:  'Rembours. crédit',
}

const TYPE_COLORS: Record<TypeMouvementPersonnel, string> = {
  SALAIRE:               'bg-blue-100 text-blue-800',
  AVANCE:                'bg-orange-100 text-orange-800',
  AVANCE_REMBOURSEMENT:  'bg-green-100 text-green-800',
  CREDIT_PERSONNEL:      'bg-purple-100 text-purple-800',
  CREDIT_REMBOURSEMENT:  'bg-teal-100 text-teal-800',
}

function getCurrentMois() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function PersonnelsTab() {
  const { currentOperateur, currentShift } = useAppStore()
  const [subTab, setSubTab] = useState<SubTab>('equipe')
  const [personnels, setPersonnels] = useState<Personnel[]>([])
  const [mouvements, setMouvements] = useState<MouvementPersonnel[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [moisSalaire, setMoisSalaire] = useState(getCurrentMois())

  // Modals
  const [showAddPersonnel, setShowAddPersonnel] = useState(false)
  const [showMvt, setShowMvt] = useState<{ type: TypeMouvementPersonnel; personnel: Personnel } | null>(null)
  const [payTarget, setPayTarget] = useState<Personnel | null>(null)
  const [mvtTypeFilter, setMvtTypeFilter] = useState<string>('')

  const loadPersonnels = useCallback(async () => {
    const data = await loadData('Chargement personnels', async () => {
      const [p, m] = await Promise.all([
        api.personnelsList() as Promise<Personnel[]>,
        api.mouvementsPersonnelsList() as Promise<MouvementPersonnel[]>,
      ])
      return { p, m }
    }, { setLoading })
    if (data) {
      setPersonnels(data.p ?? [])
      setMouvements(data.m ?? [])
    }
  }, [])

  useEffect(() => { loadPersonnels() }, [loadPersonnels])

  const fuse = personnels.length ? new Fuse(personnels, { keys: ['nom', 'prenom', 'poste', 'cin'], threshold: 0.35 }) : null
  const filteredPersonnels = search.length >= 2 && fuse
    ? fuse.search(search).map(r => r.item)
    : personnels

  // Salaires sub-tab: check if already paid this month
  const salairesPaiesMois = new Set(
    mouvements.filter(m => m.type === 'SALAIRE' && m.mois === moisSalaire).map(m => m.personnel_id)
  )

  const filteredMvts = mouvements.filter(m => {
    if (mvtTypeFilter && m.type !== mvtTypeFilter) return false
    return true
  })

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-3 border-b border-border bg-white flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <Users2 size={18} className="text-accent-500" />
          <h1 className="text-base font-bold text-text-primary">Personnels</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadPersonnels} className="p-2 text-text-muted hover:text-text-primary rounded-lg hover:bg-muted">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          {subTab === 'equipe' && (
            <button
              onClick={() => setShowAddPersonnel(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-500 hover:bg-accent-400 text-black text-xs font-semibold rounded-lg"
            >
              <Plus size={13} /> Ajouter
            </button>
          )}
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-0 bg-white border-b border-border px-4 flex-shrink-0">
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={cn(
              'px-4 py-2.5 text-xs font-medium border-b-2 transition-all',
              subTab === t.id ? 'border-accent-500 text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-6">
        {/* ── Équipe ─────────────────────────────────────────────── */}
        {subTab === 'equipe' && (
          <div className="flex flex-col gap-4">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher nom, poste, CIN..."
              className="w-72 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/30"
            />
            {filteredPersonnels.length === 0 ? (
              <div className="text-center py-12 text-text-muted text-sm">Aucun personnel</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredPersonnels.map(p => (
                  <PersonnelCard
                    key={p.id}
                    personnel={p}
                    paidThisMonth={salairesPaiesMois.has(p.id)}
                    onMouvement={(type) => setShowMvt({ type, personnel: p })}
                    onPaySalary={() => {
                      if (salairesPaiesMois.has(p.id)) {
                        showToast('error', 'Salaire déjà payé ce mois')
                        return
                      }
                      setPayTarget(p)
                    }}
                    onRefresh={loadPersonnels}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Mouvements ──────────────────────────────────────────── */}
        {subTab === 'mouvements' && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={mvtTypeFilter}
                onChange={e => setMvtTypeFilter(e.target.value)}
                className="border border-border rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent-500/30"
              >
                <option value="">Tous les types</option>
                {(Object.keys(TYPE_LABELS) as TypeMouvementPersonnel[]).map(t => (
                  <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  if (personnels.length === 0) {
                    showToast('error', 'Ajoutez un employé d\'abord')
                    return
                  }
                  setShowMvt({ type: 'AVANCE', personnel: personnels[0] })
                }}
                className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-accent-500 hover:bg-accent-400 text-black text-xs font-semibold rounded-lg"
              >
                <Plus size={13} /> Nouveau mouvement
              </button>
            </div>
            <div className="bg-white rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted text-xs text-text-secondary">
                    <th className="text-left px-4 py-2.5">Date</th>
                    <th className="text-left px-4 py-2.5">Employé</th>
                    <th className="text-left px-4 py-2.5">Type</th>
                    <th className="text-right px-4 py-2.5">Montant</th>
                    <th className="text-left px-4 py-2.5">Note</th>
                    <th className="text-left px-4 py-2.5">Opérateur</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMvts.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-8 text-text-muted text-xs">Aucun mouvement</td></tr>
                  ) : filteredMvts.map(m => (
                    <tr key={m.id} className="border-t border-border hover:bg-muted/50">
                      <td className="px-4 py-3 text-text-secondary text-xs">{formatDate(m.created_at)}</td>
                      <td className="px-4 py-3 font-medium">{m.personnel_nom_full ?? m.personnel_id}</td>
                      <td className="px-4 py-3">
                        <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', TYPE_COLORS[m.type])}>
                          {TYPE_LABELS[m.type]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-price font-semibold">{formatPrice(m.montant)}</td>
                      <td className="px-4 py-3 text-xs text-text-secondary">{m.note ?? '—'}</td>
                      <td className="px-4 py-3 text-xs text-text-secondary">{m.operateur ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Ce mois (salaires) ─────────────────────────────────── */}
        {subTab === 'ce_mois' && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <label className="text-xs text-text-secondary font-medium">Mois :</label>
              <input
                type="month"
                value={moisSalaire}
                onChange={e => setMoisSalaire(e.target.value)}
                className="border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/30"
              />
            </div>
            <div className="bg-white rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted text-xs text-text-secondary">
                    <th className="text-left px-4 py-2.5">Employé</th>
                    <th className="text-left px-4 py-2.5">Poste</th>
                    <th className="text-right px-4 py-2.5">Salaire base</th>
                    <th className="text-right px-4 py-2.5">Avance déduite</th>
                    <th className="text-right px-4 py-2.5">Net à payer</th>
                    <th className="text-center px-4 py-2.5">Statut</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {personnels.map(p => {
                    const paid = salairesPaiesMois.has(p.id)
                    const net = p.salaire_base - (p.avance_solde > p.salaire_base ? p.salaire_base : p.avance_solde)
                    return (
                      <tr key={p.id} className="border-t border-border hover:bg-muted/50">
                        <td className="px-4 py-3 font-medium">{p.nom} {p.prenom ?? ''}</td>
                        <td className="px-4 py-3 text-text-secondary">{p.poste ?? '—'}</td>
                        <td className="px-4 py-3 text-right font-price">{formatPrice(p.salaire_base)}</td>
                        <td className="px-4 py-3 text-right text-orange-600 font-price">{p.avance_solde > 0 ? `- ${formatPrice(Math.min(p.avance_solde, p.salaire_base))}` : '—'}</td>
                        <td className="px-4 py-3 text-right font-bold font-price">{formatPrice(Math.max(0, net))}</td>
                        <td className="px-4 py-3 text-center">
                          {paid
                            ? <span className="inline-flex items-center gap-1 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full"><CheckCircle size={11} /> Payé</span>
                            : <span className="text-xs text-text-muted">En attente</span>
                          }
                        </td>
                        <td className="px-4 py-3 text-right">
                          {!paid && (
                            <button
                              type="button"
                              onClick={() => setPayTarget(p)}
                              className="px-3 py-1.5 bg-accent-500 hover:bg-accent-400 text-black text-xs font-semibold rounded-lg"
                            >
                              Payer
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Add Personnel Modal */}
      {showAddPersonnel && (
        <AddPersonnelModal
          onClose={() => setShowAddPersonnel(false)}
          onSaved={() => { setShowAddPersonnel(false); loadPersonnels() }}
        />
      )}

      {/* Mouvement Modal */}
      {showMvt && (
        <MouvementModal
          personnels={personnels}
          initialType={showMvt.type}
          initialPersonnel={showMvt.personnel}
          operateur={currentOperateur?.nom ?? ''}
          onClose={() => setShowMvt(null)}
          onSaved={() => { setShowMvt(null); loadPersonnels() }}
        />
      )}

      {payTarget && (
        <PaySalaryModal
          personnel={payTarget}
          mois={moisSalaire}
          operateur={currentOperateur?.nom ?? ''}
          onClose={() => setPayTarget(null)}
          onSaved={() => { setPayTarget(null); loadPersonnels() }}
        />
      )}
    </div>
  )
}

// ── Personnel Card ────────────────────────────────────────────────────────────
function PersonnelCard({ personnel: p, paidThisMonth, onMouvement, onPaySalary, onRefresh }: {
  personnel: Personnel
  paidThisMonth: boolean
  onMouvement: (type: TypeMouvementPersonnel) => void
  onPaySalary: () => void
  onRefresh: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-white rounded-xl border border-border p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-semibold text-text-primary">{p.nom} {p.prenom ?? ''}</p>
          <p className="text-xs text-text-muted">{p.poste ?? '—'}</p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => printFichePersonnel(p)} title="Imprimer fiche" className="p-1.5 text-text-muted hover:text-text-primary hover:bg-muted rounded-lg transition-colors">
            <Printer size={13} />
          </button>
          <button onClick={() => setOpen(!open)} className="text-text-muted hover:text-text-primary">
            {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-muted rounded-lg p-2">
          <p className="text-text-muted">Salaire base</p>
          <p className="font-price font-bold text-text-primary">{formatPrice(p.salaire_base)}</p>
        </div>
        <div className="bg-muted rounded-lg p-2">
          <p className="text-text-muted">Avance en cours</p>
          <p className="font-price font-bold text-orange-600">{formatPrice(p.avance_solde)}</p>
        </div>
        <div className="bg-muted rounded-lg p-2">
          <p className="text-text-muted">Crédit personnel</p>
          <p className="font-price font-bold text-purple-600">{formatPrice(p.credit_solde)}</p>
        </div>
        <div className="bg-muted rounded-lg p-2">
          <p className="text-text-muted">Total dû</p>
          <p className="font-price font-bold text-red-600">{formatPrice(p.avance_solde + p.credit_solde)}</p>
        </div>
      </div>
      {open && (
        <div className="flex flex-wrap gap-1.5 pt-1 border-t border-border">
          {!paidThisMonth && (
            <button
              type="button"
              onClick={onPaySalary}
              className="text-xs px-2 py-1 rounded-lg font-semibold bg-accent-500 text-black flex items-center gap-1"
            >
              <Banknote size={11} /> Payer salaire
            </button>
          )}
          {(['AVANCE', 'AVANCE_REMBOURSEMENT', 'CREDIT_PERSONNEL', 'CREDIT_REMBOURSEMENT'] as TypeMouvementPersonnel[]).map(type => (
            <button
              key={type}
              onClick={() => onMouvement(type)}
              className={cn('text-xs px-2 py-1 rounded-lg font-medium', TYPE_COLORS[type])}
            >
              {TYPE_LABELS[type]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Add Personnel Modal ───────────────────────────────────────────────────────
function AddPersonnelModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ nom: '', prenom: '', poste: '', telephone: '', cin: '', date_embauche: '', salaire_base: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    if (!form.nom.trim()) { setError('Nom requis'); return }
    if (!form.salaire_base || isNaN(parseFloat(form.salaire_base))) { setError('Salaire base requis'); return }
    setError('')
    const ok = await runAction('Enregistrement personnel', async () => {
      const now = new Date().toISOString()
      await api.personnelsCreate({
        id: generateId(), ...form,
        salaire_base: parseFloat(form.salaire_base),
        cin: form.cin || null,
        prenom: form.prenom || null,
        poste: form.poste || null,
        telephone: form.telephone || null,
        date_embauche: form.date_embauche || null,
        notes: form.notes || null,
        created_at: now, updated_at: now,
      })
    }, {
      setSaving,
      successMessage: 'Personnel ajouté',
      onError: msg => setError(msg.replace(/^Enregistrement personnel : /, '')),
    })
    if (ok) onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-text-primary">Ajouter un employé</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary"><X size={18} /></button>
        </div>
        {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          {[
            { key: 'nom', label: 'Nom *', placeholder: 'Nom' },
            { key: 'prenom', label: 'Prénom', placeholder: 'Prénom' },
            { key: 'poste', label: 'Poste', placeholder: 'Technicien, Caissier...' },
            { key: 'telephone', label: 'Téléphone', placeholder: '+216...' },
            { key: 'cin', label: 'CIN', placeholder: '0....' },
            { key: 'salaire_base', label: 'Salaire base (DT) *', placeholder: '1000.000' },
          ].map(f => (
            <div key={f.key} className="flex flex-col gap-1">
              <label className="text-xs font-medium text-text-secondary">{f.label}</label>
              <input
                value={form[f.key as keyof typeof form]}
                onChange={e => setForm(v => ({ ...v, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/30"
              />
            </div>
          ))}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-secondary">Date embauche</label>
            <input
              type="date"
              value={form.date_embauche}
              onChange={e => setForm(v => ({ ...v, date_embauche: e.target.value }))}
              className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/30"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-secondary">Notes</label>
          <textarea
            value={form.notes}
            onChange={e => setForm(v => ({ ...v, notes: e.target.value }))}
            rows={2}
            className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/30 resize-none"
          />
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary border border-border rounded-lg">Annuler</button>
          <button type="button" onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm bg-accent-500 hover:bg-accent-400 text-black font-semibold rounded-lg disabled:opacity-50">
            {saving ? 'Enregistrement...' : 'Ajouter'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Mouvement Modal ───────────────────────────────────────────────────────────
function MouvementModal({ personnels, initialType, initialPersonnel, operateur, onClose, onSaved }: {
  personnels: Personnel[]
  initialType: TypeMouvementPersonnel
  initialPersonnel: Personnel
  operateur: string
  onClose: () => void
  onSaved: () => void
}) {
  const [selectedId, setSelectedId] = useState(initialPersonnel.id)
  const [type, setType] = useState<TypeMouvementPersonnel>(initialType)
  const [montant, setMontant] = useState('')
  const [note, setNote] = useState('')
  const [mois, setMois] = useState(getCurrentMois())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    const m = parseFloat(montant)
    if (isNaN(m) || m <= 0) { setError('Montant invalide'); return }
    setError('')
    const ok = await runAction('Enregistrement mouvement', async () => {
      await api.mouvementsPersonnelsCreate({
        id: generateId(), personnel_id: selectedId, type, montant: m,
        mois: type === 'SALAIRE' ? mois : null, note: note || null, operateur,
        created_at: new Date().toISOString(),
      })
    }, {
      setSaving,
      successMessage: 'Mouvement enregistré',
      onError: msg => setError(msg.replace(/^Enregistrement mouvement : /, '')),
    })
    if (ok) onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-text-primary">{TYPE_LABELS[type]}</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary"><X size={18} /></button>
        </div>
        {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-secondary">Employé</label>
            <select
              value={selectedId}
              onChange={e => setSelectedId(e.target.value)}
              className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none"
            >
              {personnels.map(p => (
                <option key={p.id} value={p.id}>{p.nom} {p.prenom ?? ''}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-secondary">Type</label>
            <select
              value={type}
              onChange={e => setType(e.target.value as TypeMouvementPersonnel)}
              className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none"
            >
              {Object.entries(TYPE_LABELS).filter(([k]) => k !== 'SALAIRE').map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          {type === 'SALAIRE' && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-text-secondary">Mois</label>
              <input type="month" value={mois} onChange={e => setMois(e.target.value)}
                className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none" />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-secondary">Montant (DT)</label>
            <input value={montant} onChange={e => setMontant(e.target.value)} placeholder="0.000"
              className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/30 font-price" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-secondary">Note</label>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Optionnel..."
              className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/30" />
          </div>
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-text-secondary border border-border rounded-lg">Annuler</button>
          <button type="button" onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm bg-accent-500 hover:bg-accent-400 text-black font-semibold rounded-lg disabled:opacity-50">
            {saving ? 'Enregistrement...' : 'Confirmer'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Pay Salary Modal ──────────────────────────────────────────────────────────
function PaySalaryModal({ personnel: p, mois, operateur, onClose, onSaved }: {
  personnel: Personnel
  mois: string
  operateur: string
  onClose: () => void
  onSaved: () => void
}) {
  const maxAvance = Math.min(p.avance_solde, p.salaire_base)
  const [avanceDeduction, setAvanceDeduction] = useState(String(maxAvance > 0 ? maxAvance.toFixed(3) : '0'))
  const [creditDeduction, setCreditDeduction] = useState('0')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const avance = Math.max(0, Math.min(parseFloat(avanceDeduction) || 0, p.avance_solde, p.salaire_base))
  const credit = Math.max(0, Math.min(parseFloat(creditDeduction) || 0, p.credit_solde))
  const net = Math.max(0, p.salaire_base - avance - credit)

  const handleConfirm = async () => {
    if (avance + credit > p.salaire_base) {
      setError('Les déductions dépassent le salaire brut')
      return
    }
    if (net <= 0 && p.salaire_base > 0) {
      setError('Le net à payer doit être supérieur à 0')
      return
    }
    setError('')
    const now = new Date().toISOString()
    const ok = await runAction('Paiement salaire', async () => {
      if (avance > 0) {
        await api.mouvementsPersonnelsCreate({
          id: generateId(), personnel_id: p.id, type: 'AVANCE_REMBOURSEMENT', montant: avance,
          mois: null, note: `Déduction avance — salaire ${mois}`, operateur, created_at: now,
        })
      }
      if (credit > 0) {
        await api.mouvementsPersonnelsCreate({
          id: generateId(), personnel_id: p.id, type: 'CREDIT_REMBOURSEMENT', montant: credit,
          mois: null, note: `Déduction crédit — salaire ${mois}`, operateur, created_at: now,
        })
      }
      await api.mouvementsPersonnelsCreate({
        id: generateId(), personnel_id: p.id, type: 'SALAIRE', montant: net,
        mois, note: `Salaire ${mois} (net)`, operateur, created_at: now,
      })
    }, {
      setSaving,
      successMessage: `Salaire ${formatPrice(net)} payé à ${p.nom}`,
      onError: msg => setError(msg.replace(/^Paiement salaire : /, '')),
    })
    if (ok) onSaved()
  }

  return (
    <div className="fixed inset-0 z-[130] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-bold text-text-primary">Payer le salaire</h2>
            <p className="text-xs text-text-muted">{p.nom} {p.prenom ?? ''} · {mois}</p>
          </div>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary"><X size={18} /></button>
        </div>
        {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        <div className="space-y-3 text-sm">
          <div className="flex justify-between py-2 border-b border-border">
            <span className="text-text-secondary">Salaire brut</span>
            <span className="font-price font-bold">{formatPrice(p.salaire_base)}</span>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Avance à déduire <span className="text-text-muted">(max {formatPrice(maxAvance)})</span>
            </label>
            <input
              type="number"
              step="0.001"
              min={0}
              max={maxAvance}
              value={avanceDeduction}
              onChange={e => setAvanceDeduction(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg text-sm font-price focus:outline-none focus:ring-2 focus:ring-accent-500/30"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Crédit à déduire <span className="text-text-muted">(max {formatPrice(p.credit_solde)})</span>
            </label>
            <input
              type="number"
              step="0.001"
              min={0}
              max={p.credit_solde}
              value={creditDeduction}
              onChange={e => setCreditDeduction(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg text-sm font-price focus:outline-none focus:ring-2 focus:ring-accent-500/30"
            />
          </div>
          <div className="flex justify-between py-3 border-t-2 border-border bg-muted rounded-lg px-3">
            <span className="font-semibold">Net à payer</span>
            <span className="font-price font-bold text-lg text-accent-600">{formatPrice(net)}</span>
          </div>
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-text-secondary border border-border rounded-lg">Annuler</button>
          <button type="button" onClick={handleConfirm} disabled={saving} className="px-4 py-2 text-sm bg-accent-500 hover:bg-accent-400 text-black font-semibold rounded-lg disabled:opacity-50 flex items-center gap-1.5">
            <Banknote size={14} />
            {saving ? 'Paiement...' : 'Confirmer paiement'}
          </button>
        </div>
      </div>
    </div>
  )
}

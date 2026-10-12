import { useEffect, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { generateId } from '../lib/utils'
import { runAction } from '../lib/apiCall'
import type { Operateur, Shift } from '../lib/types'
import { Wallet, Play, AlertCircle, KeyRound, Eye, Sun, Moon, CheckCircle2, Lock } from 'lucide-react'
import logoUrl from '../assets/logo.svg'

const api = window.api

export default function ShiftModal() {
  const { operateurs, setCurrentShift, setCurrentOperateur, setShowShiftModal, setPreviewMode } = useAppStore()
  const [selectedOp, setSelectedOp] = useState<Operateur | null>(null)
  const [fondCaisse, setFondCaisse] = useState('100.000')
  const [pin, setPin] = useState('')
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [alert, setAlert] = useState('')
  const [dayStatus, setDayStatus] = useState<{ openedCount: number; morningDone: boolean; eveningDone: boolean; nextSession: 'MATIN' | 'SOIR' | null; canOpen: boolean; staleOpen?: Shift | null } | null>(null)
  const [resumeStale, setResumeStale] = useState(false)

  const fondValue = parseFloat(fondCaisse.replace(',', '.')) || 0

  useEffect(() => {
    Promise.all([api.settingsGetAll(), api.shiftsGetTodayStatus()])
      .then(([s, status]) => {
        setSettings((s ?? {}) as Record<string, string>)
        setDayStatus(status)
      })
      .catch(() => setSettings({}))
  }, [])

  const handleStart = async () => {
    if (!selectedOp) return
    const expectedPin = settings[`pin_${selectedOp.identifiant.toLowerCase()}`] ?? 'sml2023'
    if (pin !== expectedPin) {
      setAlert('PIN opérateur incorrect.')
      return
    }
    if (fondValue < 0) { setAlert('Le fond de caisse ne peut pas être négatif.'); return }
    if (fondValue < 10) setAlert('Attention : fond de caisse inhabituellement bas.')
    else if (fondValue > 500) setAlert('Attention : fond de caisse inhabituellement élevé.')
    else setAlert('')

    if (resumeStale && dayStatus?.staleOpen) {
      if (selectedOp.id !== dayStatus.staleOpen.operateur_id && selectedOp.nom !== dayStatus.staleOpen.operateur_nom) {
        setAlert(`Sélectionnez ${dayStatus.staleOpen.operateur_nom} pour reprendre cette caisse.`)
        return
      }
      setCurrentShift(dayStatus.staleOpen)
      setCurrentOperateur(selectedOp)
      setPreviewMode(false)
      setShowShiftModal(false)
      return
    }

    await runAction('Ouverture de caisse', async () => {
      const shift = {
        id: generateId(),
        operateur_id: selectedOp.id,
        operateur_nom: selectedOp.nom,
        fond_de_caisse: fondValue,
        started_at: new Date().toISOString(),
      }
      const opened = await api.shiftsOpen(shift) as typeof shift & { session_type?: 'MATIN' | 'SOIR' }
      setCurrentShift(opened)
      setCurrentOperateur(selectedOp)
      setPreviewMode(false)
      setShowShiftModal(false)
    }, {
      setLoading,
      successMessage: `Shift ouvert — ${selectedOp.nom}`,
      onError: (message) => setAlert(message),
    })
  }

  const enterPreview = () => {
    setCurrentShift(null)
    setCurrentOperateur(null)
    setPreviewMode(true)
    setShowShiftModal(false)
  }

  const avatarColors: Record<string, string> = {
    'hamdi': 'bg-blue-100 text-blue-700',
    'hamma': 'bg-green-100 text-green-700',
    'amira': 'bg-purple-100 text-purple-700',
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-[520px] max-h-[calc(100vh-2rem)] overflow-y-auto p-8 animate-slide-in">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-12 h-12 rounded-xl overflow-hidden flex items-center justify-center">
            <img src={logoUrl} alt="SML POS" className="w-12 h-12 object-contain" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-text-primary">Démarrage de Caisse</h1>
            <p className="text-sm text-text-secondary">SMLPOS — Qui prend la caisse ?</p>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3">
          <div className={`rounded-xl border p-3 ${dayStatus?.morningDone ? 'border-emerald-200 bg-emerald-50' : dayStatus?.nextSession === 'MATIN' ? 'border-amber-300 bg-amber-50' : 'border-border bg-muted'}`}>
            <div className="flex items-center gap-2 text-sm font-bold"><Sun size={15} className="text-amber-600"/> Caisse matin {dayStatus?.morningDone && <CheckCircle2 size={14} className="ml-auto text-emerald-600"/>}</div>
            <p className="mt-1 text-[11px] text-text-secondary">{dayStatus?.morningDone ? 'Terminée aujourd’hui' : dayStatus?.nextSession === 'MATIN' ? 'Prochaine ouverture' : 'Non disponible'}</p>
          </div>
          <div className={`rounded-xl border p-3 ${dayStatus?.eveningDone ? 'border-emerald-200 bg-emerald-50' : dayStatus?.nextSession === 'SOIR' ? 'border-indigo-300 bg-indigo-50' : 'border-border bg-muted'}`}>
            <div className="flex items-center gap-2 text-sm font-bold"><Moon size={15} className="text-indigo-600"/> Caisse soir {dayStatus?.eveningDone && <CheckCircle2 size={14} className="ml-auto text-emerald-600"/>}</div>
            <p className="mt-1 text-[11px] text-text-secondary">{dayStatus?.eveningDone ? 'Terminée aujourd’hui' : dayStatus?.nextSession === 'SOIR' ? 'Prochaine ouverture' : dayStatus?.nextSession === 'MATIN' ? 'Après la caisse matin' : 'Non disponible'}</p>
          </div>
        </div>

        {dayStatus?.staleOpen && (
          <div className="mb-6 rounded-xl border border-orange-300 bg-orange-50 p-3 text-xs text-orange-950">
            <div className="flex items-start gap-2"><AlertCircle size={15} className="mt-0.5 shrink-0 text-orange-700"/><div className="flex-1"><b>Caisse précédente non clôturée — données conservées</b><p className="mt-1">{dayStatus.staleOpen.operateur_nom} · ouverte le {new Date(dayStatus.staleOpen.started_at).toLocaleString('fr-TN')}. Les transactions ne sont pas supprimées.</p></div></div>
            <button type="button" onClick={() => { const op = operateurs.find(item => item.id === dayStatus.staleOpen?.operateur_id || item.nom === dayStatus.staleOpen?.operateur_nom) || null; setSelectedOp(op); setPin(''); setResumeStale(true); setAlert('Saisissez le PIN de cet opérateur pour reprendre puis clôturer la caisse précédente.') }} className="mt-3 w-full rounded-lg border border-orange-300 bg-white px-3 py-2 font-bold text-orange-900 hover:bg-orange-100">Reprendre cette caisse pour la clôturer</button>
          </div>
        )}

        {dayStatus && !dayStatus.canOpen && (
          <div className="mb-6 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
            <Lock size={15} className="mt-0.5 flex-shrink-0"/>
            <span>Les deux ouvertures autorisées aujourd’hui sont terminées. Une nouvelle caisse sera disponible demain.</span>
          </div>
        )}

        {/* Operator selection */}
        <div className="mb-6">
          <label className="block text-sm font-semibold text-text-primary mb-3">Opérateur</label>
          <div className="grid grid-cols-3 gap-3">
            {operateurs.map(op => (
              <button
                key={op.id}
                onClick={() => { setSelectedOp(op); setPin(''); setResumeStale(false); setAlert('') }}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                  selectedOp?.id === op.id
                    ? 'border-accent-500 bg-accent-50'
                    : 'border-border bg-white hover:bg-muted hover:border-accent-200'
                }`}
              >
                <div className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold ${avatarColors[op.identifiant] || 'bg-gray-100 text-gray-700'}`}>
                  {op.nom.charAt(0)}
                </div>
                <span className="text-sm font-semibold">{op.nom}</span>
                {false && op.role === 'superadmin' && (
                  <span className="text-xs text-purple-600 font-medium">★</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Operator PIN */}
        {selectedOp && (
          <div className="mb-6">
            <label className="block text-sm font-semibold text-text-primary mb-2">PIN opérateur</label>
            <div className="flex items-center gap-2 bg-muted rounded-xl px-4 py-3 border border-border focus-within:border-accent-500 focus-within:bg-accent-50 transition-colors">
              <KeyRound size={18} className="text-text-secondary" />
              <input
                type="password"
                value={pin}
                onChange={e => setPin(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleStart() }}
                className="flex-1 bg-transparent font-mono text-lg tracking-widest font-semibold outline-none"
                placeholder="PIN"
                autoFocus
              />
            </div>
          </div>
        )}

        {/* Fond de caisse */}
        <div className="mb-6">
          <label className="block text-sm font-semibold text-text-primary mb-2">Fond de Caisse Initial</label>
          <div className="flex items-center gap-2 bg-muted rounded-xl px-4 py-3 border border-border focus-within:border-accent-500 focus-within:bg-accent-50 transition-colors">
            <Wallet size={18} className="text-text-secondary" />
            <input
              type="text"
              inputMode="decimal"
              value={fondCaisse}
              onChange={e => setFondCaisse(e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.'))}
              className="flex-1 bg-transparent font-price text-lg font-semibold outline-none"
              placeholder="0.000"
            />
            <span className="text-text-secondary font-medium">DT</span>
          </div>
        </div>

        {/* Alert */}
        {alert && (
          <div className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg mb-4 text-sm text-yellow-800">
            <AlertCircle size={14} />
            {alert}
          </div>
        )}

        {/* Start button */}
        <button
          type="button"
          onClick={handleStart}
          disabled={!selectedOp || !pin || loading}
          style={{ display: dayStatus?.canOpen === false ? 'none' : undefined }}
          className="w-full flex items-center justify-center gap-2 bg-accent-500 hover:bg-accent-600 disabled:bg-gray-200 disabled:text-gray-400 text-text-primary font-bold py-3.5 rounded-xl transition-colors text-base"
        >
          <Play size={18} />
          {loading ? 'Démarrage...' : resumeStale ? 'Reprendre la caisse précédente' : `Ouvrir la caisse ${dayStatus?.nextSession === 'SOIR' ? 'soir' : 'matin'}`}
        </button>

        <button
          type="button"
          onClick={enterPreview}
          className="mt-3 w-full flex items-center justify-center gap-2 border border-border bg-white hover:bg-muted text-text-primary font-bold py-3 rounded-xl transition-colors text-sm"
        >
          <Eye size={17}/>
          Entrer en mode aperçu (lecture seule)
        </button>
        <p className="mt-2 text-center text-[10px] text-text-muted">Navigation autorisée, aucune création ni modification possible.</p>
      </div>
    </div>
  )
}

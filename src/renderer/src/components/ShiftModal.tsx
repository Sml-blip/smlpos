import { useEffect, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { generateId } from '../lib/utils'
import { runAction } from '../lib/apiCall'
import type { Operateur } from '../lib/types'
import { Wallet, Play, AlertCircle, KeyRound } from 'lucide-react'
import logoUrl from '../assets/logo.svg'

const api = window.api

export default function ShiftModal() {
  const { operateurs, setCurrentShift, setCurrentOperateur, setShowShiftModal } = useAppStore()
  const [selectedOp, setSelectedOp] = useState<Operateur | null>(null)
  const [fondCaisse, setFondCaisse] = useState('100.000')
  const [pin, setPin] = useState('')
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [alert, setAlert] = useState('')

  const fondValue = parseFloat(fondCaisse.replace(',', '.')) || 0

  useEffect(() => {
    api.settingsGetAll()
      .then((s) => setSettings((s ?? {}) as Record<string, string>))
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

    await runAction('Ouverture de caisse', async () => {
      const shift = {
        id: generateId(),
        operateur_id: selectedOp.id,
        operateur_nom: selectedOp.nom,
        fond_de_caisse: fondValue,
        started_at: new Date().toISOString(),
      }
      await api.shiftsOpen(shift)
      setCurrentShift(shift)
      setCurrentOperateur(selectedOp)
      setShowShiftModal(false)
    }, {
      setLoading,
      successMessage: `Shift ouvert — ${selectedOp.nom}`,
      onError: () => setAlert('Erreur lors du démarrage du shift.'),
    })
  }

  const avatarColors: Record<string, string> = {
    'hamdi': 'bg-blue-100 text-blue-700',
    'hamma': 'bg-green-100 text-green-700',
    'amira': 'bg-purple-100 text-purple-700',
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-[480px] p-8 animate-slide-in">
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

        {/* Operator selection */}
        <div className="mb-6">
          <label className="block text-sm font-semibold text-text-primary mb-3">Opérateur</label>
          <div className="grid grid-cols-3 gap-3">
            {operateurs.map(op => (
              <button
                key={op.id}
                onClick={() => { setSelectedOp(op); setPin(''); setAlert('') }}
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
          className="w-full flex items-center justify-center gap-2 bg-accent-500 hover:bg-accent-600 disabled:bg-gray-200 disabled:text-gray-400 text-text-primary font-bold py-3.5 rounded-xl transition-colors text-base"
        >
          <Play size={18} />
          {loading ? 'Démarrage...' : 'Démarrer le Shift'}
        </button>
      </div>
    </div>
  )
}

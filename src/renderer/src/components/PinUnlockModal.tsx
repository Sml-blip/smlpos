import { useState } from 'react'
import { Lock, X, RefreshCw } from 'lucide-react'
import { runAction } from '../lib/apiCall'

const api = window.api

interface Props {
  title?: string
  onUnlocked: () => void
  onCancel: () => void
}

export default function PinUnlockModal({ title = 'Accès protégé', onUnlocked, onCancel }: Props) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    if (!pin.trim()) { setError('PIN requis'); return }
    await runAction('Vérification PIN', async () => {
      const res = await api.authVerifyCaissePin(pin.trim()) as { valid?: boolean }
      if (!res?.valid) { setError('PIN incorrect'); return }
      onUnlocked()
    }, { setLoading, silent: true, onError: setError })
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[150] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm animate-slide-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="font-bold text-sm flex items-center gap-2">
            <Lock size={14} className="text-accent-500" /> {title}
          </h3>
          <button type="button" onClick={onCancel}><X size={16} className="text-text-muted" /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-xs text-text-secondary">Entrez le PIN Caisse interne pour continuer.</p>
          <input
            type="password"
            value={pin}
            onChange={e => { setPin(e.target.value); setError('') }}
            onKeyDown={e => e.key === 'Enter' && void handleSubmit()}
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-accent-500"
            placeholder="PIN"
            autoFocus
          />
          {error && <p className="text-xs text-danger font-semibold">{error}</p>}
        </div>
        <div className="flex gap-3 px-5 py-4 border-t border-border">
          <button type="button" onClick={onCancel} className="flex-1 bg-muted hover:bg-border font-semibold py-2.5 rounded-xl text-sm">Annuler</button>
          <button type="button" onClick={() => void handleSubmit()} disabled={loading}
            className="flex-1 bg-accent-500 hover:bg-accent-600 disabled:bg-gray-200 text-text-primary font-bold py-2.5 rounded-xl text-sm flex items-center justify-center gap-2">
            {loading ? <RefreshCw size={14} className="animate-spin" /> : <Lock size={14} />}
            Déverrouiller
          </button>
        </div>
      </div>
    </div>
  )
}

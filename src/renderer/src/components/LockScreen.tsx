import { useState, useEffect, useRef } from 'react'
import { Lock, AlertCircle } from 'lucide-react'
import logoUrl from '../assets/logo.svg'

interface Props {
  operateurNom: string
  pin: string
  onUnlock: () => void
}

export default function LockScreen({ operateurNom, pin, onUnlock }: Props) {
  const [input, setInput] = useState('')
  const [error, setError] = useState(false)
  const [shake, setShake] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = () => {
    if (input === pin) {
      onUnlock()
    } else {
      setError(true)
      setShake(true)
      setInput('')
      setTimeout(() => setShake(false), 500)
    }
  }

  return (
    <div className="fixed inset-0 z-[9998] bg-black/80 backdrop-blur-md flex items-center justify-center">
      <div className={`bg-white rounded-2xl shadow-2xl p-8 w-80 flex flex-col items-center gap-5 ${shake ? 'animate-shake' : ''}`}>
        <img src={logoUrl} className="w-14 h-14 object-contain" />
        <div className="flex flex-col items-center gap-1">
          <Lock size={20} className="text-accent-500" />
          <p className="text-sm font-semibold text-text-primary">Session verrouillée</p>
          <p className="text-xs text-text-muted">{operateurNom}</p>
        </div>
        <div className="w-full">
          <input
            ref={inputRef}
            type="password"
            value={input}
            onChange={e => { setInput(e.target.value); setError(false) }}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            placeholder="Entrer PIN..."
            className="w-full px-4 py-2.5 border border-border rounded-xl text-center text-lg tracking-widest font-mono focus:outline-none focus:ring-2 focus:ring-accent-500/30"
            autoComplete="off"
          />
          {error && (
            <p className="flex items-center gap-1 text-xs text-red-600 mt-1.5 justify-center">
              <AlertCircle size={12} /> PIN incorrect
            </p>
          )}
        </div>
        <button
          onClick={handleSubmit}
          className="w-full bg-accent-500 hover:bg-accent-400 text-black font-semibold py-2.5 rounded-xl transition-colors"
        >
          Déverrouiller
        </button>
      </div>
    </div>
  )
}

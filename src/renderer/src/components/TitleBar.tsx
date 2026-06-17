import { Minus, Square, X, Bell, Package, Clock } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import logoUrl from '../assets/logo.svg'
import { useState, useEffect, useRef } from 'react'

const api = window.api

interface BLPending {
  id: string
  numero_facture: string
  fournisseur_nom: string
  montant_ttc: number
  created_at: string
  jours_attente: number
}

export default function TitleBar() {
  const { currentShift } = useAppStore()
  const now = new Date()
  const dateStr = format(now, "HH:mm '—' EEE dd MMM", { locale: fr })
  const [blCount, setBlCount] = useState(0)
  const [blList, setBlList] = useState<BLPending[]>([])
  const [showBL, setShowBL] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const load = () => {
      api.facturesCountBLPending().then((n: unknown) => setBlCount(Number(n) || 0)).catch(() => {})
    }
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!showBL) return
    api.facturesListBLPending().then((list: unknown) => setBlList((list as BLPending[]) || [])).catch(() => {})
  }, [showBL])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setShowBL(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="h-[38px] flex items-center bg-accent-500 text-text-primary flex-shrink-0 select-none">
      {/* Drag region */}
      <div className="drag-region flex-1 flex items-center gap-3 px-4 h-full">
        <div className="flex items-center gap-2">
          <img src={logoUrl} alt="SML POS" className="h-6 w-6 rounded-md" />
          <span className="font-black text-sm tracking-wide">SMLPOS</span>
        </div>

        {currentShift && (
          <>
            <span className="text-text-primary/40">|</span>
            <span className="text-sm font-medium">{currentShift.operateur_nom}</span>
          </>
        )}

        <div className="ml-auto text-sm font-medium capitalize">{dateStr}</div>
      </div>

      {/* BL notification bell */}
      <div ref={dropdownRef} className="relative flex items-center h-full px-1">
        <button
          onClick={() => setShowBL(v => !v)}
          className="relative w-[38px] h-full flex items-center justify-center hover:bg-black/10 transition-colors"
        >
          <Bell size={14} />
          {blCount > 0 && (
            <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-red-500 rounded-full text-[9px] font-bold text-white flex items-center justify-center leading-none">
              {blCount > 9 ? '9+' : blCount}
            </span>
          )}
        </button>
        {showBL && (
          <div className="absolute top-full right-0 w-72 bg-white border border-border rounded-xl shadow-2xl z-50 overflow-hidden select-text">
            <div className="px-3 py-2 border-b border-border bg-orange-50 flex items-center gap-2">
              <Package size={13} className="text-orange-600" />
              <span className="text-xs font-bold text-orange-800">
                {blCount === 0 ? 'Aucun BL en attente' : `${blCount} BL en attente de réception`}
              </span>
            </div>
            {blList.length === 0 && blCount === 0 && (
              <div className="px-3 py-4 text-xs text-center text-text-muted">Tout est à jour ✓</div>
            )}
            <div className="max-h-64 overflow-y-auto">
              {blList.map(bl => (
                <div key={bl.id} className="px-3 py-2.5 border-b border-border last:border-0 hover:bg-muted">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-mono font-semibold text-xs">{bl.numero_facture}</div>
                      <div className="text-[10px] text-text-muted">{bl.fournisseur_nom}</div>
                    </div>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5 ${
                      bl.jours_attente > 30 ? 'bg-red-100 text-red-700' :
                      bl.jours_attente > 7  ? 'bg-orange-100 text-orange-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>
                      <Clock size={9} /> {bl.jours_attente}j
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Window controls */}
      <div className="flex items-center h-full">
        <button
          onClick={() => api.windowMinimize()}
          className="w-[46px] h-full flex items-center justify-center hover:bg-black/10 transition-colors"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={() => api.windowMaximize()}
          className="w-[46px] h-full flex items-center justify-center hover:bg-black/10 transition-colors"
        >
          <Square size={12} />
        </button>
        <button
          onClick={() => api.windowClose()}
          className="w-[46px] h-full flex items-center justify-center hover:bg-red-500 hover:text-white transition-colors"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}

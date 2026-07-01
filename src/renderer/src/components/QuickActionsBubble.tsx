import { useEffect, useRef, useState } from 'react'
import {
  ShoppingCart, Package, FolderOpen, History, LogOut, Vault, X, Zap,
} from 'lucide-react'
import { cn } from '../lib/utils'
import { useAppStore, type TabId } from '../store/appStore'
import logoUrl from '../assets/logo.svg'

type QuickAction = {
  id: string
  label: string
  short: string
  icon: React.ReactNode
  accent?: string
  run: () => void
}

const EDGE_KEY = 'smlpos-quick-bubble-edge'

export default function QuickActionsBubble({
  hidden,
}: {
  hidden?: boolean
}) {
  const { activeTab, setActiveTab, currentShift, setShowShiftModal } = useAppStore()
  const [open, setOpen] = useState(false)
  const [edge, setEdge] = useState<'right' | 'left'>(() => {
    try {
      return localStorage.getItem(EDGE_KEY) === 'left' ? 'left' : 'right'
    } catch {
      return 'right'
    }
  })
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const goTab = (tab: TabId) => {
    setActiveTab(tab)
    setOpen(false)
  }

  const actions: QuickAction[] = [
    {
      id: 'pos',
      label: 'Point de vente',
      short: 'Vente',
      icon: <ShoppingCart size={18} />,
      run: () => goTab('pos'),
    },
    {
      id: 'inventaire',
      label: 'Inventaire',
      short: 'Stock',
      icon: <Package size={18} />,
      run: () => goTab('inventaire'),
    },
    {
      id: 'documents',
      label: 'Documents',
      short: 'Docs',
      icon: <FolderOpen size={18} />,
      run: () => goTab('documents'),
    },
    {
      id: 'historique',
      label: 'Historique',
      short: 'Hist.',
      icon: <History size={18} />,
      run: () => goTab('historique'),
    },
    {
      id: 'caisse',
      label: 'Trésorerie',
      short: 'Caisse',
      icon: <Vault size={18} />,
      run: () => goTab('caisse_interne'),
    },
    {
      id: 'fermeture',
      label: 'Fermer caisse',
      short: 'Clôture',
      icon: <LogOut size={18} />,
      accent: 'danger',
      run: () => {
        window.dispatchEvent(new CustomEvent('smlpos:openFermeture'))
        setOpen(false)
      },
    },
  ]

  if (hidden) return null

  const onEdge = edge === 'right' ? 'right-0' : 'left-0'
  const panelSlide = edge === 'right'
    ? open ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0 pointer-events-none'
    : open ? 'translate-x-0 opacity-100' : '-translate-x-4 opacity-0 pointer-events-none'

  return (
    <div
      ref={rootRef}
      className={cn('fixed z-[70] flex items-center gap-2', onEdge, 'bottom-24')}
      style={{ flexDirection: edge === 'right' ? 'row-reverse' : 'row' }}
    >
      <div className={cn('flex flex-col items-end gap-2 transition-all duration-200', panelSlide)}>
        {!currentShift && (
          <button
            type="button"
            onClick={() => { setShowShiftModal(true); setOpen(false) }}
            className="flex items-center gap-2 rounded-full border border-accent-500 bg-accent-50 px-3 py-2 text-xs font-semibold text-text-primary shadow-lg hover:bg-accent-500/30"
          >
            <Zap size={14} />
            Ouvrir caisse
          </button>
        )}

        {actions.map((action) => {
          const isActive = action.id === activeTab
          return (
            <button
              key={action.id}
              type="button"
              title={action.label}
              onClick={action.run}
              className={cn(
                'group flex items-center gap-2 rounded-full border bg-white/95 px-2 py-2 text-xs font-medium shadow-lg backdrop-blur transition hover:scale-[1.02]',
                action.accent === 'danger'
                  ? 'border-red-200 text-danger hover:bg-red-50'
                  : isActive
                    ? 'border-accent-500 bg-accent-50 text-text-primary'
                    : 'border-border text-text-secondary hover:border-accent-500 hover:bg-accent-50 hover:text-text-primary'
              )}
              style={{ flexDirection: edge === 'right' ? 'row-reverse' : 'row' }}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted group-hover:bg-white">
                {action.icon}
              </span>
              <span className="hidden sm:inline pr-1">{action.label}</span>
              <span className="sm:hidden pr-1">{action.short}</span>
            </button>
          )
        })}

        <button
          type="button"
          title={edge === 'right' ? 'Déplacer à gauche' : 'Déplacer à droite'}
          onClick={() => {
            const next = edge === 'right' ? 'left' : 'right'
            setEdge(next)
            try { localStorage.setItem(EDGE_KEY, next) } catch { /* ignore */ }
          }}
          className="self-center rounded-full border border-border bg-white/90 px-2 py-1 text-[10px] text-text-muted shadow hover:text-text-primary"
        >
          {edge === 'right' ? '← Gauche' : 'Droite →'}
        </button>
      </div>

      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? 'Fermer actions rapides' : 'Actions rapides'}
        onClick={() => setOpen(v => !v)}
        className={cn(
          'relative flex h-14 w-14 items-center justify-center rounded-full border-2 border-accent-500 bg-accent-500 shadow-xl transition hover:scale-105 active:scale-95',
          open && 'ring-4 ring-accent-500/30'
        )}
      >
        {open ? (
          <X size={22} className="text-text-primary" />
        ) : (
          <img src={logoUrl} alt="SMLPOS" className="h-9 w-9 rounded-full object-contain" />
        )}
        {!open && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-text-primary text-[9px] font-bold text-white">
            +
          </span>
        )}
      </button>
    </div>
  )
}

import { Moon, Sun, Contrast } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import {
  AGENT_THEME_OPTIONS,
  applyAgentTheme,
  loadAgentTheme,
  saveAgentTheme,
  type AgentThemeId,
} from '../lib/agentTheme'
import { useEffect, useState } from 'react'
import { cn } from '../lib/utils'

const ICONS: Record<AgentThemeId, typeof Sun> = {
  light: Sun,
  dark: Moon,
  'high-contrast': Contrast,
}

export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { currentOperateur } = useAppStore()
  const [theme, setTheme] = useState<AgentThemeId>(() => loadAgentTheme(currentOperateur?.id))

  useEffect(() => {
    const next = loadAgentTheme(currentOperateur?.id)
    setTheme(next)
    applyAgentTheme(next)
  }, [currentOperateur?.id])

  const setAndApply = (next: AgentThemeId) => {
    setTheme(next)
    applyAgentTheme(next)
    if (currentOperateur?.id) saveAgentTheme(currentOperateur.id, next)
  }

  if (compact) {
    const cycle = () => {
      const idx = AGENT_THEME_OPTIONS.findIndex(o => o.id === theme)
      const next = AGENT_THEME_OPTIONS[(idx + 1) % AGENT_THEME_OPTIONS.length].id
      setAndApply(next)
    }
    const Icon = ICONS[theme]
    const label = AGENT_THEME_OPTIONS.find(o => o.id === theme)?.label ?? 'Thème'
    return (
      <button
        type="button"
        onClick={cycle}
        title={`Thème : ${label} (cliquer pour changer)`}
        className="w-[38px] h-full flex items-center justify-center hover:bg-black/10 transition-colors"
      >
        <Icon size={15} />
      </button>
    )
  }

  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border bg-[var(--bg-primary)] p-0.5">
      {AGENT_THEME_OPTIONS.map(o => {
        const Icon = ICONS[o.id]
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => setAndApply(o.id)}
            title={o.label}
            className={cn(
              'p-1.5 rounded-md transition-colors',
              theme === o.id ? 'bg-accent-500 text-text-primary' : 'text-text-secondary hover:bg-muted',
            )}
          >
            <Icon size={13} />
          </button>
        )
      })}
    </div>
  )
}

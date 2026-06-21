export type AgentThemeId = 'light' | 'dark' | 'high-contrast'

export const AGENT_THEME_OPTIONS: { id: AgentThemeId; label: string }[] = [
  { id: 'light', label: 'Clair' },
  { id: 'dark', label: 'Sombre' },
  { id: 'high-contrast', label: 'Contraste élevé' },
]

const THEME_VARS: Record<AgentThemeId, Record<string, string>> = {
  light: {
    '--bg-primary': '#FFFFFF',
    '--bg-surface': '#FDFBF5',
    '--bg-muted': '#F9F6ED',
    '--card-bg': '#FFFFFF',
    '--input-bg': '#FFFFFF',
    '--accent-soft': '#FFFDE7',
    '--accent-500': '#FFD600',
    '--accent-600': '#F9A825',
    '--text-primary': '#1A1A1A',
    '--text-secondary': '#5C5C5C',
    '--text-muted': '#9E9E9E',
    '--border': '#E8E2D0',
    '--alert-bg': '#FFF8E1',
    '--alert-text': '#5D4037',
  },
  dark: {
    '--bg-primary': '#1E1E1E',
    '--bg-surface': '#121212',
    '--bg-muted': '#2A2A2A',
    '--card-bg': '#252525',
    '--input-bg': '#2E2E2E',
    '--accent-soft': '#3D3500',
    '--accent-500': '#FFD600',
    '--accent-600': '#F9A825',
    '--text-primary': '#F0F0F0',
    '--text-secondary': '#B8B8B8',
    '--text-muted': '#888888',
    '--border': '#404040',
    '--alert-bg': '#3D3200',
    '--alert-text': '#FFE082',
  },
  'high-contrast': {
    '--bg-primary': '#FFFFFF',
    '--bg-surface': '#FFFFFF',
    '--bg-muted': '#EEEEEE',
    '--card-bg': '#FFFFFF',
    '--input-bg': '#FFFFFF',
    '--accent-soft': '#EEEEEE',
    '--accent-500': '#000000',
    '--accent-600': '#000000',
    '--text-primary': '#000000',
    '--text-secondary': '#1A1A1A',
    '--text-muted': '#333333',
    '--border': '#000000',
    '--alert-bg': '#EEEEEE',
    '--alert-text': '#000000',
  },
}

export function themeStorageKey(operateurId: string): string {
  return `smlpos_theme_${operateurId}`
}

export function loadAgentTheme(operateurId: string | undefined): AgentThemeId {
  if (!operateurId) return 'light'
  try {
    const v = localStorage.getItem(themeStorageKey(operateurId)) as AgentThemeId | null
    if (v && THEME_VARS[v]) return v
  } catch { /* ignore */ }
  return 'light'
}

export function saveAgentTheme(operateurId: string, theme: AgentThemeId): void {
  localStorage.setItem(themeStorageKey(operateurId), theme)
}

export function applyAgentTheme(theme: AgentThemeId): void {
  const root = document.documentElement
  root.dataset.agentTheme = theme
  root.classList.toggle('dark', theme === 'dark')
  const vars = THEME_VARS[theme] ?? THEME_VARS.light
  for (const [k, v] of Object.entries(vars)) {
    root.style.setProperty(k, v)
  }
}

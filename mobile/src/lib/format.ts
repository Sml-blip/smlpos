export const money = (value: unknown) => `${Number(value || 0).toFixed(3)} DT`

export const dateTime = (value: unknown) => {
  if (!value) return '—'
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('fr-TN', { dateStyle: 'short', timeStyle: 'short' })
}

export const dateOnly = (value: unknown) => {
  if (!value) return '—'
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('fr-TN')
}

export const localDateKey = (value: unknown = new Date()) => {
  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Tunis',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export const dayLabel = (key: string) => {
  const today = localDateKey()
  const yesterday = localDateKey(new Date(Date.now() - 86_400_000))
  if (key === today) return 'Aujourd’hui'
  if (key === yesterday) return 'Hier'
  return new Date(`${key}T12:00:00`).toLocaleDateString('fr-TN', { weekday: 'short', day: '2-digit', month: 'short' })
}

export function errorMessage(cause: unknown) {
  if (cause instanceof Error) return cause.message
  if (cause && typeof cause === 'object') {
    const value = cause as Record<string, unknown>
    return String(value.message ?? value.details ?? value.hint ?? value.code ?? 'Erreur de connexion inconnue')
  }
  return String(cause || 'Erreur de connexion inconnue')
}


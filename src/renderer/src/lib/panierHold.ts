import type { CartItem } from './types'
import type { ClientFormValue } from '../components/ClientPicker'

const STORAGE_KEY = 'smlpos_saved_paniers'
const MAX_SAVED = 30

export interface SavedPanier {
  id: string
  label: string
  savedAt: string
  shiftId?: string | null
  items: CartItem[]
  remiseTotale: number
  clientForm?: ClientFormValue
}

function readAll(): SavedPanier[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as SavedPanier[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll(list: SavedPanier[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_SAVED)))
}

export function listSavedPaniers(): SavedPanier[] {
  return readAll().sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

export function savePanierHold(input: {
  items: CartItem[]
  remiseTotale: number
  clientForm?: ClientFormValue
  shiftId?: string | null
  label?: string
}): SavedPanier {
  const now = new Date()
  const timeLabel = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  const itemCount = input.items.reduce((s, i) => s + i.quantite, 0)
  const entry: SavedPanier = {
    id: crypto.randomUUID(),
    label: input.label?.trim() || `Panier ${timeLabel} · ${itemCount} art.`,
    savedAt: now.toISOString(),
    shiftId: input.shiftId ?? null,
    items: input.items.map(i => ({ ...i })),
    remiseTotale: input.remiseTotale,
    clientForm: input.clientForm ? { ...input.clientForm } : undefined,
  }
  writeAll([entry, ...readAll()])
  return entry
}

export function deleteSavedPanier(id: string): void {
  writeAll(readAll().filter(p => p.id !== id))
}

export function getSavedPanier(id: string): SavedPanier | undefined {
  return readAll().find(p => p.id === id)
}

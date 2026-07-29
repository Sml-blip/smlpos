import type { CartItem } from './types'
import type { ClientFormValue } from '../components/ClientPicker'

const STORAGE_KEY = 'smlpos_saved_paniers'
const ACTIVE_CART_STORAGE_KEY = 'smlpos_active_cart_recovery'
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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_SAVED)))
  } catch {
    // SQLite is authoritative. localStorage is only an additional recovery copy.
  }
}

export function listSavedPaniers(): SavedPanier[] {
  return readAll().sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

/**
 * On first boot after this migration, copy legacy localStorage carts into SQLite.
 * SQLite then becomes authoritative and the local copy is refreshed from it.
 */
export async function syncSavedPaniers(): Promise<SavedPanier[]> {
  const legacy = readAll()
  if (legacy.length) await window.api.savedPaniersImportLegacy(legacy)
  const durable = await window.api.savedPaniersList() as SavedPanier[]
  const valid = durable.filter(p =>
    !!p?.id && !!p?.label && !!p?.savedAt && Array.isArray(p?.items) && p.items.length > 0
  )
  writeAll(valid)
  return valid.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

export async function savePanierHold(input: {
  items: CartItem[]
  remiseTotale: number
  clientForm?: ClientFormValue
  shiftId?: string | null
  label?: string
}): Promise<SavedPanier> {
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
  // Keep a recovery copy immediately, but never report success or clear the live
  // cart until the durable SQLite write has completed.
  writeAll([entry, ...readAll()])
  const result = await window.api.savedPaniersSave(entry)
  if (!result?.success) throw new Error(result?.error || 'Sauvegarde durable du panier impossible')
  return entry
}

export async function deleteSavedPanier(id: string): Promise<void> {
  const result = await window.api.savedPaniersDelete(id)
  if (!result?.success) throw new Error(result?.error || 'Suppression du panier impossible')
  writeAll(readAll().filter(p => p.id !== id))
}

export function getSavedPanier(id: string): SavedPanier | undefined {
  return readAll().find(p => p.id === id)
}

function readActiveCartRecovery(): SavedPanier | null {
  try {
    const raw = localStorage.getItem(ACTIVE_CART_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SavedPanier
    return parsed?.id && Array.isArray(parsed.items) && parsed.items.length ? parsed : null
  } catch {
    return null
  }
}

function writeActiveCartRecovery(panier: SavedPanier | null): void {
  try {
    if (panier) localStorage.setItem(ACTIVE_CART_STORAGE_KEY, JSON.stringify(panier))
    else localStorage.removeItem(ACTIVE_CART_STORAGE_KEY)
  } catch {
    // SQLite remains authoritative.
  }
}

export async function loadActiveCartDraft(): Promise<SavedPanier | null> {
  const durable = await window.api.posCartDraftGet() as SavedPanier | null
  if (durable?.items?.length) {
    writeActiveCartRecovery(durable)
    return durable
  }

  // Recover an older emergency renderer copy if SQLite does not have a draft yet.
  const recovery = readActiveCartRecovery()
  if (!recovery) return null
  const result = await window.api.posCartDraftSave(recovery)
  if (!result?.success) throw new Error(result?.error || 'Récupération du panier actif impossible')
  return recovery
}

export async function saveActiveCartDraft(input: {
  items: CartItem[]
  remiseTotale: number
  clientForm?: ClientFormValue
  shiftId?: string | null
}): Promise<void> {
  if (!input.items.length) {
    const result = await window.api.posCartDraftClear()
    if (!result?.success) throw new Error(result?.error || 'Nettoyage du brouillon impossible')
    writeActiveCartRecovery(null)
    return
  }
  const draft: SavedPanier = {
    id: '__active_pos_cart__',
    label: 'Panier POS actif',
    savedAt: new Date().toISOString(),
    shiftId: input.shiftId ?? null,
    items: input.items.map(item => ({ ...item })),
    remiseTotale: input.remiseTotale,
    clientForm: input.clientForm ? { ...input.clientForm } : undefined,
  }
  writeActiveCartRecovery(draft)
  const result = await window.api.posCartDraftSave(draft)
  if (!result?.success) throw new Error(result?.error || 'Sauvegarde du panier actif impossible')
}

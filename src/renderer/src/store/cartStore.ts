import { create } from 'zustand'
import type { CartItem } from '../lib/types'

interface CartState {
  items: CartItem[]
  remiseTotale: number
  addItem: (item: CartItem) => void
  updateItem: (index: number, item: Partial<CartItem>) => void
  removeItem: (index: number) => void
  clearCart: () => void
  loadCart: (items: CartItem[], remiseTotale?: number) => void
  setRemiseTotale: (v: number) => void
  total: () => number
  totalRemises: () => number
  sousTotal: () => number
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  remiseTotale: 0,

  addItem: (item) => {
    set((state) => {
      // Check if same product already in cart
      const existingIdx = state.items.findIndex(
        i => i.produit_id && i.produit_id === item.produit_id
          && i.remise_pct === item.remise_pct
          && (i.numero_serie || '') === (item.numero_serie || '')
          && !item.numero_serie,
      )
      if (existingIdx >= 0) {
        const updated = [...state.items]
        const existing = updated[existingIdx]
        const newQty = existing.quantite + item.quantite
        const totalLigne = newQty * existing.prix_unitaire * (1 - existing.remise_pct / 100)
        updated[existingIdx] = { ...existing, quantite: newQty, total_ligne: totalLigne }
        return { items: updated }
      }
      return { items: [...state.items, item] }
    })
  },

  updateItem: (index, item) => {
    set((state) => {
      const updated = [...state.items]
      const current = updated[index]
      const merged = { ...current, ...item }
      merged.total_ligne = merged.quantite * merged.prix_unitaire * (1 - merged.remise_pct / 100)
      updated[index] = merged
      return { items: updated }
    })
  },

  removeItem: (index) => {
    set((state) => ({ items: state.items.filter((_, i) => i !== index) }))
  },

  clearCart: () => set({ items: [], remiseTotale: 0 }),

  loadCart: (items, remiseTotale = 0) => set({
    items: items.map(i => ({ ...i })),
    remiseTotale,
  }),

  setRemiseTotale: (v) => set({ remiseTotale: v }),

  sousTotal: () => {
    return get().items.reduce((sum, item) => sum + item.quantite * item.prix_unitaire, 0)
  },

  totalRemises: () => {
    return get().items.reduce((sum, item) => {
      const remise = item.quantite * item.prix_unitaire * (item.remise_pct / 100)
      return sum + remise
    }, 0)
  },

  total: () => {
    return get().items.reduce((sum, item) => sum + item.total_ligne, 0)
  },
}))

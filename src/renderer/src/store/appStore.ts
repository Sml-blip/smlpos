import { create } from 'zustand'
import type { Operateur, Shift } from '../lib/types'

export type TabId = 'pos' | 'historique' | 'inventaire' | 'achats' | 'dashboard' | 'caisse_interne' | 'vente_en_ligne' | 'credits' | 'retours' | 'settings' | 'clients' | 'personnels' | 'documents'

interface AppState {
  currentShift: Shift | null
  currentOperateur: Operateur | null
  operateurs: Operateur[]
  isOnline: boolean
  activeTab: TabId
  showShiftModal: boolean

  setCurrentShift: (shift: Shift | null) => void
  setCurrentOperateur: (op: Operateur | null) => void
  setOperateurs: (ops: Operateur[]) => void
  setIsOnline: (v: boolean) => void
  setActiveTab: (tab: TabId) => void
  setShowShiftModal: (v: boolean) => void
}

export const useAppStore = create<AppState>((set) => ({
  currentShift: null,
  currentOperateur: null,
  operateurs: [],
  isOnline: navigator.onLine,
  activeTab: 'pos',
  showShiftModal: true,

  setCurrentShift: (shift) => set({ currentShift: shift }),
  setCurrentOperateur: (op) => set({ currentOperateur: op }),
  setOperateurs: (ops) => set({ operateurs: ops }),
  setIsOnline: (v) => set({ isOnline: v }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setShowShiftModal: (v) => set({ showShiftModal: v }),
}))

import { create } from 'zustand'
import type { Client, Operateur, Shift } from '../lib/types'

export type TabId = 'pos' | 'historique' | 'inventaire' | 'achats' | 'dashboard' | 'caisse_interne' | 'vente_en_ligne' | 'credits' | 'retours' | 'settings' | 'clients' | 'personnels' | 'documents'

interface AppState {
  currentShift: Shift | null
  currentOperateur: Operateur | null
  operateurs: Operateur[]
  isOnline: boolean
  activeTab: TabId
  showShiftModal: boolean
  sessionClient: Client | null

  setCurrentShift: (shift: Shift | null) => void
  setCurrentOperateur: (op: Operateur | null) => void
  setOperateurs: (ops: Operateur[]) => void
  setIsOnline: (v: boolean) => void
  setActiveTab: (tab: TabId) => void
  setShowShiftModal: (v: boolean) => void
  setSessionClient: (client: Client | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  currentShift: null,
  currentOperateur: null,
  operateurs: [],
  isOnline: navigator.onLine,
  activeTab: 'pos',
  showShiftModal: true,
  sessionClient: null,

  setCurrentShift: (shift) => set({ currentShift: shift }),
  setCurrentOperateur: (op) => set({ currentOperateur: op }),
  setOperateurs: (ops) => set({ operateurs: ops }),
  setIsOnline: (v) => set({ isOnline: v }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setShowShiftModal: (v) => set({ showShiftModal: v }),
  setSessionClient: (client) => set({ sessionClient: client }),
}))

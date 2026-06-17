import { create } from 'zustand'

export type ToastType = 'success' | 'error' | 'info'

export interface ToastItem {
  id: string
  type: ToastType
  message: string
}

interface ToastState {
  toasts: ToastItem[]
  showToast: (type: ToastType, message: string) => void
  dismissToast: (id: string) => void
}

let toastSeq = 0

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  showToast: (type, message) => {
    const id = `toast-${++toastSeq}-${Date.now()}`
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, type, message }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, 5000)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

export function showToast(type: ToastType, message: string) {
  useToastStore.getState().showToast(type, message)
}

import { showToast } from './toast'

function formatError(label: string, e: unknown): string {
  const detail = e instanceof Error ? e.message : String(e)
  return `${label} : ${detail || 'erreur inconnue'}`
}

/**
 * Wraps async IPC calls with user-visible error feedback (French).
 * Returns null on failure.
 */
export async function apiCall<T>(
  label: string,
  fn: () => Promise<T>,
  options?: { successMessage?: string; silent?: boolean }
): Promise<T | null> {
  try {
    const result = await fn()
    if (options?.successMessage) {
      showToast('success', options.successMessage)
    }
    return result
  } catch (e) {
    if (!options?.silent) {
      showToast('error', formatError(label, e))
    }
    console.error(`[apiCall] ${label}:`, e)
    return null
  }
}

/**
 * Standard pattern for button actions (save, create, delete).
 * Manages loading/saving state and shows success/error toasts.
 */
export async function runAction(
  label: string,
  fn: () => Promise<void>,
  options?: {
    successMessage?: string
    silent?: boolean
    setLoading?: (v: boolean) => void
    setSaving?: (v: boolean) => void
    onError?: (msg: string) => void
  }
): Promise<boolean> {
  const setBusy = (v: boolean) => {
    options?.setLoading?.(v)
    options?.setSaving?.(v)
  }
  setBusy(true)
  try {
    await fn()
    if (options?.successMessage) {
      showToast('success', options.successMessage)
    }
    return true
  } catch (e) {
    const msg = formatError(label, e)
    if (!options?.silent) {
      showToast('error', msg)
    }
    options?.onError?.(msg)
    console.error(`[runAction] ${label}:`, e)
    return false
  } finally {
    setBusy(false)
  }
}

/**
 * Standard pattern for data loads (list, refresh).
 */
export async function loadData<T>(
  label: string,
  fn: () => Promise<T>,
  options?: { setLoading?: (v: boolean) => void; silent?: boolean }
): Promise<T | null> {
  options?.setLoading?.(true)
  try {
    return await apiCall(label, fn, { silent: options?.silent })
  } finally {
    options?.setLoading?.(false)
  }
}

import { useCallback, useEffect, useState } from 'react'
import { showToast } from './toast'

export type UpdateStatusPayload =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string; releaseNotes?: string }
  | { state: 'not-available'; version: string }
  | { state: 'downloading'; percent: number; transferred: number; total: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }

const api = window.api

export function useAppUpdater(currentVersion: string) {
  const [status, setStatus] = useState<UpdateStatusPayload>({ state: 'idle' })
  const [manualCheck, setManualCheck] = useState(false)
  const [dismissedError, setDismissedError] = useState(false)

  useEffect(() => {
    if (!api.onUpdateStatus) return
    const unsubscribe = api.onUpdateStatus((payload: UpdateStatusPayload) => {
      if (payload.state === 'not-available') {
        if (manualCheck) showToast('success', `Vous avez la dernière version (v${currentVersion})`)
        setManualCheck(false)
        setStatus({ state: 'idle' })
        return
      }
      if (payload.state === 'error' && !manualCheck) {
        setStatus({ state: 'idle' })
        return
      }
      if (payload.state === 'checking' && !manualCheck) return
      setStatus(payload)
    })
    return unsubscribe
  }, [currentVersion, manualCheck])

  const checkForUpdates = useCallback(async (manual = false) => {
    if (!api.updateCheck) {
      if (manual) showToast('info', 'Mises à jour disponibles uniquement dans l\'application installée')
      return
    }
    setManualCheck(manual)
    setDismissedError(false)
    if (manual) setStatus({ state: 'checking' })
    const res = await api.updateCheck(manual) as { ok?: boolean; reason?: string }
    if (manual && res?.reason === 'no-release') {
      showToast('info', 'Aucune release sur GitHub pour le moment — publiez v1.9.x sur github.com/Sml-blip/smlpos/releases')
      setStatus({ state: 'idle' })
      setManualCheck(false)
    }
    if (manual && !res?.ok && res?.reason === 'dev') {
      showToast('info', 'Mises à jour désactivées en mode développement')
      setStatus({ state: 'idle' })
    }
  }, [])

  const installUpdate = useCallback(() => {
    api.updateInstall?.()
  }, [])

  const dismissError = useCallback(() => {
    setDismissedError(true)
    setStatus({ state: 'idle' })
  }, [])

  const showModal =
    !dismissedError &&
    (status.state === 'checking' ||
      status.state === 'available' ||
      status.state === 'downloading' ||
      status.state === 'downloaded' ||
      status.state === 'error')

  return {
    status,
    showModal,
    checkForUpdates,
    installUpdate,
    dismissError,
  }
}

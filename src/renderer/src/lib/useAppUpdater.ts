import { useCallback, useEffect, useRef, useState } from 'react'
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
const CHECK_TIMEOUT_MS = 35000

export function useAppUpdater(currentVersion: string) {
  const [status, setStatus] = useState<UpdateStatusPayload>({ state: 'idle' })
  const [isManualChecking, setIsManualChecking] = useState(false)
  const [dismissedError, setDismissedError] = useState(false)
  const manualCheckRef = useRef(false)

  const finishManualCheck = useCallback(() => {
    manualCheckRef.current = false
    setIsManualChecking(false)
  }, [])

  useEffect(() => {
    if (!api.onUpdateStatus) return
    const unsubscribe = api.onUpdateStatus((payload: UpdateStatusPayload) => {
      if (payload.state === 'not-available') {
        if (manualCheckRef.current) {
          showToast('success', `Vous avez la dernière version (v${currentVersion})`)
        }
        finishManualCheck()
        setStatus({ state: 'idle' })
        return
      }
      if (payload.state === 'error') {
        if (manualCheckRef.current) {
          showToast('error', payload.message)
          finishManualCheck()
          setStatus({ state: 'idle' })
          return
        }
        setStatus({ state: 'idle' })
        return
      }
      if (payload.state === 'checking') return
      if (
        payload.state === 'available' ||
        payload.state === 'downloading' ||
        payload.state === 'downloaded'
      ) {
        finishManualCheck()
      }
      setStatus(payload)
    })
    return unsubscribe
  }, [currentVersion, finishManualCheck])

  const checkForUpdates = useCallback(async (manual = false) => {
    if (!api.updateCheck) {
      if (manual) showToast('info', 'Mises à jour disponibles uniquement dans l\'application installée')
      return
    }
    if (manual) {
      manualCheckRef.current = true
      setIsManualChecking(true)
      setDismissedError(false)
    }

    let timedOut = false
    const timer = manual
      ? setTimeout(() => {
          timedOut = true
          showToast('error', 'Délai dépassé — vérifiez votre connexion Internet.')
          finishManualCheck()
          setStatus({ state: 'idle' })
        }, CHECK_TIMEOUT_MS)
      : null

    try {
      const res = await api.updateCheck(manual) as { ok?: boolean; reason?: string }
      if (timedOut) return
      if (manual && res?.reason === 'no-release') {
        showToast('info', 'Aucune release sur GitHub — vérifiez github.com/Sml-blip/smlpos/releases')
        finishManualCheck()
        setStatus({ state: 'idle' })
      }
      if (manual && !res?.ok && res?.reason === 'dev') {
        showToast('info', 'Mises à jour désactivées en mode développement')
        finishManualCheck()
        setStatus({ state: 'idle' })
      }
      if (manual && !res?.ok && res?.reason && res.reason !== 'dev' && res.reason !== 'no-release') {
        showToast('error', res.reason)
        finishManualCheck()
        setStatus({ state: 'idle' })
      }
    } catch (e) {
      if (manual && !timedOut) {
        const msg = e instanceof Error ? e.message : String(e)
        showToast('error', msg)
        finishManualCheck()
        setStatus({ state: 'idle' })
      }
    } finally {
      if (timer) clearTimeout(timer)
    }
  }, [finishManualCheck, currentVersion])

  const installUpdate = useCallback(() => {
    api.updateInstall?.()
  }, [])

  const dismissError = useCallback(() => {
    setDismissedError(true)
    setStatus({ state: 'idle' })
  }, [])

  const showModal =
    !dismissedError &&
    (status.state === 'available' ||
      status.state === 'downloading' ||
      status.state === 'downloaded' ||
      status.state === 'error')

  return {
    status,
    showModal,
    isManualChecking,
    checkForUpdates,
    installUpdate,
    dismissError,
  }
}

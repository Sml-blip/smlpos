import { useState, useEffect, useCallback, useRef } from 'react'
import { useAppStore } from '../store/appStore'
import { Wifi, WifiOff, Clock, LogOut, CloudOff, RefreshCw, AlertTriangle, CheckCircle2, X, Info, FileText, BellRing } from 'lucide-react'
import { formatPrice } from '../lib/utils'
import FermetureCaisseModal from './FermetureCaisseModal'
import DocumentPrintModal from '../modules/historique/DocumentPrintModal'
import type { Document } from '../lib/types'
import { getPendingCount, getFailedCount, processSyncQueue, pullSyncFromRemote, resetFailedItems, purgeFailedItems } from '../lib/sync'
import { isSupabaseEnabled } from '../lib/supabase'
import { runAction } from '../lib/apiCall'

const api = window.api

type SyncErrorRow = { id: string; table_name: string; operation: string; attempts: number; last_error: string | null; created_at: string }

const reminderTiming = (now: Date, timeValue: string) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(timeValue || '21:00')
  const hours = match ? Math.min(23, Math.max(0, Number(match[1]))) : 21
  const minutes = match ? Math.min(59, Math.max(0, Number(match[2]))) : 0
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const alertMinutes = hours * 60 + minutes
  return {
    pinned: nowMinutes >= Math.max(0, alertMinutes - 30),
    overdue: nowMinutes >= alertMinutes,
  }
}

export default function StatusBar() {
  const { isOnline, currentShift } = useAppStore()
  const [time, setTime] = useState(new Date())
  const [showFermeture, setShowFermeture] = useState(false)
  const [dailyInvoicePreview, setDailyInvoicePreview] = useState<Document | null>(null)
  const [pendingSync, setPendingSync] = useState(0)
  const [failedSync, setFailedSync] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [showFailedMenu, setShowFailedMenu] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [errorRows, setErrorRows] = useState<SyncErrorRow[]>([])
  const [dbHealth, setDbHealth] = useState<{ ok: boolean; error?: string } | null>(null)
  const [closedShiftsToday, setClosedShiftsToday] = useState(0)
  const [snoozedUntil, setSnoozedUntil] = useState(0)
  const lastAlarmAtRef = useRef(0)
  const [shiftReminderSettings, setShiftReminderSettings] = useState({
    enabled: true,
    alarmEnabled: true,
    morningTime: '14:00',
    eveningTime: '21:00',
    snoozeMinutes: 10,
  })

  useEffect(() => {
    api.appHealth?.().then((h: { ok?: boolean; error?: string }) => {
      setDbHealth({ ok: !!h?.ok, error: h?.error })
    }).catch(() => setDbHealth(null))
  }, [])

  useEffect(() => {
    if (!showErrorModal) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowErrorModal(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showErrorModal])

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    let cancelled = false
    const loadSettings = () => {
      api.settingsGetAll().then((settings: Record<string, string>) => {
        if (cancelled) return
        setShiftReminderSettings({
          enabled: settings.shift_close_reminder_enabled !== 'false',
          alarmEnabled: settings.shift_close_alarm_enabled !== 'false',
          morningTime: settings.shift_morning_close_time || '14:00',
          eveningTime: settings.shift_close_reminder_time || '21:00',
          snoozeMinutes: Math.max(1, Number(settings.shift_close_snooze_minutes) || 10),
        })
      }).catch(() => { /* settings may not be ready during startup */ })
    }
    loadSettings()
    window.addEventListener('smlpos:settings-changed', loadSettings)
    return () => {
      cancelled = true
      window.removeEventListener('smlpos:settings-changed', loadSettings)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      if (!currentShift) { setClosedShiftsToday(0); return }
      void (api.shiftsCountClosedToday?.() ?? Promise.resolve(0)).then(count => {
        if (!cancelled) setClosedShiftsToday(Number(count) || 0)
      })
    }
    refresh()
    const timer = window.setInterval(refresh, 30_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [currentShift?.id])

  useEffect(() => {
    setSnoozedUntil(0)
    lastAlarmAtRef.current = 0
  }, [currentShift?.id])

  const isMorningShift = closedShiftsToday === 0
  const activeReminderTime = isMorningShift ? shiftReminderSettings.morningTime : shiftReminderSettings.eveningTime
  const shiftReminderTiming = reminderTiming(time, activeReminderTime)
  const snoozed = snoozedUntil > time.getTime()
  const showPinnedShiftReminder = !!currentShift
    && !showFermeture
    && shiftReminderSettings.enabled
    && shiftReminderTiming.pinned
    && !snoozed

  const playClosingAlarm = useCallback(() => {
    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioContextClass) return
      const context = new AudioContextClass()
      const gain = context.createGain()
      gain.gain.setValueAtTime(0.28, context.currentTime)
      gain.connect(context.destination)
      ;[0, 0.45, 0.9, 1.35].forEach((offset, index) => {
        const oscillator = context.createOscillator()
        oscillator.type = 'square'
        oscillator.frequency.setValueAtTime(index % 2 === 0 ? 880 : 660, context.currentTime + offset)
        oscillator.connect(gain)
        oscillator.start(context.currentTime + offset)
        oscillator.stop(context.currentTime + offset + 0.32)
      })
      window.setTimeout(() => void context.close(), 2200)
    } catch { /* audio can be blocked before the first user interaction */ }
  }, [])

  useEffect(() => {
    if (!currentShift || !shiftReminderSettings.enabled || !shiftReminderSettings.alarmEnabled) return
    if (!shiftReminderTiming.overdue || snoozed || showFermeture) return
    if (time.getTime() - lastAlarmAtRef.current < 60_000) return
    lastAlarmAtRef.current = time.getTime()
    playClosingAlarm()
  }, [currentShift, playClosingAlarm, shiftReminderSettings.alarmEnabled, shiftReminderSettings.enabled, shiftReminderTiming.overdue, showFermeture, snoozed, time])

  const refreshCounts = useCallback(async () => {
    if (!isSupabaseEnabled || !window.api?.syncQueuePendingCount) return
    const [p, f] = await Promise.all([getPendingCount(), getFailedCount()])
    setPendingSync(p)
    setFailedSync(f)
  }, [])

  // Poll counts every 5s
  useEffect(() => {
    if (!isSupabaseEnabled) return
    refreshCounts()
    const t = setInterval(refreshCounts, 5_000)
    return () => clearInterval(t)
  }, [refreshCounts])

  // Listen for F10 event from POSTab
  useEffect(() => {
    const handler = () => setShowFermeture(true)
    window.addEventListener('smlpos:openFermeture', handler)
    return () => window.removeEventListener('smlpos:openFermeture', handler)
  }, [])

  const handleForceSync = async () => {
    if (syncing) return
    setSyncMsg(null)
    await runAction('Synchronisation', async () => {
      const pulled = await pullSyncFromRemote({ full: false })
      const pushed = await processSyncQueue()
      await refreshCounts()
      const parts: string[] = []
      if (pulled.applied > 0) parts.push(`${pulled.applied} reçu(s)`)
      if (pushed > 0) parts.push(`${pushed} envoyé(s)`)
      setSyncMsg(parts.length ? parts.join(', ') : 'À jour')
      setTimeout(() => setSyncMsg(null), 3000)
    }, { setLoading: setSyncing })
  }

  const handleShowErrors = async () => {
    const rows = await (window.api as unknown as { syncQueueGetErrors: () => Promise<SyncErrorRow[]> }).syncQueueGetErrors()
    setErrorRows(rows)
    setShowErrorModal(true)
  }

  const handlePurgeAll = async () => {
    if (!confirm('Supprimer TOUS les éléments en attente de sync ?\n(Les données restent en local — seule la file d\'attente est vidée)')) return
    await (window.api as unknown as { syncQueuePurgeAll: () => Promise<unknown> }).syncQueuePurgeAll()
    await refreshCounts()
    setShowErrorModal(false)
    setSyncMsg('File sync vidée')
    setTimeout(() => setSyncMsg(null), 3000)
  }

  const handleResetFailed = async () => {
    const n = await resetFailedItems()
    setShowFailedMenu(false)
    await refreshCounts()
    setSyncMsg(`${n} erreur(s) réinitialisée(s)`)
    setTimeout(() => setSyncMsg(null), 3000)
    // Trigger sync after reset
    handleForceSync()
  }

  const handlePurgeFailed = async () => {
    const n = await purgeFailedItems()
    setShowFailedMenu(false)
    await refreshCounts()
    setSyncMsg(`${n} erreur(s) supprimée(s)`)
    setTimeout(() => setSyncMsg(null), 3000)
  }

  return (
    <>
      <div className="h-7 flex items-center gap-4 px-4 bg-[var(--bg-primary)] border-t border-border text-xs text-text-secondary flex-shrink-0 relative">
        {dbHealth && !dbHealth.ok && (
          <div className="absolute inset-x-0 -top-6 h-6 bg-red-600 text-white text-[10px] flex items-center justify-center font-semibold">
            Erreur base de données — {dbHealth.error ?? 'vérifiez les migrations'}
          </div>
        )}
        {/* Online status */}
        <div className={`flex items-center gap-1.5 font-medium ${isOnline ? 'text-success' : 'text-warning'}`}>
          {isOnline ? <Wifi size={11} /> : <WifiOff size={11} />}
          {isOnline ? 'En ligne' : 'Hors ligne'}
        </div>

        {currentShift && (
          <>
            <span className="text-border">|</span>
            <span>Shift: <strong>{currentShift.operateur_nom}</strong></span>
            <span className="text-border">|</span>
            <span>Fond: <strong className="font-price">{formatPrice(currentShift.fond_de_caisse)}</strong></span>
            <span className="text-border">|</span>
            <button
              onClick={() => setShowFermeture(true)}
              className="flex items-center gap-1 text-danger hover:text-red-700 font-semibold transition-colors"
              title="Fermer la caisse"
            >
              <LogOut size={10} />
              Fermer la caisse
            </button>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          {isSupabaseEnabled && (
            <>
              {/* Flash message */}
              {syncMsg && (
                <span className="text-success font-semibold flex items-center gap-1">
                  <CheckCircle2 size={10} /> {syncMsg}
                </span>
              )}

              {/* Failed items badge */}
              {failedSync > 0 && (
                <div className="relative">
                  <button
                    onClick={() => setShowFailedMenu(v => !v)}
                    className="flex items-center gap-1 text-danger hover:text-red-700 font-semibold"
                    title={`${failedSync} élément(s) en erreur — cliquer pour options`}
                  >
                    <AlertTriangle size={10} />
                    {failedSync} erreur{failedSync > 1 ? 's' : ''}
                  </button>
                  {showFailedMenu && (
                    <div className="absolute bottom-7 right-0 bg-white border border-border rounded-xl shadow-lg z-50 w-44 py-1 text-xs">
                      <div className="px-3 py-1.5 text-text-muted font-semibold border-b border-border">
                        {failedSync} élément(s) bloqué(s)
                      </div>
                      <button onClick={handleResetFailed} className="w-full text-left px-3 py-2 hover:bg-muted flex items-center gap-2">
                        <RefreshCw size={10} /> Réessayer tout
                      </button>
                      <button onClick={handlePurgeFailed} className="w-full text-left px-3 py-2 hover:bg-muted text-danger flex items-center gap-2">
                        <X size={10} /> Supprimer tout
                      </button>
                      <button onClick={() => setShowFailedMenu(false)} className="w-full text-left px-3 py-2 hover:bg-muted text-text-muted">
                        Fermer
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Pending badge + force-sync button */}
              {pendingSync > 0 ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleForceSync}
                    disabled={syncing || !isOnline}
                    className="flex items-center gap-1 text-warning hover:text-orange-600 font-semibold disabled:opacity-50"
                    title="Cliquer pour synchroniser maintenant"
                  >
                    <RefreshCw size={10} className={syncing ? 'animate-spin' : ''} />
                    {syncing ? 'Sync...' : `${pendingSync} en attente`}
                  </button>
                  <button onClick={handleShowErrors} title="Voir les erreurs de sync" className="text-text-muted hover:text-warning">
                    <Info size={10} />
                  </button>
                </div>
              ) : !isOnline ? (
                <div className="flex items-center gap-1 text-text-secondary" title="Hors ligne — sync en pause">
                  <CloudOff size={10} />
                </div>
              ) : (pendingSync === 0 && failedSync === 0 && !syncMsg) ? (
                <button
                  onClick={handleForceSync}
                  disabled={syncing}
                  className="flex items-center gap-1 text-text-muted hover:text-success transition-colors"
                  title="Sync à jour — cliquer pour forcer"
                >
                  <RefreshCw size={9} className={syncing ? 'animate-spin' : ''} />
                  Sync
                </button>
              ) : null}
            </>
          )}

          <div className="flex items-center gap-1">
            <Clock size={11} />
            <span className="font-price">{time.toLocaleTimeString('fr-FR')}</span>
          </div>
        </div>
      </div>

      {showFermeture && (
        <FermetureCaisseModal
          onClose={() => setShowFermeture(false)}
          onInvoiceCreated={async documentId => {
            const doc = await api.documentsGet?.(documentId) as Document | null
            if (doc) setDailyInvoicePreview(doc)
          }}
        />
      )}

      {dailyInvoicePreview && (
        <DocumentPrintModal doc={dailyInvoicePreview} onClose={() => setDailyInvoicePreview(null)} />
      )}

      {showPinnedShiftReminder && currentShift && (
        <div className="fixed left-4 bottom-10 z-[190] w-[min(390px,calc(100vw-2rem))] animate-slide-in">
          <div className={`rounded-2xl border shadow-2xl overflow-hidden ${
            shiftReminderTiming.overdue
              ? 'bg-orange-50 border-orange-300'
              : 'bg-teal-50 border-teal-300'
          }`}>
            <div className="px-4 py-3 flex items-start gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                shiftReminderTiming.overdue ? 'bg-orange-100 text-orange-700' : 'bg-teal-100 text-teal-700'
              }`}>
                {shiftReminderTiming.overdue ? <BellRing size={17} className="animate-pulse" /> : <FileText size={17} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-bold text-sm text-text-primary">
                  {shiftReminderTiming.overdue
                    ? `Clôture caisse ${isMorningShift ? 'matin' : 'soir'} à effectuer`
                    : `Clôture caisse ${isMorningShift ? 'matin' : 'soir'} dans moins de 30 min`}
                </div>
                <p className="text-[11px] text-text-secondary mt-1 leading-relaxed">
                  Alerte prévue à <strong>{activeReminderTime}</strong>. {isMorningShift
                    ? 'La clôture du matin ne crée aucune facture.'
                    : 'La clôture du soir crée la facture Client Passager complète de la journée.'}
                </p>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-[10px] text-text-muted truncate">
                    Shift : {currentShift.operateur_nom}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {shiftReminderTiming.overdue && (
                      <button
                        onClick={() => {
                          setSnoozedUntil(Date.now() + shiftReminderSettings.snoozeMinutes * 60_000)
                          lastAlarmAtRef.current = Date.now()
                        }}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-orange-300 text-orange-800 hover:bg-orange-100"
                      >
                        Snooze {shiftReminderSettings.snoozeMinutes} min
                      </button>
                    )}
                    <button
                      onClick={() => setShowFermeture(true)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold text-white transition-colors ${
                        shiftReminderTiming.overdue
                          ? 'bg-danger hover:bg-red-700'
                          : 'bg-teal-600 hover:bg-teal-700'
                      }`}
                    >
                      Clôturer
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showErrorModal && (
        <div
          className="fixed inset-0 bg-black/60 flex items-end justify-end z-[200] p-4"
          onClick={() => setShowErrorModal(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[70vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <h3 className="font-bold text-sm flex items-center gap-2"><AlertTriangle size={14} className="text-warning" /> Détails sync queue ({errorRows.length})</h3>
              <button onClick={() => setShowErrorModal(false)}><X size={16} className="text-text-muted" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              <p className="text-xs text-text-secondary bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 mb-2">
                Vos ventes et shifts sont déjà enregistrés localement (SQLite). La file sync sert uniquement à copier vers Supabase — rien n&apos;est perdu si un élément est en attente.
              </p>
              {errorRows.length === 0 && <p className="text-sm text-text-muted text-center py-4">Aucun élément en attente</p>}
              {errorRows.map(r => (
                <div key={r.id} className={`text-xs rounded-lg border px-3 py-2 ${r.last_error ? 'border-red-200 bg-red-50' : 'border-border bg-muted'}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold font-mono">{r.table_name}</span>
                    <span className="px-1.5 py-0.5 bg-white border border-border rounded text-[10px]">{r.operation}</span>
                    <span className="text-text-muted">tentatives: {r.attempts}</span>
                  </div>
                  {r.last_error ? (
                    <p className="text-red-700 font-mono text-[10px] break-all">{r.last_error}</p>
                  ) : (
                    <p className="text-text-muted text-[10px]">En attente sync cloud — données locales OK</p>
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-2 px-5 py-3 border-t border-border">
              <button onClick={handleForceSync} disabled={syncing} className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-500 hover:bg-accent-600 rounded-lg text-xs font-bold">
                <RefreshCw size={11} className={syncing ? 'animate-spin' : ''} /> Réessayer
              </button>
              <button onClick={handleResetFailed} className="flex items-center gap-1.5 px-3 py-1.5 bg-muted hover:bg-border rounded-lg text-xs font-semibold">
                Réinitialiser erreurs
              </button>
              <button onClick={handlePurgeAll} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg text-xs font-semibold ml-auto">
                <X size={11} /> Vider la file
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

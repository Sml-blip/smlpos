import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '../store/appStore'
import { Wifi, WifiOff, Clock, LogOut, CloudOff, RefreshCw, AlertTriangle, CheckCircle2, X, Info } from 'lucide-react'
import { formatPrice } from '../lib/utils'
import FermetureCaisseModal from './FermetureCaisseModal'
import { getPendingCount, getFailedCount, processSyncQueue, pullSyncFromRemote, resetFailedItems, purgeFailedItems } from '../lib/sync'
import { isSupabaseEnabled } from '../lib/supabase'
import { runAction } from '../lib/apiCall'

const api = window.api

type SyncErrorRow = { id: string; table_name: string; operation: string; attempts: number; last_error: string | null; created_at: string }

export default function StatusBar() {
  const { isOnline, currentShift } = useAppStore()
  const [time, setTime] = useState(new Date())
  const [showFermeture, setShowFermeture] = useState(false)
  const [pendingSync, setPendingSync] = useState(0)
  const [failedSync, setFailedSync] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [showFailedMenu, setShowFailedMenu] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [errorRows, setErrorRows] = useState<SyncErrorRow[]>([])
  const [dbHealth, setDbHealth] = useState<{ ok: boolean; error?: string } | null>(null)

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
        <FermetureCaisseModal onClose={() => setShowFermeture(false)} />
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

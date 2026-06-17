import { Download, RefreshCw, AlertTriangle, CheckCircle } from 'lucide-react'
import { cn } from '../lib/utils'
import type { UpdateStatusPayload } from '../lib/useAppUpdater'

interface Props {
  status: UpdateStatusPayload
  currentVersion: string
  onInstall: () => void
  onRetry: () => void
  onDismiss?: () => void
}

export default function UpdateModal({ status, currentVersion, onInstall, onRetry, onDismiss }: Props) {
  const blocking = status.state === 'available' || status.state === 'downloading' || status.state === 'downloaded'
  const canDismiss = status.state === 'error' && onDismiss

  return (
    <div className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-slide-in overflow-hidden">
        <div className="px-6 py-5 border-b border-border bg-accent-50">
          <h2 className="font-bold text-lg text-text-primary">Mise à jour SMLPOS</h2>
          <p className="text-xs text-text-muted mt-1">Version installée : v{currentVersion}</p>
        </div>

        <div className="px-6 py-6 space-y-4">
          {status.state === 'checking' && (
            <div className="flex items-center gap-3 text-sm text-text-secondary">
              <RefreshCw size={18} className="animate-spin text-accent-500" />
              Recherche d&apos;une nouvelle version…
            </div>
          )}

          {status.state === 'available' && (
            <>
              <div className="flex items-start gap-3">
                <Download size={20} className="text-accent-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-text-primary">Version {status.version} disponible</p>
                  <p className="text-sm text-text-secondary mt-1">Téléchargement en cours… Ne fermez pas l&apos;application.</p>
                </div>
              </div>
              {status.releaseNotes && (
                <div className="text-xs text-text-secondary bg-muted rounded-xl p-3 max-h-32 overflow-y-auto whitespace-pre-wrap">
                  {status.releaseNotes}
                </div>
              )}
            </>
          )}

          {status.state === 'downloading' && (
            <>
              <p className="text-sm font-medium text-text-primary">Téléchargement… {Math.round(status.percent)}%</p>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent-500 transition-all duration-300"
                  style={{ width: `${Math.min(100, status.percent)}%` }}
                />
              </div>
              <p className="text-xs text-text-muted">
                {(status.transferred / 1024 / 1024).toFixed(1)} Mo / {(status.total / 1024 / 1024).toFixed(1)} Mo
              </p>
            </>
          )}

          {status.state === 'downloaded' && (
            <div className="flex items-start gap-3">
              <CheckCircle size={22} className="text-success flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-text-primary">Mise à jour prête (v{status.version})</p>
                <p className="text-sm text-text-secondary mt-1">
                  Cliquez ci-dessous pour redémarrer et installer. Vos données locales seront conservées.
                </p>
              </div>
            </div>
          )}

          {status.state === 'error' && (
            <div className="flex items-start gap-3">
              <AlertTriangle size={20} className="text-danger flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-text-primary">Échec de la mise à jour</p>
                <p className="text-sm text-text-secondary mt-1 break-words">{status.message}</p>
                <p className="text-xs text-text-muted mt-2">
                  Vérifiez la connexion Internet et que la release GitHub est publiée (installateur NSIS).
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border flex gap-2 justify-end">
          {canDismiss && (
            <button type="button" onClick={onDismiss} className="px-4 py-2 text-sm border border-border rounded-xl hover:bg-muted">
              Fermer
            </button>
          )}
          {status.state === 'error' && (
            <button type="button" onClick={onRetry} className="px-4 py-2 text-sm bg-accent-500 hover:bg-accent-600 rounded-xl font-semibold">
              Réessayer
            </button>
          )}
          {status.state === 'downloaded' && (
            <button
              type="button"
              onClick={onInstall}
              className={cn('px-5 py-2.5 text-sm bg-accent-500 hover:bg-accent-600 rounded-xl font-bold flex items-center gap-2')}
            >
              <RefreshCw size={14} />
              Redémarrer et installer
            </button>
          )}
        </div>

        {blocking && status.state !== 'downloaded' && (
          <p className="px-6 pb-4 text-[11px] text-center text-text-muted">
            Mise à jour obligatoire — l&apos;application doit être à jour pour continuer.
          </p>
        )}
      </div>
    </div>
  )
}

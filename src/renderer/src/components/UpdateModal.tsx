import { Download, RefreshCw, AlertTriangle, CheckCircle, Sparkles } from 'lucide-react'
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
    <div className="fixed inset-0 z-[200] bg-slate-950/55 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-md animate-slide-in overflow-hidden rounded-3xl border border-white/45 bg-white/82 shadow-[0_24px_80px_rgba(15,23,42,0.35)] backdrop-blur-xl">
        <div className="px-6 py-5 border-b border-white/55 bg-gradient-to-br from-white/90 via-amber-50/80 to-sky-50/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-accent-500 shadow-lg shadow-amber-500/30 flex items-center justify-center">
              <Sparkles size={18} className="text-text-primary" />
            </div>
            <div>
              <h2 className="font-black text-lg text-slate-950">SMLPOS update</h2>
              <p className="text-xs text-slate-500 mt-0.5">Installed version: v{currentVersion}</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-6 space-y-4">
          {status.state === 'checking' && (
            <div className="flex items-center gap-3 text-sm text-text-secondary">
              <RefreshCw size={18} className="animate-spin text-accent-500" />
              Checking for a new version...
            </div>
          )}

          {status.state === 'available' && (
            <>
              <div className="flex items-start gap-3">
                <Download size={20} className="text-accent-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-text-primary">Version {status.version} is available</p>
                  <p className="text-sm text-text-secondary mt-1">Downloading now. Keep SMLPOS open until it finishes.</p>
                </div>
              </div>
              {status.releaseNotes && (
                <div className="text-xs text-text-secondary bg-white/65 border border-white/70 rounded-xl p-3 max-h-32 overflow-y-auto whitespace-pre-wrap">
                  {status.releaseNotes}
                </div>
              )}
            </>
          )}

          {status.state === 'downloading' && (
            <>
              <p className="text-sm font-medium text-text-primary">Downloading... {Math.round(status.percent)}%</p>
              <div className="h-2.5 bg-white/70 border border-white rounded-full overflow-hidden shadow-inner">
                <div
                  className="h-full bg-gradient-to-r from-accent-500 to-sky-400 transition-all duration-300"
                  style={{ width: `${Math.min(100, status.percent)}%` }}
                />
              </div>
              <p className="text-xs text-text-muted">
                {(status.transferred / 1024 / 1024).toFixed(1)} MB / {(status.total / 1024 / 1024).toFixed(1)} MB
              </p>
            </>
          )}

          {status.state === 'downloaded' && (
            <div className="flex items-start gap-3">
              <CheckCircle size={22} className="text-success flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-text-primary">Update ready (v{status.version})</p>
                <p className="text-sm text-text-secondary mt-1">
                  Restart to install. Local data is preserved.
                </p>
              </div>
            </div>
          )}

          {status.state === 'error' && (
            <div className="flex items-start gap-3">
              <AlertTriangle size={20} className="text-danger flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-text-primary">Update failed</p>
                <p className="text-sm text-text-secondary mt-1 break-words">{status.message}</p>
                <p className="text-xs text-text-muted mt-2">
                  Check the internet connection and that the GitHub release is published.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-white/60 bg-white/45 flex gap-2 justify-end">
          {canDismiss && (
            <button type="button" onClick={onDismiss} className="px-4 py-2 text-sm border border-white/80 bg-white/65 rounded-xl hover:bg-white">
              Close
            </button>
          )}
          {status.state === 'error' && (
            <button type="button" onClick={onRetry} className="px-4 py-2 text-sm bg-accent-500 hover:bg-accent-600 rounded-xl font-semibold shadow-sm">
              Retry
            </button>
          )}
          {status.state === 'downloaded' && (
            <button
              type="button"
              onClick={onInstall}
              className={cn('px-5 py-2.5 text-sm bg-accent-500 hover:bg-accent-600 rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-amber-500/25')}
            >
              <RefreshCw size={14} />
              Restart and install
            </button>
          )}
        </div>

        {blocking && status.state !== 'downloaded' && (
          <p className="px-6 pb-4 text-[11px] text-center text-slate-500 bg-white/45">
            Required update: SMLPOS must finish updating before continuing.
          </p>
        )}
      </div>
    </div>
  )
}

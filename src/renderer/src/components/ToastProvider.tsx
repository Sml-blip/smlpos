import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'
import { cn } from '../lib/utils'
import { useToastStore } from '../lib/toast'

export default function ToastProvider() {
  const { toasts, dismissToast } = useToastStore()

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-16 right-4 z-[300] flex flex-col gap-2 max-w-sm pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto flex items-start gap-2 px-4 py-3 rounded-xl shadow-lg border text-sm animate-slide-in',
            t.type === 'success' && 'bg-green-50 border-green-200 text-green-900',
            t.type === 'error' && 'bg-red-50 border-red-200 text-red-900',
            t.type === 'info' && 'bg-white border-border text-text-primary'
          )}
        >
          {t.type === 'success' && <CheckCircle2 size={16} className="flex-shrink-0 mt-0.5 text-green-600" />}
          {t.type === 'error' && <AlertCircle size={16} className="flex-shrink-0 mt-0.5 text-red-600" />}
          {t.type === 'info' && <Info size={16} className="flex-shrink-0 mt-0.5 text-accent-600" />}
          <span className="flex-1">{t.message}</span>
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            className="flex-shrink-0 opacity-60 hover:opacity-100"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}

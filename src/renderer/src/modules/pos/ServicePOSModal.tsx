import { useEffect, useState } from 'react'
import { useAppStore } from '../../store/appStore'
import type { ServicePOS } from '../../lib/types'
import { generateId } from '../../lib/utils'
import { runAction } from '../../lib/apiCall'
import { X, CheckCircle, BriefcaseBusiness, History } from 'lucide-react'

const api = window.api

interface Props {
  service: ServicePOS
  onClose: () => void
  onConfirm: (service: ServicePOS, montantFrais: number, note: string) => void
}

const SERVICE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  'enda taw': { bg: 'bg-green-50', text: 'text-green-800', border: 'border-green-300' },
  'ooredoo':  { bg: 'bg-red-50',   text: 'text-red-800',   border: 'border-red-300'   },
  'orange':   { bg: 'bg-orange-50', text: 'text-orange-800', border: 'border-orange-300' },
  'autre service': { bg: 'bg-violet-50', text: 'text-violet-800', border: 'border-violet-300' },
}

export default function ServicePOSModal({ service, onClose, onConfirm }: Props) {
  const { currentShift } = useAppStore()
  const [montant, setMontant] = useState('')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [noteSuggestions, setNoteSuggestions] = useState<string[]>([])

  const color = SERVICE_COLORS[service.nom.toLowerCase()] ?? { bg: 'bg-blue-50', text: 'text-blue-800', border: 'border-blue-300' }
  const montantNum = parseFloat(montant.replace(',', '.')) || 0
  const isOtherService = service.id === 'svc-autre' || service.nom.toLowerCase() === 'autre service'
  const canConfirm = montantNum > 0 && (!isOtherService || note.trim().length > 0)

  useEffect(() => {
    let active = true
    api.transactionsServicesNoteSuggestions(service.id)
      .then(rows => {
        if (active) setNoteSuggestions(rows.map(row => row.note).filter(Boolean))
      })
      .catch(error => console.error('[ServicePOS] Note suggestions failed:', error))
    return () => { active = false }
  }, [service.id])

  const handleConfirm = async () => {
    if (!canConfirm) return
    await runAction('Enregistrement service', async () => {
      const now = new Date().toISOString()
      const t = {
        id: generateId(),
        shift_id: currentShift?.id,
        service_id: service.id,
        service_nom: service.nom,
        montant_frais: montantNum,
        note: note.trim() || null,
        operateur: currentShift?.operateur_nom,
        created_at: now,
      }
      await api.transactionsServicesCreate(t)
      onConfirm(service, montantNum, note.trim())
    }, { setLoading, successMessage: `${service.nom} enregistré` })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-[420px] animate-slide-in">
        {/* Header */}
        <div className={`px-6 py-5 rounded-t-2xl border-b ${color.bg} ${color.border} flex items-center justify-between`}>
          <div>
            <div className="text-2xl mb-1">
              {isOtherService ? <BriefcaseBusiness size={26} /> : '🏦'}
            </div>
            <h2 className={`font-bold text-lg ${color.text}`}>{service.nom}</h2>
            <p className="text-sm text-text-secondary">{isOtherService ? 'Service libre' : 'Service financier'}</p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Amount */}
          <div>
            <label className="block text-sm font-semibold text-text-primary mb-2">
              {isOtherService ? 'Prix du service' : 'Frais de service'} <span className="text-danger">*</span>
            </label>
            <div className="flex items-center gap-2 bg-muted border border-border rounded-xl px-4 py-3 focus-within:border-accent-500 focus-within:bg-accent-50 transition-colors">
              <input
                type="text"
                inputMode="decimal"
                value={montant}
                onChange={e => setMontant(e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.'))}
                className="flex-1 bg-transparent font-price text-xl font-bold outline-none"
                placeholder="0.000"
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter' && canConfirm) handleConfirm() }}
              />
              <span className="text-text-secondary font-semibold">DT</span>
            </div>
          </div>

          {/* Note */}
          <div>
            <label className="block text-sm font-semibold text-text-primary mb-2">
              {isOtherService ? 'Note du service' : 'Note / Référence'}
              {isOtherService && <span className="text-danger"> *</span>}
            </label>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              className="w-full border border-border rounded-xl px-4 py-3 text-sm focus:border-accent-500 outline-none"
              placeholder={isOtherService ? 'Ex : Installation logiciel, livraison…' : 'Ex : N° compte client, référence transaction…'}
              onKeyDown={e => { if (e.key === 'Enter' && canConfirm) handleConfirm() }}
            />
            {noteSuggestions.length > 0 && (
              <div className="mt-2">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-text-muted mb-1.5">
                  <History size={12} /> Notes rapides utilisées récemment
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {noteSuggestions.slice(0, 8).map(suggestion => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => setNote(suggestion)}
                      title={suggestion}
                      className="max-w-full truncate rounded-full border border-border bg-muted hover:bg-accent-50 hover:border-accent-300 px-2.5 py-1 text-[11px] font-medium text-text-secondary transition-colors"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 bg-muted hover:bg-border text-text-primary font-semibold py-2.5 rounded-xl transition-colors text-sm"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading || !canConfirm}
            className="flex-1 bg-accent-500 hover:bg-accent-600 disabled:bg-gray-200 disabled:text-gray-400 text-text-primary font-bold py-2.5 rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
          >
            <CheckCircle size={15} />
            {loading ? 'Enregistrement...' : 'Confirmer'}
          </button>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Hash, X } from 'lucide-react'
import { syncSerialNumsForQty } from './factureAchatTypes'

type Props = {
  designation: string
  quantite: number
  numeros_serie?: string[]
  onSave: (nums: string[]) => void
  onClose: () => void
}

export default function FactureSerialModal({
  designation,
  quantite,
  numeros_serie,
  onSave,
  onClose,
}: Props) {
  const qty = Math.max(1, quantite)
  const [nums, setNums] = useState(() => syncSerialNumsForQty(numeros_serie, qty))

  useEffect(() => {
    setNums(syncSerialNumsForQty(numeros_serie, qty))
  }, [quantite, numeros_serie, qty])

  const filled = nums.filter(s => s.trim()).length

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-slide-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <Hash size={16} className="text-amber-700 flex-shrink-0" />
            <div className="min-w-0">
              <h3 className="font-bold text-sm">Numéros de série</h3>
              <p className="text-xs text-text-muted truncate">{designation || 'Ligne sans désignation'}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-3 bg-amber-50 border-b border-amber-100 text-xs text-amber-900">
          Quantité <strong>{qty}</strong> — renseignez <strong>{qty}</strong> numéro{qty > 1 ? 's' : ''} de série ({filled}/{qty})
        </div>

        <div className="max-h-[50vh] overflow-y-auto divide-y divide-border">
          {nums.map((sn, i) => (
            <div key={i} className="flex items-center gap-2 px-5 py-2.5">
              <span className="text-[11px] font-bold text-text-muted w-7 text-center flex-shrink-0">#{i + 1}</span>
              <input
                value={sn}
                onChange={e => {
                  const next = [...nums]
                  next[i] = e.target.value
                  setNums(next)
                }}
                className="flex-1 border border-border rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-accent-500"
                placeholder={`S/N unité ${i + 1}…`}
                autoFocus={i === 0}
              />
            </div>
          ))}
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl bg-muted hover:bg-border font-semibold text-sm"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() => onSave(nums.map(s => s.trim()))}
            className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm"
          >
            Enregistrer S/N
          </button>
        </div>
      </div>
    </div>
  )
}

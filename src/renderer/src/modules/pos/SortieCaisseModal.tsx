import { useState, useEffect } from 'react'
import { useAppStore } from '../../store/appStore'
import { generateId } from '../../lib/utils'
import { loadData, runAction } from '../../lib/apiCall'
import { X, ArrowDownCircle, BookmarkCheck } from 'lucide-react'

const api = window.api

export default function SortieCaisseModal({ onClose }: { onClose: () => void }) {
  const { currentShift } = useAppStore()
  const [montant, setMontant] = useState('')
  const [note, setNote] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadData('Chargement suggestions', () => api.sortiesRecentNotes(), { silent: true }).then(notes => {
      if (notes) setSuggestions(notes as string[])
    })
  }, [])

  const filteredSuggestions = note.length < 2
    ? suggestions
    : suggestions.filter(s => s.toLowerCase().includes(note.toLowerCase()))

  const handleConfirm = async () => {
    const m = parseFloat(montant) || 0
    if (m <= 0) return
    await runAction('Sortie de caisse', async () => {
      const sortie = {
        id: generateId(),
        shift_id: currentShift?.id,
        montant: m,
        note: note.trim(),
        operateur: currentShift?.operateur_nom,
        created_at: new Date().toISOString(),
      }
      await api.sortiesCreate(sortie)
      onClose()
    }, { setLoading, successMessage: 'Sortie de caisse enregistrée' })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-[420px] animate-slide-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-bold flex items-center gap-2"><ArrowDownCircle size={16} /> Sortie de Caisse</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary"><X size={18} /></button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Montant (DT) <span className="text-danger">*</span></label>
            <div className="flex items-center gap-2 border border-border rounded-xl px-4 py-3 focus-within:border-accent-500">
              <input
                type="text"
                inputMode="decimal"
                value={montant}
                onChange={e => setMontant(e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.'))}
                className="flex-1 bg-transparent font-price text-lg font-semibold outline-none"
                placeholder="0.000"
                autoFocus
              />
              <span className="text-text-secondary font-medium">DT</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Motif / Note <span className="text-danger">*</span></label>
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              className="w-full border border-border rounded-xl px-4 py-3 text-sm"
              placeholder="Décrire la raison..."
            />
          </div>

          {/* Suggestions */}
          {filteredSuggestions.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-text-secondary mb-2 flex items-center gap-1"><BookmarkCheck size={11} /> Suggestions</p>
              <div className="flex flex-wrap gap-2">
                {filteredSuggestions.slice(0, 5).map((s, i) => (
                  <button key={i} onClick={() => setNote(s)}
                    className="px-3 py-1.5 bg-muted hover:bg-accent-50 border border-border hover:border-accent-300 rounded-lg text-xs font-medium transition-colors">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-border">
          <button type="button" onClick={onClose} className="flex-1 bg-muted hover:bg-border text-text-primary font-semibold py-2.5 rounded-xl transition-colors">Annuler</button>
          <button type="button" onClick={handleConfirm} disabled={!montant || loading}
            className="flex-1 bg-accent-500 hover:bg-accent-600 disabled:bg-gray-200 disabled:text-gray-400 text-text-primary font-bold py-2.5 rounded-xl transition-colors">
            {loading ? 'Confirmation...' : 'Confirmer'}
          </button>
        </div>
      </div>
    </div>
  )
}

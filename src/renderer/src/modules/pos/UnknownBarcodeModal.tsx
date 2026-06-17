import { useState } from 'react'
import type { Produit } from '../../lib/types'
import { generateId, generateReference } from '../../lib/utils'
import { runAction } from '../../lib/apiCall'
import { AlertCircle, X } from 'lucide-react'

const api = window.api

const CATEGORIES = ['Électronique', 'Informatique', 'Accessoires', 'Pièces', 'Autre']

interface Props {
  barcode: string
  onClose: () => void
  onProductCreated: (p: Produit) => void
  onFreeAdd: (designation: string, prix: number) => void
}

export default function UnknownBarcodeModal({ barcode, onClose, onProductCreated, onFreeAdd }: Props) {
  const [nom, setNom] = useState('')
  const [prix, setPrix] = useState('')
  const [type, setType] = useState<'F' | 'NF'>('F')
  const [categorie, setCategorie] = useState('Électronique')
  const [loading, setLoading] = useState(false)

  const handleCreate = async () => {
    if (!nom.trim() || !prix) return
    await runAction('Création produit', async () => {
      const now = new Date().toISOString()
      const produit: Produit = {
        id: generateId(),
        code_barre: barcode,
        reference: generateReference(),
        nom: nom.trim(),
        categorie,
        type,
        prix_vente: parseFloat(prix) || 0,
        stock_actuel: 0,
        stock_minimum: 5,
        actif: 1,
        created_at: now,
        updated_at: now,
      }
      await api.produitsCreate({
        ...produit,
        description: null,
        prix_achat: null,
        tva_taux: 0,
        fournisseur: null,
      })
      onProductCreated(produit)
    }, { setLoading, successMessage: 'Produit créé et ajouté' })
  }

  const handleFreeAdd = () => {
    if (!nom.trim() || !prix) return
    onFreeAdd(nom.trim(), parseFloat(prix) || 0)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-[460px] animate-slide-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="text-warning" />
            <h2 className="font-bold">Code-barres inconnu</h2>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary"><X size={18} /></button>
        </div>

        <div className="p-6">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-5 text-sm text-yellow-800 font-mono">
            {barcode}
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Nom du produit <span className="text-danger">*</span></label>
              <input value={nom} onChange={e => setNom(e.target.value)} className="w-full border border-border rounded-xl px-4 py-2.5 text-sm" placeholder="Nom du produit..." autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">Prix unitaire (DT) <span className="text-danger">*</span></label>
                <input type="text" inputMode="decimal" value={prix} onChange={e => setPrix(e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.'))} className="w-full border border-border rounded-xl px-4 py-2.5 text-sm font-price" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">Catégorie</label>
                <select value={categorie} onChange={e => setCategorie(e.target.value)} className="w-full border border-border rounded-xl px-3 py-2.5 text-sm">
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-2">Type</label>
              <div className="flex gap-3">
                <button onClick={() => setType('F')} className={`flex-1 py-2 rounded-xl border text-sm font-semibold transition-colors ${type === 'F' ? 'border-green-400 bg-green-50 text-green-700' : 'border-border hover:bg-muted'}`}>
                  🟢 Facturé (F)
                </button>
                <button onClick={() => setType('NF')} className={`flex-1 py-2 rounded-xl border text-sm font-semibold transition-colors ${type === 'NF' ? 'border-red-400 bg-red-50 text-red-700' : 'border-border hover:bg-muted'}`}>
                  🔴 Non Facturé (NF)
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-6">
            <button type="button" onClick={handleCreate} disabled={!nom.trim() || !prix || loading}
              className="bg-accent-500 hover:bg-accent-600 disabled:bg-gray-200 disabled:text-gray-400 text-text-primary font-bold py-2.5 rounded-xl transition-colors text-sm">
              {loading ? '...' : 'Créer & Ajouter'}
            </button>
            <button type="button" onClick={handleFreeAdd} disabled={!nom.trim() || !prix}
              className="bg-muted hover:bg-border disabled:opacity-50 text-text-primary font-semibold py-2.5 rounded-xl transition-colors text-sm border border-border">
              Vente Libre
            </button>
          </div>
          <button type="button" onClick={onClose} className="w-full mt-2 text-sm text-text-muted hover:text-text-secondary py-2">Annuler</button>
        </div>
      </div>
    </div>
  )
}

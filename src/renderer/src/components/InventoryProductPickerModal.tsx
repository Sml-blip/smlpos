import { useState, useEffect, useMemo } from 'react'
import Fuse from 'fuse.js'
import type { Produit } from '../lib/types'
import { cn, formatPrice } from '../lib/utils'
import { loadData } from '../lib/apiCall'
import { Search, X, Plus, Package, RefreshCw } from 'lucide-react'

const api = window.api

export type ProductPickerFilter = 'all' | 'F' | 'NF'

interface Props {
  title?: string
  /** Restrict catalog rows (e.g. F-only for factures vente) */
  productFilter?: ProductPickerFilter
  onAddProduct: (p: Produit) => void
  onClose: () => void
}

export default function InventoryProductPickerModal({
  title = 'Ajouter depuis l\'inventaire',
  productFilter = 'all',
  onAddProduct,
  onClose,
}: Props) {
  const [produits, setProduits] = useState<Produit[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [filterType, setFilterType] = useState<ProductPickerFilter>(productFilter)
  const [addedIds, setAddedIds] = useState<string[]>([])

  useEffect(() => {
    void loadData('Chargement inventaire', async () => {
      const list = await api.produitsList({ actif: 1 }) as Produit[]
      setProduits(list || [])
    }, { setLoading, silent: true })
  }, [])

  useEffect(() => { setFilterType(productFilter) }, [productFilter])

  const fuseIndex = useMemo(() => new Fuse(produits, {
    keys: ['nom', 'reference', 'code_barre', 'categorie'],
    threshold: 0.35,
    minMatchCharLength: 2,
    ignoreLocation: true,
  }), [produits])

  const list = useMemo(() => {
    const qTrim = q.trim()
    if (qTrim) {
      const exact = produits.find(p => p.code_barre === qTrim)
      if (exact) {
        const okType = filterType === 'all' || exact.type === filterType
        if (okType) return [exact]
      }
    }
    const base = q.length >= 2 ? fuseIndex.search(q, { limit: 150 }).map(r => r.item) : [...produits]
    return base.filter(p => filterType === 'all' || p.type === filterType)
  }, [q, filterType, produits, fuseIndex])

  const handleAdd = (p: Produit) => {
    onAddProduct(p)
    setAddedIds(prev => (prev.includes(p.id) ? prev : [...prev, p.id]))
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    const qTrim = q.trim()
    if (!qTrim) return
    const exact = produits.find(p => p.code_barre === qTrim)
    if (exact && (filterType === 'all' || exact.type === filterType)) {
      handleAdd(exact)
      setQ('')
    } else if (list.length === 1) {
      handleAdd(list[0])
      setQ('')
    }
  }

  const showTypeFilters = productFilter === 'all'

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-[160] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[88vh] flex flex-col animate-slide-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="font-bold text-sm flex items-center gap-2">
            <Package size={15} className="text-accent-500" /> {title}
          </h3>
          <button type="button" onClick={onClose} aria-label="Fermer"><X size={18} className="text-text-muted" /></button>
        </div>

        <div className="px-5 py-3 border-b border-border flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px] flex items-center gap-2 border border-border rounded-lg px-3 py-2 bg-muted">
            <Search size={14} className="text-text-muted flex-shrink-0" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="flex-1 bg-transparent text-sm outline-none"
              placeholder="Rechercher ou scanner code-barres..."
              autoFocus
            />
          </div>
          {showTypeFilters && (['all', 'F', 'NF'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setFilterType(t)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                filterType === t ? 'bg-accent-500 text-text-primary' : 'bg-muted hover:bg-border text-text-secondary',
              )}
            >
              {t === 'all' ? 'Tous' : t}
            </button>
          ))}
          {!showTypeFilters && (
            <span className="text-xs text-text-muted">Produits {productFilter} uniquement</span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-text-muted gap-2">
              <RefreshCw size={18} className="animate-spin" /> Chargement...
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted border-b border-border">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold text-text-secondary">Réf</th>
                  <th className="text-left px-4 py-2 font-semibold text-text-secondary">Nom</th>
                  <th className="text-center px-3 py-2 font-semibold text-text-secondary">Type</th>
                  <th className="text-center px-3 py-2 font-semibold text-text-secondary">Stock</th>
                  <th className="text-right px-4 py-2 font-semibold text-text-secondary">Prix vente</th>
                  <th className="text-right px-4 py-2 font-semibold text-text-secondary">Prix achat</th>
                  <th className="w-24 px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.slice(0, 200).map(p => (
                  <tr key={p.id} className="hover:bg-muted/50">
                    <td className="px-4 py-2 font-mono text-text-muted">{p.reference}</td>
                    <td className="px-4 py-2 font-medium max-w-[220px] truncate" title={p.nom}>{p.nom}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={p.type === 'F' ? 'badge-F text-[9px]' : 'badge-NF text-[9px]'}>{p.type}</span>
                    </td>
                    <td className={cn('px-3 py-2 text-center font-price', p.stock_actuel <= p.stock_minimum && 'text-red-600 font-bold')}>
                      {p.stock_actuel}
                    </td>
                    <td className="px-4 py-2 text-right font-price font-semibold">{formatPrice(p.prix_vente)}</td>
                    <td className="px-4 py-2 text-right font-price text-text-muted">{formatPrice(p.prix_achat ?? 0)}</td>
                    <td className="px-3 py-2">
                      {addedIds.includes(p.id) ? (
                        <span className="flex items-center justify-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-lg text-[10px] font-bold">
                          ✓ Ajouté
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleAdd(p)}
                          className="flex items-center justify-center gap-1 w-full px-2 py-1 bg-accent-500 hover:bg-accent-600 rounded-lg text-[10px] font-bold transition-colors"
                        >
                          <Plus size={10} /> Ajouter
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {!loading && list.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-text-muted">Aucun produit trouvé</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-between flex-shrink-0">
          <span className="text-xs text-text-muted">
            {list.length} produit(s)
            {addedIds.length > 0 && ` · ${addedIds.length} ajouté(s) cette session`}
          </span>
          <button type="button" onClick={onClose} className="px-4 py-2 bg-accent-500 hover:bg-accent-600 rounded-xl text-xs font-bold">
            Terminer{addedIds.length > 0 ? ` (${addedIds.length})` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}

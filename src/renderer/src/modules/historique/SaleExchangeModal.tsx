import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Barcode, Check, Minus, PackageSearch, Plus, Repeat2, ScanBarcode, X } from 'lucide-react'
import type { LigneVente, Produit, Vente } from '../../lib/types'
import { cn, formatPrice, generateId } from '../../lib/utils'
import { loadData } from '../../lib/apiCall'

type ProductWithAvailability = Produit & { stock_disponible_vente?: number }

type ReturnSelection = {
  quantity: number
  serial_numbers: string[]
}

type ReplacementSelection = {
  id: string
  product: ProductWithAvailability
  quantity: number
  availableSerials: string[]
  serial_numbers: string[]
}

export type ExchangeResult = {
  success?: boolean
  error?: string
  oldTotal?: number
  newTotal?: number
  difference?: number
  updatedDocuments?: Array<{ id: string; numero: string; type: string }>
}

function splitSerials(value?: string): string[] {
  return String(value ?? '').split(/[\n,;|]+/).map(serial => serial.trim()).filter(Boolean)
}

export default function SaleExchangeModal({
  vente,
  onClose,
  onConfirm,
}: {
  vente: Vente
  onClose: () => void
  onConfirm: (payload: { returns: Array<Record<string, unknown>>; replacements: Array<Record<string, unknown>> }) => Promise<void>
}) {
  const [lines, setLines] = useState<LigneVente[]>([])
  const [products, setProducts] = useState<ProductWithAvailability[]>([])
  const [returns, setReturns] = useState<Record<string, ReturnSelection>>({})
  const [replacements, setReplacements] = useState<ReplacementSelection[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    void loadData('Préparation échange', async () => {
      const [saleLines, productRows] = await Promise.all([
        window.api.ventesGetLignes(vente.id) as Promise<LigneVente[]>,
        window.api.produitsList({}) as Promise<ProductWithAvailability[]>,
      ])
      return { saleLines, productRows }
    }, { setLoading }).then(result => {
      if (!active || !result) return
      setLines(result.saleLines)
      setProducts(result.productRows)
    })
    return () => { active = false }
  }, [vente.id])

  const searchResults = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('fr')
    if (!needle) return []
    return products.filter(product => [product.nom, product.reference, product.code_barre]
      .some(value => String(value ?? '').toLocaleLowerCase('fr').includes(needle))).slice(0, 8)
  }, [products, query])

  const setReturnQuantity = (line: LigneVente, quantity: number) => {
    const next = Math.max(0, Math.min(line.quantite, quantity))
    setReturns(current => {
      if (next === 0) {
        const copy = { ...current }
        delete copy[line.id]
        return copy
      }
      const serials = splitSerials(line.numero_serie)
      return { ...current, [line.id]: { quantity: next, serial_numbers: serials.slice(0, next) } }
    })
  }

  const toggleReturnedSerial = (line: LigneVente, serial: string) => {
    setReturns(current => {
      const selected = current[line.id]?.serial_numbers ?? []
      const exists = selected.includes(serial)
      const serial_numbers = exists ? selected.filter(value => value !== serial) : [...selected, serial]
      if (serial_numbers.length === 0) {
        const copy = { ...current }
        delete copy[line.id]
        return copy
      }
      return { ...current, [line.id]: { quantity: serial_numbers.length, serial_numbers } }
    })
  }

  const addReplacement = async (product: ProductWithAvailability) => {
    setError('')
    const stock = Number(product.stock_disponible_vente ?? product.stock_actuel ?? 0)
    if (stock <= 0) { setError(`${product.nom} : stock indisponible`); return }
    const existing = replacements.find(item => item.product.id === product.id)
    if (existing && !product.has_serial_number) {
      setReplacements(current => current.map(item => item.id === existing.id
        ? { ...item, quantity: Math.min(stock, item.quantity + 1) }
        : item))
      setQuery('')
      return
    }
    let availableSerials: string[] = []
    if (product.has_serial_number || product.numero_serie) {
      const rows = await window.api.serialNumbersGetByProduit(product.id) as Array<{ numero_serie: string; statut: string }>
      const alreadySelected = new Set(replacements
        .filter(item => item.product.id === product.id)
        .flatMap(item => item.serial_numbers))
      availableSerials = rows
        .filter(row => String(row.statut).toUpperCase() === 'EN_STOCK')
        .map(row => String(row.numero_serie).trim())
        .filter(serial => serial && !alreadySelected.has(serial))
      if (availableSerials.length === 0) { setError(`${product.nom} : aucun S/N disponible`); return }
    }
    setReplacements(current => [...current, {
      id: generateId(), product, quantity: 1, availableSerials,
      serial_numbers: availableSerials.length ? [availableSerials[0]] : [],
    }])
    setQuery('')
    window.setTimeout(() => searchRef.current?.focus(), 0)
  }

  const scanOrAdd = async () => {
    const value = query.trim()
    if (!value) return
    const exact = await window.api.produitsFindByBarcode(value) as ProductWithAvailability | null
    if (exact) { await addReplacement(exact); return }
    if (searchResults.length === 1) { await addReplacement(searchResults[0]); return }
    setError('Code-barres ou produit introuvable')
  }

  const updateReplacementQuantity = (id: string, quantity: number) => {
    setReplacements(current => current.map(item => {
      if (item.id !== id) return item
      const max = Math.max(1, Math.min(Number(item.product.stock_disponible_vente ?? item.product.stock_actuel ?? 1), item.availableSerials.length || Number.MAX_SAFE_INTEGER))
      const next = Math.max(1, Math.min(max, quantity))
      return {
        ...item,
        quantity: next,
        serial_numbers: item.availableSerials.length ? item.availableSerials.slice(0, next) : [],
      }
    }))
  }

  const setReplacementSerial = (id: string, index: number, serial: string) => {
    setReplacements(current => current.map(item => {
      if (item.id !== id) return item
      const next = [...item.serial_numbers]
      next[index] = serial
      return { ...item, serial_numbers: next }
    }))
  }

  const returnedTotal = lines.reduce((sum, line) => {
    const selected = returns[line.id]?.quantity ?? 0
    return sum + (line.quantite > 0 ? Number(line.total_ligne || 0) / line.quantite : 0) * selected
  }, 0)
  const replacementTotal = replacements.reduce((sum, item) => sum + Number(item.product.prix_vente || 0) * item.quantity, 0)
  const difference = replacementTotal - returnedTotal
  const estimatedNewTotal = Math.max(0, Number(vente.total_ttc || 0) + difference)
  const hasSelection = Object.keys(returns).length > 0 && replacements.length > 0

  const submit = async () => {
    setError('')
    if (!hasSelection) { setError('Choisissez les articles retournés et les produits de remplacement'); return }
    for (const item of replacements) {
      if (item.availableSerials.length && (item.serial_numbers.length !== item.quantity || new Set(item.serial_numbers).size !== item.quantity)) {
        setError(`${item.product.nom} : choisissez ${item.quantity} S/N différent(s)`)
        return
      }
    }
    setSaving(true)
    try {
      await onConfirm({
        returns: Object.entries(returns).map(([line_id, selection]) => ({ line_id, ...selection })),
        replacements: replacements.map(item => ({
          product_id: item.product.id,
          quantity: item.quantity,
          serial_numbers: item.serial_numbers,
        })),
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Échange impossible')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/55 p-4" role="dialog" aria-modal="true" aria-labelledby="exchange-title">
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 id="exchange-title" className="flex items-center gap-2 font-bold"><Repeat2 size={18} className="text-blue-600" /> Échanger des articles</h2>
            <p className="mt-0.5 text-xs text-text-muted">{vente.numero} · total actuel {formatPrice(vente.total_ttc)}</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Fermer"><X size={19} /></button>
        </div>

        <div className="grid flex-1 gap-0 overflow-hidden lg:grid-cols-2">
          <section className="overflow-y-auto border-b border-border p-5 lg:border-b-0 lg:border-r">
            <div className="mb-3">
              <h3 className="text-sm font-bold">1. Articles rendus</h3>
              <p className="text-xs text-text-muted">Sélectionnez un ou plusieurs articles et leur quantité.</p>
            </div>
            {loading ? <p className="py-8 text-center text-sm text-text-muted">Chargement…</p> : (
              <div className="space-y-2">
                {lines.map(line => {
                  const selected = returns[line.id]
                  const serials = splitSerials(line.numero_serie)
                  return <div key={line.id} className={cn('rounded-xl border p-3 transition-colors', selected ? 'border-blue-400 bg-blue-50' : 'border-border')}>
                    <div className="flex items-start gap-3">
                      <button type="button" onClick={() => setReturnQuantity(line, selected ? 0 : 1)} aria-label={`${selected ? 'Retirer' : 'Sélectionner'} ${line.designation}`}
                        className={cn('mt-0.5 flex h-5 w-5 items-center justify-center rounded border', selected ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300')}>
                        {selected ? <Check size={13} /> : null}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2"><b className="text-sm">{line.designation}</b><span className="font-price text-xs">{formatPrice(line.total_ligne)}</span></div>
                        <p className="text-[11px] text-text-muted">Qté vendue {line.quantite} · {formatPrice(line.prix_unitaire)} / unité</p>
                      </div>
                    </div>
                    {selected && serials.length === 0 ? <div className="mt-3 flex items-center justify-end gap-2">
                      <button type="button" onClick={() => setReturnQuantity(line, selected.quantity - 1)} className="rounded-lg border p-1"><Minus size={13} /></button>
                      <span className="min-w-8 text-center font-price text-sm font-bold">{selected.quantity}</span>
                      <button type="button" onClick={() => setReturnQuantity(line, selected.quantity + 1)} className="rounded-lg border p-1"><Plus size={13} /></button>
                    </div> : null}
                    {serials.length > 0 ? <div className="mt-3 flex flex-wrap gap-1.5">
                      {serials.map(serial => {
                        const checked = selected?.serial_numbers.includes(serial) ?? false
                        return <button key={serial} type="button" onClick={() => toggleReturnedSerial(line, serial)}
                          className={cn('rounded-lg border px-2 py-1 font-mono text-[10px]', checked ? 'border-blue-500 bg-blue-600 text-white' : 'border-border bg-white')}>
                          S/N {serial}
                        </button>
                      })}
                    </div> : null}
                  </div>
                })}
              </div>
            )}
          </section>

          <section className="overflow-y-auto p-5">
            <div className="mb-3">
              <h3 className="text-sm font-bold">2. Produits de remplacement</h3>
              <p className="text-xs text-text-muted">Scannez le code-barres ou recherchez dans l’inventaire.</p>
            </div>
            <div className="relative">
              <div className="flex gap-2">
                <div className="relative flex-1"><Barcode className="absolute left-3 top-2.5 text-text-muted" size={15} /><input ref={searchRef} value={query} autoFocus
                  onChange={event => { setQuery(event.target.value); setError('') }} onKeyDown={event => { if (event.key === 'Enter') void scanOrAdd() }}
                  className="w-full rounded-xl border border-border py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500" placeholder="Scanner ou saisir nom / référence…" /></div>
                <button type="button" onClick={() => void scanOrAdd()} className="rounded-xl bg-blue-600 px-3 text-white" aria-label="Rechercher le code-barres"><ScanBarcode size={17} /></button>
              </div>
              {query.trim() && searchResults.length > 0 ? <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-border bg-white p-1 shadow-xl">
                {searchResults.map(product => <button key={product.id} type="button" onClick={() => void addReplacement(product)} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-muted">
                  <span><b className="block text-xs">{product.nom}</b><small className="text-text-muted">{product.reference} · stock {product.stock_disponible_vente ?? product.stock_actuel}</small></span>
                  <span className="font-price text-xs font-bold">{formatPrice(product.prix_vente)}</span>
                </button>)}
              </div> : null}
            </div>

            <div className="mt-4 space-y-2">
              {replacements.length === 0 ? <div className="rounded-xl border border-dashed border-border py-8 text-center text-text-muted"><PackageSearch className="mx-auto mb-2 opacity-40" /><p className="text-xs">Aucun remplacement ajouté</p></div> : replacements.map(item => (
                <div key={item.id} className="rounded-xl border border-green-300 bg-green-50 p-3">
                  <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><b className="text-sm">{item.product.nom}</b><p className="text-[11px] text-text-muted">{formatPrice(item.product.prix_vente)} / unité</p></div>
                    <div className="flex items-center gap-1"><button type="button" onClick={() => updateReplacementQuantity(item.id, item.quantity - 1)} className="rounded border bg-white p-1"><Minus size={12} /></button><b className="min-w-6 text-center text-xs">{item.quantity}</b><button type="button" onClick={() => updateReplacementQuantity(item.id, item.quantity + 1)} className="rounded border bg-white p-1"><Plus size={12} /></button></div>
                    <button type="button" onClick={() => setReplacements(current => current.filter(row => row.id !== item.id))} aria-label={`Supprimer ${item.product.nom}`} className="text-red-600"><X size={16} /></button>
                  </div>
                  {item.availableSerials.length > 0 ? <div className="mt-2 grid gap-1.5">
                    {Array.from({ length: item.quantity }, (_, index) => <select key={index} value={item.serial_numbers[index] ?? ''} onChange={event => setReplacementSerial(item.id, index, event.target.value)} className="rounded-lg border border-green-300 bg-white px-2 py-1.5 font-mono text-xs">
                      <option value="">— S/N unité {index + 1} —</option>
                      {item.availableSerials.map(serial => <option key={serial} value={serial} disabled={item.serial_numbers.some((chosen, chosenIndex) => chosenIndex !== index && chosen === serial)}>{serial}</option>)}
                    </select>)}
                  </div> : null}
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="border-t border-border bg-muted/50 px-5 py-4">
          {(vente.a_facture || vente.type_vente === 'FACTURE') ? <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"><AlertTriangle size={15} className="mt-0.5 flex-shrink-0" /><span>Cette vente est facturée. La facture liée sera recalculée automatiquement et vous serez informé du document mis à jour.</span></div> : null}
          {error ? <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
          <div className="flex flex-wrap items-center gap-4">
            <div className="mr-auto grid grid-cols-3 gap-4 text-xs"><div><span className="block text-text-muted">Valeur rendue</span><b className="font-price text-red-700">-{formatPrice(returnedTotal)}</b></div><div><span className="block text-text-muted">Remplacement</span><b className="font-price text-green-700">+{formatPrice(replacementTotal)}</b></div><div><span className="block text-text-muted">Nouveau total</span><b className="font-price">{formatPrice(estimatedNewTotal)}</b><span className={cn('ml-1 font-price', difference > 0 ? 'text-red-700' : difference < 0 ? 'text-green-700' : 'text-text-muted')}>({difference > 0 ? '+' : ''}{formatPrice(difference)})</span></div></div>
            <button type="button" onClick={onClose} disabled={saving} className="rounded-xl bg-white px-5 py-2.5 text-sm font-semibold">Annuler</button>
            <button type="button" onClick={() => void submit()} disabled={saving || !hasSelection} className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40"><Repeat2 size={15} />{saving ? 'Échange en cours…' : 'Confirmer l’échange'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

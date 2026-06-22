import { useState, useEffect, useCallback, useRef, useMemo, type ChangeEvent } from 'react'

// ── Module-level cache (survives tab switches, auto-invalidates after 60s) ───
let _cache: { data: unknown[]; ts: number } = { data: [], ts: 0 }
const CACHE_TTL = 60_000
const PAGE_SIZE = 80 // rows rendered per scroll page
import Fuse from 'fuse.js'
import type { Produit, Categorie, SerialNumber } from '../../lib/types'
import { cn, formatPrice, generateId, generateReference } from '../../lib/utils'
import { loadData, runAction } from '../../lib/apiCall'
import BarcodeLabelPrintDialog from '../../components/BarcodeLabelPrintDialog'
import {
  computeProductPricing,
  pricingFromPrixAchatTtc,
  pricingFromMargePct,
  pricingFromCoefAv,
  pricingFromPrixVente,
} from '../../lib/productPricing'
import { usePrintThermal } from '../../lib/usePrint'
import {
  Search, Plus, Edit2, Trash2, Download, Upload, Package,
  AlertTriangle, Filter, X, Check, RefreshCw, BarChart2,
  ChevronUp, ChevronDown, ArrowUpDown, Tag, Barcode, Printer
} from 'lucide-react'
import * as XLSX from 'xlsx'

const api = window.api

const DEFAULT_CATEGORIES = ['Général', 'Réparation', 'Électronique', 'Informatique', 'Accessoires', 'Pièces', 'Consommables', 'Autre']

type SortKey = 'nom' | 'prix_vente' | 'stock_actuel' | 'categorie'
type SortDir = 'asc' | 'desc'

interface ProductFormData {
  code_barre: string
  reference: string
  nom: string
  description: string
  categorie: string
  type: 'F' | 'NF'
  prix_achat: string
  cout_supplementaire: string
  tva_achat_pct: string
  marge_pct: string
  coef_av: string
  prix_vente: string
  tva_taux: string
  stock_actuel: string
  stock_minimum: string
  prix_achat_ttc: string
  fournisseur: string
  source_tag: string
  has_serial_number: boolean
}

const emptyForm = (): ProductFormData => ({
  code_barre: '',
  reference: generateReference(),
  nom: '',
  description: '',
  categorie: 'Général',
  type: 'F',
  prix_achat: '',
  cout_supplementaire: '0',
  tva_achat_pct: '0',
  marge_pct: '',
  coef_av: '',
  prix_vente: '',
  tva_taux: '0',
  stock_actuel: '0',
  stock_minimum: '5',
  prix_achat_ttc: '',
  fournisseur: '',
  source_tag: '',
  has_serial_number: false,
})

export default function InventaireTab() {
  // Start with cached data — instant render on tab switch
  const [produits, setProduits] = useState<Produit[]>(() => _cache.data as Produit[])
  const [formCategories, setFormCategories] = useState<string[]>(DEFAULT_CATEGORIES)
  const [loading, setLoading] = useState(_cache.data.length === 0)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [filterType, setFilterType] = useState<'all' | 'F' | 'NF'>('all')
  const [filterLowStock, setFilterLowStock] = useState(false)
  const [filterCategorie, setFilterCategorie] = useState<string>('all')
  const [sortKey, setSortKey] = useState<SortKey>('nom')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [showModal, setShowModal] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Produit | null>(null)
  const [formData, setFormData] = useState<ProductFormData>(emptyForm())
  const [formErrors, setFormErrors] = useState<Partial<ProductFormData>>({})
  const [savingForm, setSavingForm] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [stockAdjust, setStockAdjust] = useState<{ id: string; nom: string; current: number } | null>(null)
  const [adjustDelta, setAdjustDelta] = useState('')
  const [adjustNote, setAdjustNote] = useState('')
  const [notification, setNotification] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [barcodePrint, setBarcodePrint] = useState<{ code: string; nom: string; prix: number; ref: string } | null>(null)
  const importRef = useRef<HTMLInputElement>(null)
  // Per-unit serial numbers (one entry per stock unit)
  const [serialNums, setSerialNums] = useState<string[]>([])
  const [existingSerials, setExistingSerials] = useState<SerialNumber[]>([])
  // New category modal
  const [showCatModal, setShowCatModal] = useState(false)
  const [newCatNom, setNewCatNom] = useState('')
  const [newCatIcone, setNewCatIcone] = useState('📦')
  // Source tag suggestions for NF products
  const [sourceTagSuggestions, setSourceTagSuggestions] = useState<string[]>([])

  useEffect(() => {
    loadData('Chargement tags source', () => api.produitsGetSourceTags(), { silent: true }).then(tags => {
      if (tags) setSourceTagSuggestions((tags as string[]) || [])
    })
  }, [])

  const showNotif = (msg: string, type: 'success' | 'error' = 'success') => {
    setNotification({ msg, type })
    setTimeout(() => setNotification(null), 2500)
  }

  const loadProduits = useCallback(async (force = false) => {
    const now = Date.now()
    const cacheHit = !force && _cache.data.length > 0 && (now - _cache.ts) < CACHE_TTL
    const rows = await loadData(
      'Chargement inventaire',
      async () => {
        const result = await api.produitsList({}) as Produit[]
        _cache = { data: result || [], ts: Date.now() }
        return _cache.data as Produit[]
      },
      { setLoading: cacheHit ? undefined : setLoading }
    )
    if (rows) setProduits(rows)
  }, [])

  // On mount: if cache is fresh, skip loading state; always refresh in bg
  useEffect(() => {
    const now = Date.now()
    const fresh = _cache.data.length > 0 && (now - _cache.ts) < CACHE_TTL
    loadProduits(!fresh) // force=true only if cache is stale/empty
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    loadData('Chargement catégories', () => api.categoriesList(), { silent: true }).then(list => {
      if (list) {
        const names = (list as Categorie[]).map(c => c.nom).filter(Boolean)
        if (names.length > 0) setFormCategories(names)
      }
    })
  }, [])

  // Debounce search — Fuse.js fires 200ms after typing stops
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setVisibleCount(PAGE_SIZE) }, 200)
    return () => clearTimeout(t)
  }, [search])

  // Reset visible count when filters change
  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [filterType, filterLowStock, filterCategorie, sortKey, sortDir])

  // Infinite scroll — show more rows when sentinel is visible
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setVisibleCount(c => c + PAGE_SIZE)
    }, { threshold: 0.1 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [produits])

  // Sort
  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown size={11} className="opacity-30" />
    return sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />
  }

  // Fuse index rebuilt only when produits changes
  const fuseIndex = useMemo(() => new Fuse(produits, {
    keys: ['nom', 'reference', 'code_barre', 'categorie', 'fournisseur'],
    threshold: 0.35,
    minMatchCharLength: 2,
    ignoreLocation: true,
  }), [produits])

  // Filter & sort — memoized, only recomputes when dependencies change
  const filtered = useMemo(() => {
    const baseList = debouncedSearch.length >= 2
      ? fuseIndex.search(debouncedSearch, { limit: 300 }).map(r => r.item)
      : produits
    return baseList
      .filter(p => {
        if (filterType !== 'all' && p.type !== filterType) return false
        if (filterLowStock && p.stock_actuel > p.stock_minimum) return false
        if (filterCategorie !== 'all' && p.categorie !== filterCategorie) return false
        return true
      })
      .sort((a, b) => {
        let va: string | number = a[sortKey] ?? ''
        let vb: string | number = b[sortKey] ?? ''
        if (typeof va === 'string') va = va.toLowerCase()
        if (typeof vb === 'string') vb = vb.toLowerCase()
        return sortDir === 'asc'
          ? va < vb ? -1 : va > vb ? 1 : 0
          : va > vb ? -1 : va < vb ? 1 : 0
      })
  }, [produits, debouncedSearch, fuseIndex, filterType, filterLowStock, filterCategorie, sortKey, sortDir])

  // Visible slice — virtual scroll
  const visibleRows = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount])

  // Stats — memoized
  const lowStockCount = useMemo(() => produits.filter(p => p.stock_actuel <= p.stock_minimum).length, [produits])
  const totalValeur = useMemo(() => produits.reduce((s, p) => s + p.prix_vente * p.stock_actuel, 0), [produits])
  const categories = useMemo(() => Array.from(new Set(produits.map(p => p.categorie).filter(Boolean))), [produits])

  // Form handling
  const openCreate = () => {
    setEditingProduct(null)
    setFormData(emptyForm())
    setFormErrors({})
    setSerialNums([])
    setExistingSerials([])
    setShowModal(true)
  }

  const openEdit = (p: Produit) => {
    setEditingProduct(p)
    setFormData({
      code_barre: p.code_barre || '',
      reference: p.reference,
      nom: p.nom,
      description: p.description || '',
      categorie: p.categorie || 'Général',
      type: p.type,
      prix_achat: p.prix_achat != null ? String(p.prix_achat) : '',
      cout_supplementaire: String(p.cout_supplementaire ?? 0),
      tva_achat_pct: String(p.tva_achat_pct ?? 0),
      marge_pct: p.marge_pct != null ? String(p.marge_pct) : '',
      coef_av: p.coef_av != null ? String(p.coef_av) : '',
      prix_vente: String(p.prix_vente),
      tva_taux: String(p.tva_taux ?? 0),
      stock_actuel: String(p.stock_actuel),
      stock_minimum: String(p.stock_minimum ?? 5),
      prix_achat_ttc: p.prix_achat_ttc != null ? String(p.prix_achat_ttc) : '',
      fournisseur: p.fournisseur || '',
      source_tag: (p as unknown as { source_tag?: string }).source_tag || '',
      has_serial_number: !!(p.has_serial_number),
    })
    setFormErrors({})
    // Load existing serial numbers for this product
    if (p.has_serial_number) {
      loadData('Chargement numéros de série', () => api.serialNumbersGetByProduit(p.id), { silent: true }).then(sns => {
        if (!sns) return
        const list = sns as SerialNumber[]
        setExistingSerials(list)
        const count = p.stock_actuel
        const filled = Array.from({ length: count }, (_, i) => list[i]?.numero_serie || '')
        setSerialNums(filled)
      })
    } else {
      setExistingSerials([])
      setSerialNums([])
    }
    setShowModal(true)
  }

  const validateForm = (): boolean => {
    const errors: Partial<ProductFormData> = {}
    if (!formData.nom.trim()) errors.nom = 'Obligatoire'
    if (!formData.reference.trim()) errors.reference = 'Obligatoire'
    if (!formData.prix_vente || parseFloat(formData.prix_vente) < 0) errors.prix_vente = 'Prix invalide'
    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSave = async () => {
    if (!validateForm()) return
    const label = editingProduct ? 'Mise à jour produit' : 'Création produit'
    await runAction(label, async () => {
      const now = new Date().toISOString()
      const prixAchatHT = parseFloat(formData.prix_achat) || 0
      const coutSupp = parseFloat(formData.cout_supplementaire) || 0
      const tvaAchatPct = parseFloat(formData.tva_achat_pct) || 0
      const tvaTaux = parseFloat(formData.tva_taux) || 0
      const coutDeRevient = prixAchatHT + coutSupp
      const margePct = formData.marge_pct ? parseFloat(formData.marge_pct) : null
      const coefAv = formData.coef_av ? parseFloat(formData.coef_av) : null
      const prixVenteHT = tvaTaux > 0 ? (parseFloat(formData.prix_vente) || 0) / (1 + tvaTaux / 100) : (parseFloat(formData.prix_vente) || 0)
      const p = {
        id: editingProduct?.id || generateId(),
        code_barre: formData.code_barre.trim() || null,
        reference: formData.reference.trim(),
        nom: formData.nom.trim(),
        description: formData.description.trim() || null,
        categorie: formData.categorie,
        type: formData.type,
        prix_achat: prixAchatHT || null,
        cout_supplementaire: coutSupp,
        tva_achat_pct: tvaAchatPct,
        marge_pct: margePct,
        coef_av: coefAv,
        cout_de_revient: coutDeRevient > 0 ? coutDeRevient : null,
        prix_vente_ht: prixVenteHT > 0 ? prixVenteHT : null,
        prix_vente: parseFloat(formData.prix_vente) || 0,
        tva_taux: tvaTaux,
        prix_achat_ttc: coutDeRevient > 0 ? coutDeRevient * (1 + tvaAchatPct / 100) : null,
        stock_actuel: parseInt(formData.stock_actuel) || 0,
        stock_minimum: parseInt(formData.stock_minimum) || 5,
        fournisseur: formData.fournisseur.trim() || null,
        source_tag: formData.type === 'NF' && formData.source_tag.trim() ? formData.source_tag.trim() : null,
        has_serial_number: formData.has_serial_number ? 1 : 0,
        created_at: editingProduct?.created_at || now,
        updated_at: now,
      }
      if (editingProduct) {
        await api.produitsUpdate(editingProduct.id, p)
      } else {
        await api.produitsCreate(p)
      }
      if (formData.has_serial_number) {
        const filled = serialNums.filter(s => s.trim())
        await api.serialNumbersBulkSet(p.id, filled)
      }
      setShowModal(false)
      await loadProduits(true)
    }, {
      setSaving: setSavingForm,
      successMessage: editingProduct ? `${formData.nom.trim()} mis à jour` : `${formData.nom.trim()} créé`,
    })
  }

  const handleDelete = async (id: string) => {
    await runAction('Suppression produit', async () => {
      await api.produitsDelete(id)
      setConfirmDelete(null)
      await loadProduits(true)
    }, { successMessage: 'Produit supprimé' })
  }

  const handleStockAdjust = async () => {
    if (!stockAdjust) return
    const delta = parseInt(adjustDelta.replace(',', '.')) || 0
    if (delta === 0) { setStockAdjust(null); return }
    await runAction('Ajustement stock', async () => {
      await api.produitsAdjustStock(stockAdjust.id, delta)
      setStockAdjust(null)
      setAdjustDelta('')
      setAdjustNote('')
      await loadProduits(true)
    }, { successMessage: `Stock ajusté de ${delta > 0 ? '+' : ''}${delta}` })
  }

  // Import Excel
  const handleImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await runAction('Import inventaire', async () => {
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer)
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws) as Record<string, unknown>[]
      const now = new Date().toISOString()
      const produits = rows.map(row => ({
        id: generateId(),
        code_barre: String(row['code_barre'] || row['Code Barre'] || '').trim() || null,
        reference: String(row['reference'] || row['Référence'] || generateReference()).trim(),
        nom: String(row['nom'] || row['Nom'] || '').trim(),
        description: String(row['description'] || row['Description'] || '').trim() || null,
        categorie: String(row['categorie'] || row['Catégorie'] || 'Général').trim(),
        type: String(row['type'] || row['Type'] || 'F').trim() === 'NF' ? 'NF' : 'F',
        prix_achat: parseFloat(String(row['prix_achat'] || row['Prix Achat'] || '0')) || null,
        prix_vente: parseFloat(String(row['prix_vente'] || row['Prix Vente'] || '0')) || 0,
        tva_taux: parseFloat(String(row['tva_taux'] || row['TVA'] || '0')) || 0,
        stock_actuel: parseInt(String(row['stock_actuel'] || row['Stock'] || '0')) || 0,
        stock_minimum: parseInt(String(row['stock_minimum'] || row['Stock Min'] || '5')) || 5,
        fournisseur: String(row['fournisseur'] || row['Fournisseur'] || '').trim() || null,
        actif: 1,
        created_at: now,
        updated_at: now,
      })).filter(p => p.nom)

      if (produits.length === 0) throw new Error('Aucun produit trouvé dans le fichier')
      await api.produitsBulkInsert(produits)
      await loadProduits(true)
    }, { successMessage: 'Import terminé' })
    if (importRef.current) importRef.current.value = ''
  }

  // Export Excel
  const handleExport = () => {
    const rows = produits.map(p => ({
      'Référence': p.reference,
      'Code Barre': p.code_barre || '',
      'Nom': p.nom,
      'Description': p.description || '',
      'Catégorie': p.categorie,
      'Type': p.type,
      'Prix Achat': p.prix_achat ?? '',
      'Prix Vente': p.prix_vente,
      'TVA (%)': p.tva_taux ?? 0,
      'Stock Actuel': p.stock_actuel,
      'Stock Minimum': p.stock_minimum,
      'Fournisseur': p.fournisseur || '',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Inventaire')
    XLSX.writeFile(wb, `inventaire-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const f = (key: keyof ProductFormData, val: string | boolean) => {
    setFormData(prev => ({ ...prev, [key]: val }))
    if (typeof val === 'string' && formErrors[key as keyof typeof formErrors]) {
      setFormErrors(prev => ({ ...prev, [key]: undefined }))
    }
  }

  // Pricing helpers
  const computePricing = (data: ProductFormData) => computeProductPricing(data)

  const onPrixAchatTtcChange = (val: string) => {
    setFormData(prev => ({ ...prev, ...pricingFromPrixAchatTtc(prev, val) }))
  }

  const onMargePctChange = (val: string) => {
    setFormData(prev => ({ ...prev, ...pricingFromMargePct(prev, val) }))
  }

  const onCoefAvChange = (val: string) => {
    setFormData(prev => ({ ...prev, ...pricingFromCoefAv(prev, val) }))
  }

  const onPrixVenteChange = (val: string) => {
    setFormData(prev => ({ ...prev, ...pricingFromPrixVente(prev, val) }))
    if (formErrors.prix_vente) setFormErrors(prev => ({ ...prev, prix_vente: undefined }))
  }

  // Generate unique barcode SML-YYYYMMDD-XXXXX
  const generateBarcode = async () => {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    let code = ''
    let unique = false
    let attempts = 0
    while (!unique && attempts < 10) {
      const rand = String(Math.floor(Math.random() * 99999)).padStart(5, '0')
      code = `SML-${date}-${rand}`
      const res = await api.produitsCheckBarcodeUnique(code, editingProduct?.id)
      unique = res.unique
      attempts++
    }
    if (unique) f('code_barre', code)
  }

  const printBarcodeLabel = (code: string, nom: string, prix: number, ref: string) => {
    if (!code?.trim()) return
    setBarcodePrint({
      code: code.trim(),
      nom: nom.trim() || ref.trim() || 'Produit',
      prix: Number.isFinite(prix) ? prix : parseFloat(String(prix)) || 0,
      ref,
    })
  }

  // Save new category
  const handleSaveCat = async () => {
    const nom = newCatNom.trim()
    if (!nom) return
    await runAction('Création catégorie', async () => {
      const id = `cat-${generateId().slice(0, 8)}`
      await api.categoriesCreate({ id, nom, icone: newCatIcone })
      setFormCategories(prev => [...prev, nom].sort())
      f('categorie', nom)
      setNewCatNom('')
      setShowCatModal(false)
    }, { successMessage: 'Catégorie créée' })
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Notification */}
      {notification && (
        <div className={cn(
          'absolute top-16 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-lg animate-slide-in',
          notification.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        )}>
          {notification.type === 'success' ? <Check size={14} /> : <X size={14} />}
          {notification.msg}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-white border-b border-border flex-shrink-0 flex-wrap gap-y-2">
        {/* Search */}
        <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-1.5 border border-border focus-within:border-accent-500 min-w-[220px]">
          <Search size={14} className="text-text-muted flex-shrink-0" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher nom, réf, code-barres..."
            className="flex-1 bg-transparent outline-none text-sm"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-text-muted hover:text-text-primary">
              <X size={12} />
            </button>
          )}
        </div>

        {/* Type filter */}
        <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
          {[
            { id: 'all', label: 'Tous' },
            { id: 'F', label: 'Facturé' },
            { id: 'NF', label: 'Non Facturé' },
          ].map(opt => (
            <button
              key={opt.id}
              onClick={() => setFilterType(opt.id as 'all' | 'F' | 'NF')}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-semibold transition-colors',
                filterType === opt.id ? 'bg-white shadow-sm text-text-primary' : 'text-text-secondary hover:text-text-primary'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Category filter */}
        <select
          value={filterCategorie}
          onChange={e => setFilterCategorie(e.target.value)}
          className="border border-border rounded-lg px-2 py-1.5 text-xs bg-white"
        >
          <option value="all">Toutes catégories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        {/* Low stock filter */}
        <button
          onClick={() => setFilterLowStock(!filterLowStock)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors',
            filterLowStock
              ? 'bg-orange-50 border-orange-300 text-orange-700'
              : 'bg-white border-border text-text-secondary hover:text-text-primary'
          )}
        >
          <AlertTriangle size={12} />
          Stock bas {lowStockCount > 0 && <span className="bg-orange-400 text-white rounded-full px-1.5 text-xs">{lowStockCount}</span>}
        </button>

        <button
          onClick={() => loadProduits(true)}
          disabled={loading}
          className="p-1.5 text-text-muted hover:text-text-primary rounded-lg hover:bg-muted transition-colors"
          title="Actualiser"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>

        <div className="ml-auto flex items-center gap-2">
          <input ref={importRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImport} />
          <button
            onClick={() => importRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-muted border border-border text-text-secondary hover:text-text-primary font-semibold rounded-lg text-xs transition-colors"
          >
            <Upload size={13} />
            Importer
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-muted border border-border text-text-secondary hover:text-text-primary font-semibold rounded-lg text-xs transition-colors"
          >
            <Download size={13} />
            Exporter
          </button>
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-500 hover:bg-accent-600 text-text-primary font-bold rounded-lg text-xs transition-colors"
          >
            <Plus size={14} />
            Nouveau Produit
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 px-4 py-3 bg-surface border-b border-border flex-shrink-0">
        <div className="bg-white rounded-xl border border-border px-4 py-3 shadow-card">
          <div className="text-xs font-semibold text-text-secondary mb-1 flex items-center gap-1">
            <Package size={12} /> Total produits
          </div>
          <div className="text-lg font-bold">{produits.length}</div>
          <div className="text-xs text-text-muted">{filtered.length} affichés</div>
        </div>
        <div className="bg-white rounded-xl border border-border px-4 py-3 shadow-card">
          <div className="text-xs font-semibold text-text-secondary mb-1 flex items-center gap-1">
            <AlertTriangle size={12} /> Stock bas
          </div>
          <div className={cn('text-lg font-bold', lowStockCount > 0 ? 'text-warning' : 'text-success')}>
            {lowStockCount}
          </div>
          <div className="text-xs text-text-muted">produits à réapprovisionner</div>
        </div>
        <div className="bg-white rounded-xl border border-border px-4 py-3 shadow-card">
          <div className="text-xs font-semibold text-text-secondary mb-1 flex items-center gap-1">
            <BarChart2 size={12} /> Valeur stock
          </div>
          <div className="text-lg font-bold font-price">{formatPrice(totalValeur)}</div>
          <div className="text-xs text-text-muted">au prix de vente</div>
        </div>
        <div className="bg-white rounded-xl border border-border px-4 py-3 shadow-card">
          <div className="text-xs font-semibold text-text-secondary mb-1 flex items-center gap-1">
            <Filter size={12} /> Catégories
          </div>
          <div className="text-lg font-bold">{categories.length}</div>
          <div className="text-xs text-text-muted">catégories actives</div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted border-b border-border z-10">
            <tr>
              <th className="text-left px-3 py-2.5 text-xs font-semibold text-text-secondary">Type</th>
              <th
                className="text-left px-3 py-2.5 text-xs font-semibold text-text-secondary cursor-pointer hover:text-text-primary"
                onClick={() => handleSort('nom')}
              >
                <span className="flex items-center gap-1">Produit <SortIcon col="nom" /></span>
              </th>
              <th
                className="text-left px-3 py-2.5 text-xs font-semibold text-text-secondary cursor-pointer hover:text-text-primary"
                onClick={() => handleSort('categorie')}
              >
                <span className="flex items-center gap-1">Catégorie <SortIcon col="categorie" /></span>
              </th>
              <th className="text-left px-3 py-2.5 text-xs font-semibold text-text-secondary">Fournisseur</th>
              <th
                className="text-right px-3 py-2.5 text-xs font-semibold text-text-secondary cursor-pointer hover:text-text-primary"
                onClick={() => handleSort('prix_vente')}
              >
                <span className="flex items-center justify-end gap-1">Prix Vente <SortIcon col="prix_vente" /></span>
              </th>
              <th
                className="text-center px-3 py-2.5 text-xs font-semibold text-text-secondary cursor-pointer hover:text-text-primary"
                onClick={() => handleSort('stock_actuel')}
              >
                <span className="flex items-center justify-center gap-1">Stock <SortIcon col="stock_actuel" /></span>
              </th>
              <th className="text-center px-3 py-2.5 text-xs font-semibold text-text-secondary">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-16 text-text-muted">
                  <Package size={36} className="mx-auto mb-3 opacity-30" />
                  <p className="font-medium">Aucun produit trouvé</p>
                  {search && <p className="text-xs mt-1">Essayez une autre recherche</p>}
                </td>
              </tr>
            ) : (
              visibleRows.map(p => {
                const isLow = p.stock_actuel <= p.stock_minimum
                return (
                  <tr key={p.id} className="border-b border-border hover:bg-muted/40 transition-colors group">
                    <td className="px-3 py-2.5">
                      <span className={p.type === 'F' ? 'badge-F' : 'badge-NF'}>{p.type}</span>
                    </td>
                    <td className="px-3 py-2.5 max-w-[200px]">
                      <div className="font-semibold text-xs truncate">{p.nom}</div>
                      <div className="text-xs text-text-muted font-mono">{p.reference}</div>
                      {p.code_barre && <div className="text-xs text-text-muted font-mono">{p.code_barre}</div>}
                      {p.has_serial_number ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded mt-0.5">
                          S/N · {p.stock_actuel} unité{p.stock_actuel !== 1 ? 's' : ''}
                        </span>
                      ) : null}
                      {p.type === 'NF' && (p as unknown as { source_tag?: string }).source_tag && (
                        <span className="inline-flex items-center text-[10px] font-semibold bg-red-100 text-red-700 px-1.5 py-0.5 rounded mt-0.5 max-w-[160px] truncate">
                          {(p as unknown as { source_tag?: string }).source_tag}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-text-secondary">{p.categorie}</td>
                    <td className="px-3 py-2.5 text-xs text-text-secondary">{p.fournisseur || '—'}</td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="font-price font-bold text-xs">{formatPrice(p.prix_vente)}</div>
                      {p.prix_achat != null && (
                        <div className="text-xs text-text-muted font-price">Achat: {formatPrice(p.prix_achat)}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <button
                        onClick={() => { setStockAdjust({ id: p.id, nom: p.nom, current: p.stock_actuel }); setAdjustDelta(''); setAdjustNote('') }}
                        className={cn(
                          'font-price font-bold text-sm px-2.5 py-1 rounded-lg border transition-colors',
                          isLow
                            ? 'bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100'
                            : 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                        )}
                      >
                        {p.stock_actuel}
                      </button>
                      {isLow && (
                        <div className="text-xs text-warning font-medium mt-0.5 flex items-center justify-center gap-0.5">
                          <AlertTriangle size={10} /> Min: {p.stock_minimum}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {p.code_barre && (
                          <button
                            onClick={() => printBarcodeLabel(p.code_barre!, p.nom, p.prix_vente, p.reference)}
                            className="p-1.5 text-text-muted hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
                            title="Imprimer étiquette"
                          >
                            <Printer size={13} />
                          </button>
                        )}
                        <button
                          onClick={() => openEdit(p)}
                          className="p-1.5 text-text-muted hover:text-info hover:bg-blue-50 rounded-lg transition-colors"
                          title="Modifier"
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          onClick={() => setConfirmDelete(p.id)}
                          className="p-1.5 text-text-muted hover:text-danger hover:bg-red-50 rounded-lg transition-colors"
                          title="Supprimer"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
        {/* Sentinel — triggers loading more rows when scrolled into view */}
        {visibleCount < filtered.length && (
          <div ref={sentinelRef} className="flex items-center justify-center py-4 text-xs text-text-muted">
            <RefreshCw size={12} className="animate-spin mr-2" />
            Chargement… {visibleCount}/{filtered.length}
          </div>
        )}
        {filtered.length > 0 && visibleCount >= filtered.length && (
          <div className="py-2 text-center text-xs text-text-muted">{filtered.length} produit(s)</div>
        )}
      </div>

      {/* Product Form Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto animate-slide-in">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-white z-10">
              <h2 className="font-bold flex items-center gap-2">
                <Package size={16} />
                {editingProduct ? 'Modifier le produit' : 'Nouveau produit'}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-text-muted hover:text-text-primary">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Type */}
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-2">Type de facturation</label>
                <div className="flex gap-3">
                  <button
                    onClick={() => f('type', 'F')}
                    className={cn('flex-1 py-2.5 rounded-xl border-2 text-sm font-semibold transition-colors', formData.type === 'F' ? 'border-green-400 bg-green-50 text-green-700' : 'border-border hover:bg-muted')}
                  >
                    🟢 Facturé (F)
                  </button>
                  <button
                    onClick={() => f('type', 'NF')}
                    className={cn('flex-1 py-2.5 rounded-xl border-2 text-sm font-semibold transition-colors', formData.type === 'NF' ? 'border-red-400 bg-red-50 text-red-700' : 'border-border hover:bg-muted')}
                  >
                    🔴 Non Facturé (NF)
                  </button>
                </div>
              </div>

              {/* Référence + Nom */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1.5">
                    Référence <span className="text-danger">*</span>
                  </label>
                  <input
                    value={formData.reference}
                    onChange={e => f('reference', e.target.value)}
                    className={cn('w-full border rounded-lg px-3 py-2 text-sm font-mono', formErrors.reference ? 'border-danger' : 'border-border')}
                    placeholder="PRD-..."
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1.5">
                    Nom <span className="text-danger">*</span>
                  </label>
                  <input
                    value={formData.nom}
                    onChange={e => f('nom', e.target.value)}
                    className={cn('w-full border rounded-lg px-3 py-2 text-sm', formErrors.nom ? 'border-danger' : 'border-border')}
                    placeholder="Nom du produit"
                  />
                  {formErrors.nom && <p className="text-xs text-danger mt-1">{formErrors.nom}</p>}
                </div>
              </div>

              {/* Code-barre + Catégorie */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1.5">Code-barres</label>
                  <div className="flex gap-1.5">
                    <input
                      value={formData.code_barre}
                      onChange={e => f('code_barre', e.target.value)}
                      className="flex-1 border border-border rounded-lg px-3 py-2 text-sm font-mono"
                      placeholder="EAN-13 / SML-..."
                    />
                    <button
                      type="button"
                      onClick={generateBarcode}
                      title="Générer code-barres unique"
                      className="px-2 py-1 border border-border rounded-lg text-text-muted hover:text-accent-600 hover:bg-accent-50 transition-colors"
                    >
                      <Barcode size={14} />
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1.5">Catégorie</label>
                  <div className="flex gap-1.5">
                    <select
                      value={formData.categorie}
                      onChange={e => f('categorie', e.target.value)}
                      className="flex-1 border border-border rounded-lg px-3 py-2 text-sm"
                    >
                      {formCategories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <button
                      type="button"
                      onClick={() => { setNewCatNom(''); setNewCatIcone('📦'); setShowCatModal(true) }}
                      title="Nouvelle catégorie"
                      className="px-2 py-1 border border-border rounded-lg text-text-muted hover:text-accent-600 hover:bg-accent-50 transition-colors"
                    >
                      <Tag size={14} />
                    </button>
                  </div>
                </div>
              </div>

              {/* ── Pricing Algorithm ── */}
              {(() => {
                const pricing = computePricing(formData)
                return (
                  <div className="border border-border rounded-xl overflow-hidden">
                    {/* Côté Achat */}
                    <div className="bg-blue-50 border-b border-border px-4 py-2">
                      <span className="text-[11px] font-bold text-blue-700 uppercase tracking-wider">Côté Achat</span>
                    </div>
                    <div className="grid grid-cols-4 gap-3 p-4 border-b border-border">
                      <div>
                        <label className="block text-xs font-semibold text-text-secondary mb-1.5">Prix Achat HT (DT)</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={formData.prix_achat}
                          onChange={e => f('prix_achat', e.target.value.replace(/[^0-9.,]/g, ''))}
                          className="w-full border border-border rounded-lg px-3 py-2 text-sm font-price"
                          placeholder="0.000"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-text-secondary mb-1.5">Coût suppl. (DT)</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={formData.cout_supplementaire}
                          onChange={e => f('cout_supplementaire', e.target.value.replace(/[^0-9.,]/g, ''))}
                          className="w-full border border-border rounded-lg px-3 py-2 text-sm font-price"
                          placeholder="0.000"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-text-secondary mb-1.5">Coût de revient</label>
                        <div className="border border-blue-200 bg-blue-50 rounded-lg px-3 py-2 text-sm font-price font-bold text-blue-800">
                          {formatPrice(pricing.coutRevient)}
                        </div>
                        <p className="text-[10px] text-text-muted mt-0.5">Auto-calculé</p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-text-secondary mb-1.5">TVA Achat (%)</label>
                        <div className="flex gap-1 flex-wrap">
                          {['0','7','13','19'].map(v => (
                            <button key={v} type="button" onClick={() => f('tva_achat_pct', v)}
                              className={cn('px-2 py-1 rounded text-xs font-price border transition-colors',
                                formData.tva_achat_pct === v ? 'bg-blue-500 text-white border-blue-500' : 'border-border hover:bg-muted'
                              )}>{v}%</button>
                          ))}
                          <input type="text" inputMode="decimal" value={formData.tva_achat_pct} onChange={e => f('tva_achat_pct', e.target.value.replace(/[^0-9.,]/g, ''))}
                            className="w-14 border border-border rounded px-1 py-1 text-xs font-price" />
                        </div>
                      </div>
                    </div>
                    {/* Prix Achat TTC — editable */}
                    <div className="grid grid-cols-2 gap-3 px-4 pb-3 pt-1 border-b border-border">
                      <div>
                        <label className="block text-xs font-semibold text-blue-700 mb-1">Prix Achat TTC (DT)</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={formData.prix_achat_ttc || pricing.prixAchatTTC.toFixed(3)}
                          onChange={e => onPrixAchatTtcChange(e.target.value.replace(/[^0-9.,]/g, ''))}
                          className="w-full border border-blue-300 bg-blue-50 rounded-lg px-3 py-2 text-sm font-price font-bold text-blue-800"
                        />
                        <p className="text-[10px] text-text-muted mt-0.5">Saisie directe → recalcule HT</p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-green-700 mb-1">Prix Vente HT (DT) ✅</label>
                        <div className="border border-green-300 bg-green-50 rounded-lg px-3 py-2 text-sm font-price font-bold text-green-800">
                          {formatPrice(pricing.prixVenteHT)}
                        </div>
                        <p className="text-[10px] text-text-muted mt-0.5">= TTC ÷ (1 + TVA Vente)</p>
                      </div>
                    </div>

                    {/* Côté Vente */}
                    <div className="bg-green-50 border-b border-border px-4 py-2 flex items-center justify-between">
                      <span className="text-[11px] font-bold text-green-700 uppercase tracking-wider">Côté Vente</span>
                      {pricing.isBelowCost && (
                        <span className="flex items-center gap-1 text-[11px] font-bold text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
                          <AlertTriangle size={11} /> Vente sous coût de revient !
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-4 gap-3 p-4">
                      <div>
                        <label className="block text-xs font-semibold text-text-secondary mb-1.5">Marge %</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={formData.marge_pct}
                          onChange={e => onMargePctChange(e.target.value.replace(/[^0-9.,]/g, ''))}
                          className="w-full border border-border rounded-lg px-3 py-2 text-sm font-price"
                          placeholder="30"
                        />
                        <p className="text-[10px] text-text-muted mt-0.5">Path A</p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-text-secondary mb-1.5">Coef A/V</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={formData.coef_av}
                          onChange={e => onCoefAvChange(e.target.value.replace(/[^0-9.,]/g, ''))}
                          className="w-full border border-border rounded-lg px-3 py-2 text-sm font-price"
                          placeholder="1.3"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-text-secondary mb-1.5">
                          Prix Vente TTC (DT) <span className="text-danger">*</span>
                        </label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={formData.prix_vente}
                          onChange={e => onPrixVenteChange(e.target.value.replace(/[^0-9.,]/g, ''))}
                          className={cn('w-full border rounded-lg px-3 py-2 text-sm font-price font-bold',
                            pricing.isBelowCost ? 'border-red-400 bg-red-50' : formErrors.prix_vente ? 'border-danger' : 'border-green-400 bg-green-50'
                          )}
                          placeholder="0.000"
                        />
                        {formErrors.prix_vente && <p className="text-xs text-danger mt-1">{formErrors.prix_vente}</p>}
                        <p className="text-[10px] text-text-muted mt-0.5">Path B — saisie directe</p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-text-secondary mb-1.5">TVA Vente (%) <span className="text-danger">*</span></label>
                        <div className="flex gap-1 flex-wrap">
                          {['0','7','13','19'].map(v => (
                            <button key={v} type="button" onClick={() => f('tva_taux', v)}
                              className={cn('px-2 py-1 rounded text-xs font-price border transition-colors',
                                formData.tva_taux === v ? 'bg-green-500 text-white border-green-500' : 'border-border hover:bg-muted'
                              )}>{v}%</button>
                          ))}
                          <input type="text" inputMode="decimal" value={formData.tva_taux} onChange={e => f('tva_taux', e.target.value.replace(/[^0-9.,]/g, ''))}
                            className="w-14 border border-border rounded px-1 py-1 text-xs font-price" />
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })()}

              {/* Stock */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1.5">Stock actuel</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formData.stock_actuel}
                    onChange={e => {
                      const val = e.target.value.replace(/[^0-9]/g, '')
                      f('stock_actuel', val)
                      if (formData.has_serial_number) {
                        const newCount = parseInt(val) || 0
                        setSerialNums(prev => Array.from({ length: newCount }, (_, i) => prev[i] ?? ''))
                      }
                    }}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm font-price"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1.5">Stock minimum</label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={formData.stock_minimum}
                    onChange={e => f('stock_minimum', e.target.value.replace(/[^0-9]/g, ''))}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm font-price bg-white"
                  />
                </div>
              </div>

              {/* Fournisseur + Description */}
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">Fournisseur</label>
                <input
                  value={formData.fournisseur}
                  onChange={e => f('fournisseur', e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm"
                  placeholder="Nom du fournisseur..."
                />
              </div>

              {/* Source tag (NF only) */}
              {formData.type === 'NF' && (
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1.5">
                    Source / Fournisseur NF <span className="text-red-500 text-[10px]">(badge rouge affiché)</span>
                  </label>
                  <input
                    value={formData.source_tag}
                    onChange={e => f('source_tag', e.target.value)}
                    list="source-tag-suggestions"
                    className="w-full border border-red-200 rounded-lg px-3 py-2 text-sm"
                    placeholder="Ex: Ali Marché Central, Fournisseur Informel..."
                  />
                  <datalist id="source-tag-suggestions">
                    {sourceTagSuggestions.map(t => <option key={t} value={t} />)}
                  </datalist>
                  {formData.source_tag && (
                    <div className="mt-1">
                      <span className="inline-flex items-center text-[10px] font-semibold bg-red-100 text-red-700 px-2 py-0.5 rounded">
                        {formData.source_tag}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Serial number toggle + per-unit inputs */}
              <div className="flex flex-col gap-3">
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <div
                    className={cn(
                      'relative w-9 h-5 rounded-full transition-colors flex-shrink-0',
                      formData.has_serial_number ? 'bg-accent-500' : 'bg-border'
                    )}
                    onClick={() => {
                      const next = !formData.has_serial_number
                      setFormData(prev => ({ ...prev, has_serial_number: next }))
                      if (next) {
                        const count = parseInt(formData.stock_actuel) || 0
                        setSerialNums(Array(count).fill(''))
                      } else {
                        setSerialNums([])
                      }
                    }}
                  >
                    <div className={cn(
                      'absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform',
                      formData.has_serial_number ? 'translate-x-4' : 'translate-x-0.5'
                    )} />
                  </div>
                  <span className="text-xs font-semibold text-text-secondary">Numéros de série par unité (S/N)</span>
                </label>

                {formData.has_serial_number && (() => {
                  const count = parseInt(formData.stock_actuel) || 0
                  // Sync array length to current stock count
                  if (serialNums.length !== count) {
                    const synced = Array.from({ length: count }, (_, i) => serialNums[i] ?? '')
                    setTimeout(() => setSerialNums(synced), 0)
                  }
                  if (count === 0) return (
                    <p className="text-xs text-text-muted italic">Stock = 0 · Aucun S/N à renseigner.</p>
                  )
                  return (
                    <div className="border border-border rounded-xl overflow-hidden">
                      <div className="bg-muted px-3 py-2 flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">
                          {count} unité{count > 1 ? 's' : ''} — S/N requis
                        </span>
                        <span className="text-[11px] text-text-muted">
                          {serialNums.filter(s => s.trim()).length}/{count} renseignés
                        </span>
                      </div>
                      <div className="divide-y divide-border">
                        {Array.from({ length: count }, (_, i) => (
                          <div key={i} className="flex items-center gap-2 px-3 py-2">
                            <span className="text-[11px] font-bold text-text-muted w-6 text-center flex-shrink-0">#{i + 1}</span>
                            <input
                              value={serialNums[i] ?? ''}
                              onChange={e => {
                                const updated = [...serialNums]
                                updated[i] = e.target.value
                                setSerialNums(updated)
                              }}
                              className="flex-1 border border-border rounded-lg px-2.5 py-1.5 text-xs font-mono outline-none focus:border-accent-500"
                              placeholder={`S/N unité ${i + 1}...`}
                            />
                            {existingSerials[i]?.statut === 'VENDU' && (
                              <span className="text-[10px] bg-red-100 text-red-700 font-bold px-1.5 py-0.5 rounded flex-shrink-0">VENDU</span>
                            )}
                            {existingSerials[i]?.statut === 'EN_STOCK' && (
                              <span className="text-[10px] bg-green-100 text-green-700 font-bold px-1.5 py-0.5 rounded flex-shrink-0">EN STOCK</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })()}
              </div>

              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">Description</label>
                <textarea
                  value={formData.description}
                  onChange={e => f('description', e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm h-16 resize-none"
                  placeholder="Description optionnelle..."
                />
              </div>
            </div>

            <div className="flex gap-3 px-6 py-4 border-t border-border">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="flex-1 bg-muted hover:bg-border text-text-primary font-semibold py-2.5 rounded-xl transition-colors"
              >
                Annuler
              </button>
              {formData.code_barre && formData.nom.trim() && (parseFloat(formData.prix_vente) || 0) > 0 && (
                <button
                  type="button"
                  onClick={() => printBarcodeLabel(formData.code_barre, formData.nom, parseFloat(formData.prix_vente) || 0, formData.reference)}
                  title="Imprimer étiquette code-barres"
                  className="flex items-center gap-1.5 px-4 py-2.5 border border-orange-400 text-orange-600 font-semibold rounded-xl hover:bg-orange-50 transition-colors"
                >
                  <Printer size={14} /> Étiquette
                </button>
              )}
              <button
                type="button"
                onClick={handleSave}
                disabled={savingForm}
                className="flex-1 bg-accent-500 hover:bg-accent-600 disabled:bg-gray-200 disabled:text-gray-400 text-text-primary font-bold py-2.5 rounded-xl transition-colors"
              >
                {savingForm ? 'Sauvegarde...' : editingProduct ? 'Mettre à jour' : 'Créer le produit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Category Modal */}
      {showCatModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-2xl shadow-2xl w-[360px] p-6 animate-slide-in">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold flex items-center gap-2"><Tag size={16} /> Nouvelle catégorie</h3>
              <button onClick={() => setShowCatModal(false)} className="text-text-muted hover:text-text-primary"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">Nom de la catégorie *</label>
                <input
                  value={newCatNom}
                  onChange={e => setNewCatNom(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSaveCat()}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm"
                  placeholder="Ex: ACCESSOIRE..."
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">Icône (emoji)</label>
                <div className="flex items-center gap-2">
                  <input
                    value={newCatIcone}
                    onChange={e => setNewCatIcone(e.target.value)}
                    className="w-20 border border-border rounded-lg px-3 py-2 text-lg text-center"
                    maxLength={4}
                  />
                  <span className="text-xs text-text-muted">Choisissez un emoji ou laissez 📦</span>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {['📦','💻','📱','🖨️','⌚','📺','🎮','🔌','🔋','🖥️','⌨️','🖱️','💾','📷','🎧','🛒'].map(e => (
                    <button key={e} onClick={() => setNewCatIcone(e)}
                      className={cn('w-8 h-8 rounded-lg text-lg flex items-center justify-center transition-colors', newCatIcone === e ? 'bg-accent-100 border border-accent-400' : 'hover:bg-muted border border-transparent')}>
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button type="button" onClick={() => setShowCatModal(false)} className="flex-1 bg-muted hover:bg-border font-semibold py-2.5 rounded-xl transition-colors text-sm">Annuler</button>
              <button type="button" onClick={handleSaveCat} disabled={!newCatNom.trim()} className="flex-1 bg-accent-500 hover:bg-accent-600 disabled:bg-gray-200 disabled:text-gray-400 font-bold py-2.5 rounded-xl transition-colors text-sm">Créer</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-[360px] p-6 animate-slide-in">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center">
                <Trash2 size={18} className="text-danger" />
              </div>
              <div>
                <h3 className="font-bold text-text-primary">Confirmer la suppression</h3>
                <p className="text-xs text-text-secondary">Cette action est irréversible</p>
              </div>
            </div>
            <p className="text-sm text-text-secondary mb-5">Voulez-vous vraiment supprimer ce produit ?</p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setConfirmDelete(null)} className="flex-1 bg-muted hover:bg-border font-semibold py-2.5 rounded-xl transition-colors text-sm">
                Annuler
              </button>
              <button type="button" onClick={() => handleDelete(confirmDelete)} className="flex-1 bg-danger hover:bg-red-700 text-white font-bold py-2.5 rounded-xl transition-colors text-sm">
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stock Adjustment Modal */}
      {stockAdjust && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-[380px] p-6 animate-slide-in">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold flex items-center gap-2">
                <BarChart2 size={16} /> Ajustement de stock
              </h3>
              <button onClick={() => setStockAdjust(null)} className="text-text-muted hover:text-text-primary">
                <X size={18} />
              </button>
            </div>

            <div className="bg-muted rounded-xl p-3 mb-4">
              <div className="text-xs text-text-secondary mb-0.5">{stockAdjust.nom}</div>
              <div className="text-sm font-bold">Stock actuel: <span className="font-price">{stockAdjust.current}</span></div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">
                  Ajustement (+ pour entrée, - pour sortie)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={adjustDelta}
                  onChange={e => setAdjustDelta(e.target.value.replace(/[^0-9.,-]/g, ''))}
                  className="w-full border border-border rounded-xl px-4 py-3 font-price text-lg font-semibold focus:border-accent-500"
                  placeholder="+10 ou -5"
                  autoFocus
                />
                {adjustDelta && !isNaN(parseInt(adjustDelta)) && (
                  <div className="mt-2 text-xs font-semibold flex items-center gap-2">
                    <span className="text-text-muted">Nouveau stock:</span>
                    <span className={cn('font-price', Math.max(0, stockAdjust.current + parseInt(adjustDelta)) <= 0 ? 'text-danger' : 'text-success')}>
                      {Math.max(0, stockAdjust.current + parseInt(adjustDelta))}
                    </span>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">Note (optionnel)</label>
                <input
                  value={adjustNote}
                  onChange={e => setAdjustNote(e.target.value)}
                  className="w-full border border-border rounded-xl px-4 py-2.5 text-sm"
                  placeholder="Raison de l'ajustement..."
                />
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button type="button" onClick={() => setStockAdjust(null)} className="flex-1 bg-muted hover:bg-border font-semibold py-2.5 rounded-xl transition-colors text-sm">
                Annuler
              </button>
              <button
                type="button"
                onClick={handleStockAdjust}
                disabled={!adjustDelta || isNaN(parseInt(adjustDelta))}
                className="flex-1 bg-accent-500 hover:bg-accent-600 disabled:bg-gray-200 disabled:text-gray-400 text-text-primary font-bold py-2.5 rounded-xl transition-colors text-sm"
              >
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}

      {barcodePrint && (
        <BarcodeLabelPrintDialog
          code={barcodePrint.code}
          nom={barcodePrint.nom}
          prix={barcodePrint.prix}
          productRef={barcodePrint.ref}
          onClose={() => setBarcodePrint(null)}
        />
      )}
    </div>
  )
}

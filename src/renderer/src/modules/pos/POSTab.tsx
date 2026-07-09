import { useState, useRef, useEffect, useCallback } from 'react'
import Fuse from 'fuse.js'
import { useAppStore } from '../../store/appStore'
import { useCartStore } from '../../store/cartStore'
import type { Produit, ServicePOS, Vente, CartItem } from '../../lib/types'
import { cn, formatPrice } from '../../lib/utils'
import { loadData, runAction } from '../../lib/apiCall'
import { loadAvailableSerials, productTracksSerial } from '../../lib/productSerial'
import ClientPicker, { clientFromRecord, emptyClientForm, type ClientFormValue } from '../../components/ClientPicker'
import { Search, Plus, Minus, Trash2, ShoppingBag, Wrench, ArrowDownCircle, AlertCircle, CheckCircle, Zap, FileText, LogOut, ScanLine, CreditCard, DollarSign, User, X as XIcon, RotateCcw, Tag, Percent, Save, Clock } from 'lucide-react'
import ReparationModal from './ReparationModal'
import RetourModal from './RetourModal'
import SortieCaisseModal from './SortieCaisseModal'
import UnknownBarcodeModal from './UnknownBarcodeModal'
import CheckoutModal from './CheckoutModal'
import ServicePOSModal from './ServicePOSModal'
import FactureClientModal from './FactureClientModal'
import TicketModal from './TicketModal'
import {
  deleteSavedPanier,
  listSavedPaniers,
  savePanierHold,
  type SavedPanier,
} from '../../lib/panierHold'

const api = window.api

export default function POSTab() {
  const { currentShift, showShiftModal, sessionClient, setSessionClient } = useAppStore()
  const { items, addItem, updateItem, removeItem, clearCart, loadCart, total, totalRemises, sousTotal, remiseTotale, setRemiseTotale } = useCartStore()

  const [scanInput, setScanInput] = useState('')
  const [scannedProduct, setScannedProduct] = useState<Produit | null>(null)
  const [qty, setQty] = useState(1)
  const [remise, setRemise] = useState(0)
  const [remiseMode, setRemiseMode] = useState<'%' | 'DT'>('%')
  const [remiseTotaleInput, setRemiseTotaleInput] = useState('')
  const [remiseTotaleMode, setRemiseTotaleMode] = useState<'%' | 'DT'>('DT')
  const [searchResults, setSearchResults] = useState<Produit[]>([])
  const [showSearch, setShowSearch] = useState(false)
  const [unknownBarcode, setUnknownBarcode] = useState<string | null>(null)
  const [showReparation, setShowReparation] = useState(false)
  const [showSortie, setShowSortie] = useState(false)
  const [showCheckout, setShowCheckout] = useState(false)
  const [showService, setShowService] = useState<ServicePOS | 'select' | null>(null)
  const [showFacture, setShowFacture] = useState(false)
  const [showCreditPaiement, setShowCreditPaiement] = useState(false)
  const [showLastTicket, setShowLastTicket] = useState(false)
  const [showRetour, setShowRetour] = useState(false)
  const [showProductBrowse, setShowProductBrowse] = useState(false)
  const [showSavedPaniers, setShowSavedPaniers] = useState(false)
  const [savedPanierCount, setSavedPanierCount] = useState(() => listSavedPaniers().length)
  const [availableSerials, setAvailableSerials] = useState<string[]>([])
  const [selectedSerials, setSelectedSerials] = useState<string[]>([])
  const [sessionClientForm, setSessionClientForm] = useState<ClientFormValue>(
    () => (sessionClient ? clientFromRecord(sessionClient) : emptyClientForm()),
  )
  const [lastVente, setLastVente] = useState<{ vente: Vente; items: CartItem[] } | null>(null)
  const [notification, setNotification] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const scanRef = useRef<HTMLInputElement>(null)
  const firstCharTimeRef = useRef<number>(0)
  const liveSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoSubmitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchVersion = useRef(0)
  const fuseRef = useRef<Fuse<Produit> | null>(null)
  const [scanFocused, setScanFocused] = useState(false)

  // SCANNER_SPEED_MS: max total ms for a full barcode scan (USB scanners: 30–80ms)
  const SCANNER_SPEED_MS = 200

  const refocusScanner = useCallback(() => {
    setTimeout(() => {
      // Only steal focus back to scanner if no other input is currently focused
      const ae = document.activeElement
      const otherFocused = ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement || ae instanceof HTMLSelectElement
      if (!otherFocused) scanRef.current?.focus()
    }, 100)
  }, [])

  useEffect(() => {
    refocusScanner()
  }, [scannedProduct])

  // Load all products on mount and build Fuse index for instant text search
  useEffect(() => {
    api.produitsList({}).then(prods => {
      const list = (prods as Produit[]) || []
      fuseRef.current = new Fuse(list, {
        keys: ['nom', 'reference', 'code_barre', 'categorie', 'fournisseur'],
        threshold: 0.35,
        minMatchCharLength: 2,
        ignoreLocation: true,
      })
    }).catch(err => console.error('[POS] Failed to load product index:', err))
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (showShiftModal) return
      if (e.key === 'F2') { e.preventDefault(); scanRef.current?.focus() }
      if (e.key === 'F3') { e.preventDefault(); setShowService('select') }
      if (e.key === 'F4') { e.preventDefault(); setShowReparation(true) }
      if (e.key === 'F5') { e.preventDefault(); setShowSortie(true) }
      if (e.key === 'F7') { e.preventDefault(); setShowCreditPaiement(true) }
      if (e.key === 'F8') { e.preventDefault(); if (items.length > 0) setShowCheckout(true) }
      if (e.key === 'F9') { e.preventDefault(); setShowRetour(true) }
      if (e.key === 'F10') { e.preventDefault(); window.dispatchEvent(new CustomEvent('smlpos:openFermeture')) }
      if (e.ctrlKey && e.key === 'p') { e.preventDefault(); if (lastVente) setShowLastTicket(true) }
      if (e.key === 'Escape') { e.preventDefault(); setScannedProduct(null); setScanInput('') }
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault()
        if (items.length > 0) removeItem(items.length - 1)
      }

      // Global auto-scan: redirect printable chars to scanner when no modal open,
      // scan not focused, AND no other input/textarea/select is focused
      const noModalOpen = !showCheckout && !showReparation && !showSortie && !showService && !showFacture && !showCreditPaiement && !showLastTicket && !unknownBarcode && !showRetour
      const ae = document.activeElement
      const otherInputFocused = ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement || ae instanceof HTMLSelectElement
      const scanInputFocused = ae === scanRef.current
      if (noModalOpen && !scanInputFocused && !otherInputFocused && !e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1) {
        e.preventDefault()
        scanRef.current?.focus()
        setScanInput(prev => {
          if (prev.length === 0) firstCharTimeRef.current = Date.now()
          return prev + e.key
        })
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [items, lastVente, showCheckout, showReparation, showSortie, showService, showFacture, showCreditPaiement, showLastTicket, unknownBarcode, showRetour, scanFocused, showShiftModal])

  const showNotif = (msg: string, type: 'success' | 'error' = 'success') => {
    setNotification({ msg, type })
    setTimeout(() => setNotification(null), 2500)
  }

  useEffect(() => {
    if (!scannedProduct || !productTracksSerial(scannedProduct)) {
      setAvailableSerials([])
      setSelectedSerials([])
      return
    }
    void loadAvailableSerials(scannedProduct, items).then(sns => {
      setAvailableSerials(sns)
      setSelectedSerials(prev => {
        const kept = prev.filter(sn => sns.includes(sn))
        if (kept.length) return kept.slice(0, qty)
        if (sns.length === 1 && qty === 1) return [sns[0]]
        return []
      })
    })
  }, [scannedProduct, items, qty])

  useEffect(() => {
    setSelectedSerials(prev => prev.slice(0, qty))
  }, [qty])

  const toggleSerialPick = (sn: string) => {
    setSelectedSerials(prev => {
      if (prev.includes(sn)) return prev.filter(s => s !== sn)
      if (prev.length >= qty) return prev
      return [...prev, sn]
    })
  }

  const pushProductToCart = (product: Produit, quantity: number, remisePct: number, serials: string[]) => {
    const unitTotal = product.prix_vente * (1 - remisePct / 100)
    if (serials.length > 1 && quantity === serials.length) {
      for (const sn of serials) {
        addItem({
          produit_id: product.id,
          designation: product.nom,
          quantite: 1,
          prix_unitaire: product.prix_vente,
          remise_pct: remisePct,
          total_ligne: unitTotal,
          type_produit: product.type,
          tva_taux: product.tva_taux ?? 0,
          numero_serie: sn,
        })
      }
      showNotif(`${product.nom} ×${serials.length} ajouté(s) au panier`)
    } else {
      addItem({
        produit_id: product.id,
        designation: product.nom,
        quantite: quantity,
        prix_unitaire: product.prix_vente,
        remise_pct: remisePct,
        total_ligne: unitTotal * quantity,
        type_produit: product.type,
        tva_taux: product.tva_taux ?? 0,
        numero_serie: serials.length ? serials.join(', ') : undefined,
      })
      showNotif(`${product.nom} ajouté au panier`)
    }
    setScannedProduct(null)
    setSelectedSerials([])
    setAvailableSerials([])
    setScanInput('')
    setRemise(0)
    refocusScanner()
  }

  const handleScanSubmit = async (code: string, fromScanner = false) => {
    // Cancel any pending auto-submit to avoid double-fire
    if (autoSubmitTimer.current) { clearTimeout(autoSubmitTimer.current); autoSubmitTimer.current = null }
    if (!code.trim()) return
    const trimmed = code.trim()
    setScanInput('')
    setShowSearch(false)
    firstCharTimeRef.current = 0

    // STEP 1 — Services POS (13-char barcodes)
    const service = await loadData('Recherche service', () => api.servicesPosFind(trimmed) as Promise<ServicePOS | null>, { silent: true })
    if (service) {
      setShowService(service)
      return
    }

    // STEP 2 — Product by barcode
    const product = await loadData('Recherche produit', () => api.produitsFindByBarcode(trimmed) as Promise<Produit | null>, { silent: true })
    if (product) {
      if (fromScanner && !productTracksSerial(product)) {
        if (product.type === 'F' && product.stock_actuel <= 0) {
          showNotif(`Stock épuisé — ${product.nom} ne peut pas être ajouté`, 'error')
          return
        }
        const alreadyInCart = items.some(i => i.produit_id === product.id && !i.numero_serie)
        const currentQty = items.find(i => i.produit_id === product.id && !i.numero_serie)?.quantite ?? 0
        addItem({
          produit_id: product.id,
          designation: product.nom,
          quantite: 1,
          prix_unitaire: product.prix_vente,
          remise_pct: 0,
          total_ligne: product.prix_vente,
          type_produit: product.type,
          tva_taux: product.tva_taux ?? 0,
        })
        if (alreadyInCart) {
          showNotif(`+1 × ${product.nom}  ×${currentQty + 1}`)
        } else {
          showNotif(`✓ ${product.nom} — ${formatPrice(product.prix_vente)}`)
        }
        refocusScanner()
        return
      }
      if (fromScanner && productTracksSerial(product)) {
        if (product.type === 'F' && product.stock_actuel <= 0) {
          showNotif(`Stock épuisé — ${product.nom} ne peut pas être ajouté`, 'error')
          return
        }
        showNotif(`Confirmer le S/N — ${product.nom}`, 'success')
      }
      setScannedProduct(product)
      setQty(1)
      setRemise(0)
      return
    }

    // STEP 3 — Text search
    const results = await loadData('Recherche produits', () => api.produitsList({ search: trimmed }) as Promise<Produit[]>, { silent: true }) ?? []
    if (results.length === 1) {
      if (fromScanner && !productTracksSerial(results[0])) {
        if (results[0].type === 'F' && results[0].stock_actuel <= 0) {
          showNotif(`Stock épuisé — ${results[0].nom} ne peut pas être ajouté`, 'error')
          return
        }
        const alreadyInCart = items.some(i => i.produit_id === results[0].id && !i.numero_serie)
        const currentQty = items.find(i => i.produit_id === results[0].id && !i.numero_serie)?.quantite ?? 0
        addItem({
          produit_id: results[0].id,
          designation: results[0].nom,
          quantite: 1,
          prix_unitaire: results[0].prix_vente,
          remise_pct: 0,
          total_ligne: results[0].prix_vente,
          type_produit: results[0].type,
          tva_taux: results[0].tva_taux ?? 0,
        })
        if (alreadyInCart) {
          showNotif(`+1 × ${results[0].nom}  ×${currentQty + 1}`)
        } else {
          showNotif(`✓ ${results[0].nom} — ${formatPrice(results[0].prix_vente)}`)
        }
        refocusScanner()
        return
      }
      setScannedProduct(results[0])
      setQty(1)
      setRemise(0)
      return
    }
    if (results.length > 1) {
      setSearchResults(results)
      setShowSearch(true)
      return
    }

    // STEP 4 — Unknown barcode
    if (/^\d{8,}$/.test(trimmed)) {
      setUnknownBarcode(trimmed)
    } else if (trimmed.length > 0) {
      showNotif(`Aucun produit trouvé pour "${trimmed}"`, 'error')
    }
  }

  const handleAddToCart = () => {
    if (!scannedProduct) return
    if (scannedProduct.type === 'F' && scannedProduct.stock_actuel <= 0) {
      showNotif(`Stock épuisé — ${scannedProduct.nom} ne peut pas être ajouté`, 'error')
      return
    }
    const effectivePct = remiseMode === 'DT'
      ? Math.min(100, (remise / scannedProduct.prix_vente) * 100)
      : remise
    const needsSerial = productTracksSerial(scannedProduct)
    if (needsSerial) {
      if (!availableSerials.length) {
        showNotif(`Aucun S/N disponible pour ${scannedProduct.nom}`, 'error')
        return
      }
      if (selectedSerials.length !== qty) {
        showNotif(`Sélectionnez ${qty} numéro(s) de série`, 'error')
        return
      }
    }
    pushProductToCart(scannedProduct, qty, effectivePct, needsSerial ? selectedSerials : [])
  }

  const handleServiceConfirm = (service: ServicePOS, montantFrais: number, note: string) => {
    addItem({
      designation: `${service.nom} — ${note}`,
      quantite: 1,
      prix_unitaire: montantFrais,
      remise_pct: 0,
      total_ligne: montantFrais,
      type_produit: 'NF',
      is_service: true,
      tva_taux: 0,
    })
    showNotif(`Service ${service.nom} — ${formatPrice(montantFrais)}`)
    setShowService(null)
    refocusScanner()
  }

  const handleCheckoutSuccess = (vente?: Vente, cartItems?: CartItem[]) => {
    showNotif('Vente enregistrée avec succès !')
    if (vente && cartItems) setLastVente({ vente, items: cartItems })
    setShowCheckout(false)
    clearCart()
    refocusScanner()
  }

  const hasItemsF = items.some(i => i.type_produit === 'F' && !i.is_service)
  const cartTotal = total()
  const cartSousTotal = sousTotal()
  const cartRemises = totalRemises()
  const effectiveTotal = Math.max(0, cartTotal - remiseTotale)
  const totalAllRemises = cartRemises + remiseTotale

  const handleRemiseTotaleChange = (val: string) => {
    setRemiseTotaleInput(val)
    const num = parseFloat(val.replace(',', '.')) || 0
    if (remiseTotaleMode === '%') {
      setRemiseTotale((cartTotal * num) / 100)
    } else {
      setRemiseTotale(Math.min(cartTotal, num))
    }
  }

  const refreshSavedPanierCount = () => setSavedPanierCount(listSavedPaniers().length)

  const handleSavePanier = () => {
    if (!items.length) return
    const saved = savePanierHold({
      items,
      remiseTotale,
      clientForm: sessionClientForm,
      shiftId: currentShift?.id,
    })
    clearCart()
    setRemiseTotaleInput('')
    setRemiseTotale(0)
    refreshSavedPanierCount()
    showNotif(`Panier en attente — ${saved.label}`)
    refocusScanner()
  }

  const handleRestorePanier = (panier: SavedPanier) => {
    if (items.length > 0 && !window.confirm('Remplacer le panier actuel par le panier en attente ?')) return
    loadCart(panier.items, panier.remiseTotale)
    if (panier.clientForm) {
      setSessionClientForm(panier.clientForm)
      setSessionClient(panier.clientForm.clientId ? {
        id: panier.clientForm.clientId,
        nom: panier.clientForm.nom,
        telephone: panier.clientForm.tel,
        adresse: panier.clientForm.adresse,
        matricule_fiscal: panier.clientForm.matricule,
        solde_credit: sessionClient?.id === panier.clientForm.clientId ? sessionClient.solde_credit : 0,
        created_at: sessionClient?.created_at ?? new Date().toISOString(),
      } : null)
    }
    setRemiseTotaleInput(panier.remiseTotale > 0 ? String(panier.remiseTotale) : '')
    deleteSavedPanier(panier.id)
    refreshSavedPanierCount()
    setShowSavedPaniers(false)
    showNotif(`Panier repris — ${panier.label}`)
    refocusScanner()
  }

  return (
    <div className="h-full flex overflow-hidden">
      {/* Left panel */}
      <div className="flex-1 p-4 flex flex-col gap-4 overflow-y-auto">
        {notification && (
          <div className={cn(
            'flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium animate-slide-in',
            notification.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
          )}>
            {notification.type === 'success' ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
            {notification.msg}
          </div>
        )}

        {/* Scanner */}
        <div className={cn(
          'rounded-xl border p-4 shadow-card transition-all',
          scanFocused ? 'bg-accent-50 border-accent-400' : 'bg-white border-border'
        )}>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
              Scanner / Code-barres
            </label>
            {scanFocused && (
              <span className="flex items-center gap-1 text-xs font-bold text-accent-600 animate-pulse">
                <ScanLine size={13} /> SCAN ACTIF
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <div className={cn(
              'flex-1 flex items-center gap-2 rounded-lg px-3 py-2.5 border transition-colors',
              scanFocused ? 'bg-white border-accent-500' : 'bg-muted border-border'
            )}>
              <Search size={16} className="text-text-muted flex-shrink-0" />
              <input
                ref={scanRef}
                type="text"
                value={scanInput}
                onChange={e => {
                  const val = e.target.value
                  // Track start time when first character arrives
                  if (val.length === 1 && scanInput.length === 0) {
                    firstCharTimeRef.current = Date.now()
                  }
                  setScanInput(val)

                  // Clear all pending timers
                  if (liveSearchTimer.current) clearTimeout(liveSearchTimer.current)
                  if (autoSubmitTimer.current) clearTimeout(autoSubmitTimer.current)

                  if (/^\d+$/.test(val)) {
                    // Barcode mode: hide text search dropdown
                    setShowSearch(false)
                    setSearchResults([])
                    // Auto-submit after 120ms pause (scanner sends chars fast then stops)
                    if (val.length >= 6) {
                      autoSubmitTimer.current = setTimeout(() => {
                        autoSubmitTimer.current = null
                        handleScanSubmit(val, true)
                      }, 120)
                    }
                  } else if (val.length >= 2) {
                    // Fuse.js instant in-memory search (no IPC round-trip, no debounce needed)
                    if (fuseRef.current) {
                      const hits = fuseRef.current.search(val, { limit: 10 }).map(r => r.item)
                      if (hits.length > 0) {
                        setSearchResults(hits)
                        setShowSearch(true)
                      } else {
                        setSearchResults([])
                        setShowSearch(false)
                      }
                    } else {
                      // Fuse not ready yet — fall back to IPC with stale guard
                      const version = ++searchVersion.current
                      liveSearchTimer.current = setTimeout(async () => {
                        const results = await loadData('Recherche produits', () => api.produitsList({ search: val }) as Promise<Produit[]>, { silent: true })
                        if (searchVersion.current !== version) return
                        if (results && results.length > 0) { setSearchResults(results.slice(0, 10)); setShowSearch(true) }
                        else { setSearchResults([]); setShowSearch(false) }
                      }, 220)
                    }
                  } else {
                    setShowSearch(false)
                    setSearchResults([])
                  }
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const elapsed = Date.now() - firstCharTimeRef.current
                    // Auto-add if: pure numeric barcode, or chars arrived very fast (USB scanner)
                    const isBarcode = /^\d{6,}$/.test(scanInput)
                    const fromScanner = isBarcode || (scanInput.length >= 6 && elapsed < SCANNER_SPEED_MS && elapsed > 0)
                    handleScanSubmit(scanInput, fromScanner)
                  }
                }}
                onFocus={() => setScanFocused(true)}
                onBlur={() => setScanFocused(false)}
                className="flex-1 bg-transparent outline-none text-sm"
                placeholder="Scanner code-barres ou saisir nom/référence..."
                autoFocus
              />
            </div>
            <button
              onClick={() => {
                // Auto-add for pure numeric barcodes; show panel for name searches
                const isBarcode = /^\d{6,}$/.test(scanInput)
                handleScanSubmit(scanInput, isBarcode)
              }}
              className="px-4 bg-accent-500 hover:bg-accent-600 text-text-primary font-semibold rounded-lg transition-colors text-sm"
            >
              OK
            </button>
          </div>

          <button
            onClick={() => setShowProductBrowse(true)}
            className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border hover:border-accent-400 hover:bg-accent-50 text-text-secondary hover:text-text-primary text-xs font-semibold transition-colors"
          >
            <ShoppingBag size={13} /> Parcourir produits
          </button>

          {showSearch && searchResults.length > 0 && (
            <div className="mt-2 border border-border rounded-lg overflow-hidden">
              {searchResults.slice(0, 8).map(p => (
                <button
                  key={p.id}
                  onClick={() => { setScannedProduct(p); setQty(1); setRemise(0); setShowSearch(false); setScanInput('') }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted text-left transition-colors border-b border-border last:border-0"
                >
                  <span className={p.type === 'F' ? 'badge-F' : 'badge-NF'}>{p.type}</span>
                  <span className="flex-1 text-sm font-medium">{p.nom}</span>
                  <span className="text-sm font-price text-text-secondary">{formatPrice(p.prix_vente)}</span>
                  <span className="text-xs text-text-muted">Stock: {p.stock_actuel}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Product detail */}
        {scannedProduct && (
          <div className="bg-white rounded-xl border-2 border-accent-400 p-4 shadow-card animate-slide-in">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={scannedProduct.type === 'F' ? 'badge-F' : 'badge-NF'}>{scannedProduct.type}</span>
                  <span className="text-xs text-text-muted">Réf: {scannedProduct.reference}</span>
                </div>
                <h3 className="font-bold text-text-primary text-base">{scannedProduct.nom}</h3>
                {scannedProduct.categorie && <span className="text-xs text-text-muted">{scannedProduct.categorie}</span>}
              </div>
              <div className="text-right">
                <div className="text-lg font-bold font-price text-text-primary">{formatPrice(scannedProduct.prix_vente)}</div>
                {scannedProduct.stock_actuel <= scannedProduct.stock_minimum && (
                  <div className="flex items-center gap-1 text-xs text-warning">
                    <AlertCircle size={11} /> Stock: {scannedProduct.stock_actuel}
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">Quantité</label>
                <div className="flex items-center gap-2">
                  <button onClick={() => setQty(Math.max(1, qty - 1))} className="w-8 h-8 rounded-lg bg-muted hover:bg-border flex items-center justify-center transition-colors"><Minus size={14} /></button>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={qty}
                    onChange={e => {
                      const cleaned = e.target.value.replace(/[^0-9]/g, '')
                      setQty(Math.max(1, parseInt(cleaned) || 1))
                    }}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddToCart() }}
                    className="w-16 text-center border border-border rounded-lg py-1.5 font-price font-semibold"
                  />
                  <button onClick={() => setQty(qty + 1)} className="w-8 h-8 rounded-lg bg-muted hover:bg-border flex items-center justify-center transition-colors"><Plus size={14} /></button>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-text-secondary">Remise</label>
                  <div className="flex rounded-lg border border-border overflow-hidden text-xs">
                    <button onClick={() => { setRemiseMode('%'); setRemise(0) }} className={cn('px-2 py-0.5 font-semibold transition-colors', remiseMode === '%' ? 'bg-accent-500 text-text-primary' : 'bg-white hover:bg-muted')}>%</button>
                    <button onClick={() => { setRemiseMode('DT'); setRemise(0) }} className={cn('px-2 py-0.5 font-semibold transition-colors', remiseMode === 'DT' ? 'bg-accent-500 text-text-primary' : 'bg-white hover:bg-muted')}>DT</button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={remise}
                    onChange={e => {
                      const val = e.target.value.replace(/[^0-9.,]/g, '')
                      const v = parseFloat(val.replace(',', '.')) || 0
                      if (remiseMode === '%') setRemise(Math.min(100, Math.max(0, v)))
                      else setRemise(Math.min(scannedProduct?.prix_vente ?? 0, Math.max(0, v)))
                    }}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddToCart() }}
                    className="w-20 text-center border border-border rounded-lg py-1.5 font-price font-semibold"
                    min={0} step={remiseMode === '%' ? 5 : 0.5}
                  />
                  <span className="text-text-secondary text-sm font-medium">{remiseMode}</span>
                </div>
              </div>
            </div>

            {scannedProduct && productTracksSerial(scannedProduct) && (
              <div className="mt-3 pt-3 border-t border-border">
                <label className="block text-xs font-semibold text-text-secondary mb-2">
                  Numéro(s) de série * <span className="text-text-muted">({selectedSerials.length}/{qty})</span>
                </label>
                {availableSerials.length === 0 ? (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    Aucun S/N disponible — vérifiez l&apos;inventaire.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                    {availableSerials.map(sn => {
                      const checked = selectedSerials.includes(sn)
                      return (
                        <button
                          key={sn}
                          type="button"
                          onClick={() => toggleSerialPick(sn)}
                          className={cn(
                            'text-[10px] px-2 py-1 rounded-lg border font-mono transition-colors',
                            checked ? 'bg-accent-100 border-accent-500 text-text-primary' : 'bg-muted border-border hover:bg-border',
                          )}
                        >
                          {sn}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
              <span className="text-sm text-text-secondary font-medium">Prix final :</span>
              <span className="text-lg font-bold font-price text-text-primary">
                {formatPrice(scannedProduct.prix_vente * (1 - (remiseMode === 'DT' ? Math.min(100, (remise / (scannedProduct.prix_vente || 1)) * 100) : remise) / 100) * qty)}
              </span>
            </div>

            <button
              onClick={handleAddToCart}
              disabled={!!scannedProduct && productTracksSerial(scannedProduct) && selectedSerials.length !== qty}
              className="w-full mt-3 flex items-center justify-center gap-2 bg-accent-500 hover:bg-accent-600 disabled:bg-gray-200 disabled:text-gray-400 text-text-primary font-bold py-2.5 rounded-xl transition-colors"
            >
              <Plus size={16} />
              Ajouter au Panier
            </button>
          </div>
        )}

        {/* Action buttons */}
        <div className="grid grid-cols-2 gap-2 mt-auto">
          <button onClick={() => setShowService('select')} className="flex items-center justify-center gap-2 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-800 py-3 rounded-xl font-semibold transition-colors text-sm">
            <Zap size={15} />Service (F3)
          </button>
          <button onClick={() => setShowReparation(true)} className="flex items-center justify-center gap-2 bg-white hover:bg-muted border border-border text-text-primary py-3 rounded-xl font-semibold transition-colors text-sm">
            <Wrench size={15} />Réparation (F4)
          </button>
          <button onClick={() => setShowSortie(true)} className="flex items-center justify-center gap-2 bg-white hover:bg-muted border border-border text-text-primary py-3 rounded-xl font-semibold transition-colors text-sm">
            <ArrowDownCircle size={15} />Sortie Caisse (F5)
          </button>
          <button onClick={() => setShowCreditPaiement(true)} className="flex items-center justify-center gap-2 bg-green-50 hover:bg-green-100 border border-green-300 text-green-800 py-2.5 rounded-xl font-semibold transition-colors text-sm">
            <CreditCard size={15} />Crédit Client (F7)
          </button>
          <button onClick={() => setShowRetour(true)} className="flex items-center justify-center gap-2 bg-red-50 hover:bg-red-100 border border-red-300 text-red-800 py-2.5 rounded-xl font-semibold transition-colors text-sm">
            <RotateCcw size={15} />Retour (F9)
          </button>
        </div>

        <div className="text-xs text-text-muted text-center flex flex-wrap gap-x-3 gap-y-1 justify-center">
          {['F2 Scanner','F3 Service','F4 Répar.','F5 Sortie','F7 Crédit','F8 Encaiss.','F9 Retour','F10 Clôture','Ctrl+P Ticket','Ctrl+Z Annuler'].map(s => (
            <span key={s}>{s}</span>
          ))}
        </div>
      </div>

      {/* Right panel - Cart */}
      <div className="w-80 bg-white border-l border-border flex flex-col">
        <div className="px-4 py-3 border-b border-border space-y-2">
          <h2 className="font-bold text-sm text-text-primary flex items-center gap-2">
            <ShoppingBag size={15} />
            Panier Actuel
            {items.length > 0 && (
              <span className="ml-auto bg-accent-500 text-text-primary text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
                {items.length}
              </span>
            )}
          </h2>
          <ClientPicker
            compact
            value={sessionClientForm}
            onChange={v => {
              setSessionClientForm(v)
              setSessionClient(v.clientId ? {
                id: v.clientId,
                nom: v.nom,
                telephone: v.tel,
                adresse: v.adresse,
                matricule_fiscal: v.matricule,
                solde_credit: sessionClient?.id === v.clientId ? sessionClient.solde_credit : 0,
                created_at: sessionClient?.created_at ?? new Date().toISOString(),
              } : null)
            }}
          />
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-text-muted">
              <ShoppingBag size={32} className="mb-2 opacity-30" />
              <p className="text-sm">Panier vide</p>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((item, idx) => (
                <div key={idx} className={cn('flex items-start gap-2 p-2.5 rounded-lg group', item.is_service ? 'bg-blue-50' : 'bg-muted')}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      {item.is_service
                        ? <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 font-semibold border border-blue-200">SVC</span>
                        : <span className={item.type_produit === 'F' ? 'badge-F' : 'badge-NF'}>{item.type_produit}</span>
                      }
                    </div>
                    <p className="text-xs font-medium truncate">{item.designation}</p>
                    {item.numero_serie && (
                      <p className="text-[10px] font-mono text-accent-700 truncate">S/N: {item.numero_serie}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      <button onClick={() => { const nq = item.quantite - 1; if (nq <= 0) removeItem(idx); else if (!item.numero_serie) updateItem(idx, { quantite: nq }); else removeItem(idx) }} className="w-5 h-5 rounded bg-white flex items-center justify-center hover:bg-border text-xs">-</button>
                      <span className="font-price text-xs font-semibold">{item.quantite}</span>
                      {!item.numero_serie && (
                        <button onClick={() => updateItem(idx, { quantite: item.quantite + 1 })} className="w-5 h-5 rounded bg-white flex items-center justify-center hover:bg-border text-xs">+</button>
                      )}
                      {item.remise_pct > 0 && <span className="text-xs text-danger font-medium">-{item.remise_pct}%</span>}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="font-price text-xs font-bold">{formatPrice(item.total_ligne)}</span>
                    <button onClick={() => removeItem(idx)} className="opacity-0 group-hover:opacity-100 text-danger hover:text-red-700 transition-all">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {items.length > 0 && (
          <div className="border-t border-border p-4">
            {cartSousTotal > cartTotal && (
              <div className="flex justify-between text-sm text-text-secondary mb-1">
                <span>Sous-total</span><span className="font-price">{formatPrice(cartSousTotal)}</span>
              </div>
            )}
            {cartRemises > 0 && (
              <div className="flex justify-between text-sm text-danger mb-1">
                <span>Remises article</span><span className="font-price">-{formatPrice(cartRemises)}</span>
              </div>
            )}
            {/* Remise totale sur panier */}
            <div className="flex items-center gap-2 mb-2">
              <Tag size={11} className="text-text-muted flex-shrink-0" />
              <span className="text-xs text-text-secondary flex-1">Remise panier</span>
              <div className="flex rounded border border-border overflow-hidden text-[10px]">
                <button onClick={() => { setRemiseTotaleMode('%'); setRemiseTotaleInput(''); setRemiseTotale(0) }} className={cn('px-1.5 py-0.5 font-bold', remiseTotaleMode === '%' ? 'bg-accent-500' : 'bg-white hover:bg-muted')}><Percent size={9} /></button>
                <button onClick={() => { setRemiseTotaleMode('DT'); setRemiseTotaleInput(''); setRemiseTotale(0) }} className={cn('px-1.5 py-0.5 font-bold', remiseTotaleMode === 'DT' ? 'bg-accent-500' : 'bg-white hover:bg-muted')}>DT</button>
              </div>
              <input
                type="text"
                inputMode="decimal"
                value={remiseTotaleInput}
                onChange={e => handleRemiseTotaleChange(e.target.value.replace(/[^0-9.,]/g, ''))}
                className="w-16 border border-border rounded px-2 py-0.5 text-xs font-price text-center outline-none focus:border-accent-500"
                placeholder="0"
              />
            </div>
            {remiseTotale > 0 && (
              <div className="flex justify-between text-sm text-danger mb-1">
                <span>Remise panier</span><span className="font-price">-{formatPrice(remiseTotale)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-base mb-4">
              <span>Total TTC</span>
              <span className="font-price text-lg">{formatPrice(effectiveTotal)}</span>
            </div>

            <button onClick={() => setShowCheckout(true)} className="w-full bg-accent-500 hover:bg-accent-600 text-text-primary font-bold py-3 rounded-xl mb-2 transition-colors flex items-center justify-center gap-2">
              <ShoppingBag size={16} />Encaisser (F8)
            </button>
            <button
              onClick={handleSavePanier}
              className="w-full bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-800 font-semibold py-2.5 rounded-xl mb-2 transition-colors flex items-center justify-center gap-2 text-sm"
            >
              <Save size={14} />Mettre en attente
            </button>
            {savedPanierCount > 0 && (
              <button
                onClick={() => setShowSavedPaniers(true)}
                className="w-full bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 font-semibold py-2 rounded-xl mb-2 transition-colors flex items-center justify-center gap-2 text-sm"
              >
                <Clock size={14} />Paniers en attente ({savedPanierCount})
              </button>
            )}
            <button onClick={clearCart} className="w-full bg-white hover:bg-red-50 border border-border hover:border-red-200 text-text-secondary hover:text-danger font-medium py-2 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm">
              <Trash2 size={14} />Vider le panier
            </button>
          </div>
        )}

        <div className="px-4 pb-3">
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('smlpos:openFermeture'))}
            className="w-full flex items-center justify-center gap-2 text-xs text-text-muted hover:text-danger py-2 rounded-lg hover:bg-red-50 transition-colors"
          >
            <LogOut size={12} />Clôturer shift (F10)
          </button>
        </div>
      </div>

      {/* Modals */}
      {unknownBarcode && (
        <UnknownBarcodeModal
          barcode={unknownBarcode}
          onClose={() => { setUnknownBarcode(null); refocusScanner() }}
          onProductCreated={p => { setScannedProduct(p); setUnknownBarcode(null) }}
          onFreeAdd={(designation, prix) => {
            addItem({ designation, quantite: 1, prix_unitaire: prix, remise_pct: 0, total_ligne: prix, type_produit: 'NF', is_libre: true, tva_taux: 0 })
            setUnknownBarcode(null)
            showNotif('Vente libre ajoutée')
            refocusScanner()
          }}
        />
      )}
      {showReparation && <ReparationModal onClose={() => { setShowReparation(false); refocusScanner() }} />}
      {showSortie && <SortieCaisseModal onClose={() => { setShowSortie(false); refocusScanner() }} />}
      {showCheckout && (
        <CheckoutModal
          items={items} total={effectiveTotal} sousTotal={cartSousTotal} totalRemises={totalAllRemises}
          initialClient={sessionClientForm}
          onClose={() => { setShowCheckout(false); refocusScanner() }}
          onSuccess={handleCheckoutSuccess}
        />
      )}
      {showService === 'select' && <ServiceSelectorModal onSelect={s => setShowService(s)} onClose={() => { setShowService(null); refocusScanner() }} />}
      {showService && showService !== 'select' && (
        <ServicePOSModal
          service={showService as ServicePOS}
          onClose={() => { setShowService(null); refocusScanner() }}
          onConfirm={handleServiceConfirm}
        />
      )}
      {showFacture && <FactureClientModal items={items} onClose={() => { setShowFacture(false); refocusScanner() }} />}
      {showLastTicket && lastVente && (
        <TicketModal
          vente={lastVente.vente}
          items={lastVente.items}
          onClose={() => { setShowLastTicket(false); refocusScanner() }}
        />
      )}
      {showRetour && (
        <RetourModal
          currentShift={currentShift as { id?: string; operateur_nom?: string } | null}
          onClose={() => { setShowRetour(false); refocusScanner() }}
          onSuccess={(msg) => { showNotif(msg); setShowRetour(false); refocusScanner() }}
        />
      )}
      {showCreditPaiement && (
        <CreditClientPaiementModal
          currentShift={currentShift as { id?: string; operateur_nom?: string } | null}
          onClose={() => { setShowCreditPaiement(false); refocusScanner() }}
          onSuccess={(clientNom, montant) => {
            showNotif(`Paiement de ${formatPrice(montant)} encaissé — ${clientNom}`)
            setShowCreditPaiement(false)
            refocusScanner()
          }}
        />
      )}
      {showProductBrowse && (
        <ProductBrowseModal
          onClose={() => { setShowProductBrowse(false); refocusScanner() }}
          onSelect={(p) => {
            setShowProductBrowse(false)
            setScannedProduct(p)
            setQty(1)
            setRemise(0)
          }}
        />
      )}
      {showSavedPaniers && (
        <SavedPaniersModal
          onClose={() => { setShowSavedPaniers(false); refocusScanner() }}
          onRestore={handleRestorePanier}
          onDelete={(id) => { deleteSavedPanier(id); refreshSavedPanierCount() }}
        />
      )}
    </div>
  )
}

function SavedPaniersModal({
  onClose,
  onRestore,
  onDelete,
}: {
  onClose: () => void
  onRestore: (p: SavedPanier) => void
  onDelete: (id: string) => void
}) {
  const [paniers, setPaniers] = useState(() => listSavedPaniers())

  const refresh = () => setPaniers(listSavedPaniers())

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-slide-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-bold text-sm flex items-center gap-2">
            <Clock size={15} className="text-amber-600" /> Paniers en attente
          </h2>
          <button type="button" onClick={onClose}><XIcon size={18} className="text-text-muted" /></button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-3 space-y-2">
          {paniers.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-8">Aucun panier en attente</p>
          ) : paniers.map(p => {
            const qty = p.items.reduce((s, i) => s + i.quantite, 0)
            const totalPanier = p.items.reduce((s, i) => s + i.total_ligne, 0) - p.remiseTotale
            return (
              <div key={p.id} className="border border-border rounded-xl p-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{p.label}</div>
                  <div className="text-xs text-text-muted mt-0.5">
                    {new Date(p.savedAt).toLocaleString('fr-FR')} · {qty} art. · {formatPrice(Math.max(0, totalPanier))}
                  </div>
                  {p.clientForm?.nom && (
                    <div className="text-[10px] text-text-secondary mt-1 truncate">Client : {p.clientForm.nom}</div>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => onRestore(p)}
                    className="px-3 py-1.5 bg-accent-500 hover:bg-accent-600 text-text-primary text-xs font-bold rounded-lg"
                  >
                    Reprendre
                  </button>
                  <button
                    type="button"
                    onClick={() => { onDelete(p.id); refresh() }}
                    className="px-3 py-1.5 bg-muted hover:bg-red-50 text-danger text-xs font-semibold rounded-lg"
                  >
                    Suppr.
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        <div className="px-5 py-3 border-t border-border">
          <button type="button" onClick={onClose} className="w-full py-2 bg-muted hover:bg-border rounded-xl text-sm font-semibold">
            Fermer
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Product Browse Modal ──────────────────────────────────────────────────────
function ProductBrowseModal({ onClose, onSelect }: { onClose: () => void; onSelect: (p: Produit) => void }) {
  const [allProducts, setAllProducts] = useState<Produit[]>([])
  const [categories, setCategories] = useState<{ id: string; nom: string }[]>([])
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'F' | 'NF'>('all')
  const [filterCat, setFilterCat] = useState('all')
  const fuseInst = useRef<Fuse<Produit> | null>(null)
  const [results, setResults] = useState<Produit[]>([])

  useEffect(() => {
    Promise.all([api.produitsList({ actif: 1 }), api.categoriesList()]).then(([prods, cats]) => {
      const list = (prods as Produit[]) || []
      setAllProducts(list)
      setCategories((cats as { id: string; nom: string }[]) || [])
      fuseInst.current = new Fuse(list, { keys: ['nom', 'reference', 'code_barre'], threshold: 0.35, minMatchCharLength: 2, ignoreLocation: true })
      setResults(list)
    })
  }, [])

  useEffect(() => {
    let filtered = allProducts
    if (filterType !== 'all') filtered = filtered.filter(p => p.type === filterType)
    if (filterCat !== 'all') filtered = filtered.filter(p => p.categorie === filterCat || p.categorie_id === filterCat)
    if (search.trim().length >= 2 && fuseInst.current) {
      const hits = new Fuse(filtered, { keys: ['nom', 'reference', 'code_barre'], threshold: 0.35, minMatchCharLength: 2, ignoreLocation: true })
        .search(search.trim(), { limit: 60 }).map(r => r.item)
      setResults(hits)
    } else {
      setResults(filtered.slice(0, 100))
    }
  }, [search, filterType, filterCat, allProducts])

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col animate-slide-in">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="font-bold text-sm flex items-center gap-2"><ShoppingBag size={15} /> Parcourir Produits</h2>
          <button onClick={onClose}><XIcon size={18} className="text-text-muted" /></button>
        </div>
        {/* Filters */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border flex-wrap">
          <div className="flex items-center gap-1.5 border border-border rounded-lg px-3 py-1.5 bg-muted flex-1 min-w-[180px]">
            <Search size={13} className="text-text-muted" />
            <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
              className="flex-1 bg-transparent outline-none text-sm" placeholder="Rechercher nom, référence..." />
          </div>
          <div className="flex gap-1">
            {(['all', 'F', 'NF'] as const).map(t => (
              <button key={t} onClick={() => setFilterType(t)}
                className={cn('px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors',
                  filterType === t ? 'bg-accent-500 border-accent-500 text-text-primary' : 'bg-white border-border text-text-secondary hover:bg-muted')}>
                {t === 'all' ? 'Tous' : t}
              </button>
            ))}
          </div>
          <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
            className="border border-border rounded-lg px-2 py-1.5 text-xs outline-none focus:border-accent-500 bg-white">
            <option value="all">Toutes catégories</option>
            {categories.map(c => <option key={c.id} value={c.nom}>{c.nom}</option>)}
          </select>
        </div>
        {/* Product list */}
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted sticky top-0">
              <tr>
                <th className="text-left px-4 py-2 font-semibold text-text-secondary">Produit</th>
                <th className="text-center px-3 py-2 font-semibold text-text-secondary">Type</th>
                <th className="text-right px-3 py-2 font-semibold text-text-secondary">Prix</th>
                <th className="text-center px-3 py-2 font-semibold text-text-secondary">Stock</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {results.map(p => {
                const rupture = p.type === 'F' && p.stock_actuel <= 0
                return (
                  <tr key={p.id} className={cn('border-b border-border last:border-0', rupture ? 'opacity-50 bg-gray-50' : 'hover:bg-accent-50')}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-text-primary">{p.nom}</div>
                      <div className="text-text-muted text-[10px]">{p.reference}</div>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={p.type === 'F' ? 'badge-F' : 'badge-NF'}>{p.type}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-price font-semibold">{formatPrice(p.prix_vente)}</td>
                    <td className="px-3 py-2.5 text-center">
                      {rupture
                        ? <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-[10px] font-bold">Rupture</span>
                        : <span className={cn('font-semibold', p.stock_actuel <= p.stock_minimum ? 'text-warning' : 'text-text-primary')}>{p.stock_actuel}</span>
                      }
                    </td>
                    <td className="px-3 py-2.5">
                      <button
                        onClick={() => !rupture && onSelect(p)}
                        disabled={rupture}
                        className="px-3 py-1 bg-accent-500 hover:bg-accent-600 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-text-primary font-semibold rounded-lg transition-colors"
                      >
                        + Ajouter
                      </button>
                    </td>
                  </tr>
                )
              })}
              {results.length === 0 && (
                <tr><td colSpan={5} className="text-center py-8 text-text-muted">Aucun produit trouvé</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-border text-xs text-text-muted text-right">
          {results.length} produit(s) affiché(s)
        </div>
      </div>
    </div>
  )
}

// ── Credit Client Paiement Modal ─────────────────────────────────────────────
interface ClientMin { id: string; nom: string; telephone?: string; solde_credit: number }

function CreditClientPaiementModal({
  currentShift, onClose, onSuccess,
}: {
  currentShift: { id?: string; operateur_nom?: string } | null
  onClose: () => void
  onSuccess: (clientNom: string, montant: number) => void
}) {
  const [search, setSearch] = useState('')
  const [clients, setClients] = useState<ClientMin[]>([])
  const [selected, setSelected] = useState<ClientMin | null>(null)
  const [montant, setMontant] = useState('')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      if (search.length >= 2) {
        const r = await loadData('Recherche clients', () => api.clientsList({ search }), { silent: true })
        if (r) setClients((r as ClientMin[]).slice(0, 6))
      } else if (!selected) {
        const r = await loadData('Chargement clients', () => api.clientsList({}), { silent: true })
        if (r) setClients((r as ClientMin[]).slice(0, 8))
      }
    }
    load()
  }, [search, selected])

  const montantNum = parseFloat(montant.replace(',', '.')) || 0

  const handleSave = async () => {
    if (!selected || montantNum <= 0) return
    setError('')
    await runAction('Encaissement crédit', async () => {
      await api.creditsCreate({
        id: crypto.randomUUID(),
        client_id: selected.id,
        client_nom: selected.nom,
        shift_id: currentShift?.id ?? null,
        type: 'PAIEMENT',
        montant: montantNum,
        reference: null,
        note: note.trim() || null,
        operateur: currentShift?.operateur_nom ?? 'superadmin',
        created_at: new Date().toISOString(),
      })
      onSuccess(selected.nom, montantNum)
    }, { setLoading, silent: true, onError: setError, successMessage: 'Paiement enregistré' })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-[420px] animate-slide-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-bold text-base flex items-center gap-2">
            <CreditCard size={15} className="text-green-600" /> Encaisser Crédit Client (F7)
          </h2>
          <button onClick={onClose}><XIcon size={18} className="text-text-muted" /></button>
        </div>
        <div className="p-5 space-y-4">
          {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
          {/* Client search */}
          {!selected ? (
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1">Rechercher un client</label>
              <div className="flex items-center gap-2 border border-border rounded-xl px-3 py-2.5 focus-within:border-accent-500">
                <Search size={13} className="text-text-muted" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  autoFocus
                  className="flex-1 bg-transparent text-sm outline-none"
                  placeholder="Nom ou téléphone..."
                />
              </div>
              <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                {clients.filter(c => c.solde_credit > 0).map(c => (
                  <button key={c.id} onClick={() => setSelected(c)}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-accent-50 border border-transparent hover:border-accent-300 text-sm transition-colors">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-orange-100 text-orange-700 font-bold text-xs flex items-center justify-center">
                        {c.nom.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="text-left">
                        <div className="font-semibold">{c.nom}</div>
                        {c.telephone && <div className="text-xs text-text-muted">{c.telephone}</div>}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-price font-bold text-red-600 text-xs">{formatPrice(c.solde_credit)}</div>
                      <div className="text-[10px] text-text-muted">Doit</div>
                    </div>
                  </button>
                ))}
                {clients.filter(c => c.solde_credit > 0).length === 0 && (
                  <p className="text-xs text-text-muted text-center py-3">Aucun client débiteur trouvé</p>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Selected client */}
              <div className="flex items-center justify-between bg-orange-50 border border-orange-200 rounded-xl px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-orange-100 text-orange-700 font-bold text-sm flex items-center justify-center">
                    {selected.nom.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="font-bold text-sm">{selected.nom}</div>
                    <div className="text-xs text-orange-600">Solde dû : <span className="font-price font-bold">{formatPrice(selected.solde_credit)}</span></div>
                  </div>
                </div>
                <button onClick={() => { setSelected(null); setMontant('') }} className="text-text-muted hover:text-danger">
                  <XIcon size={14} />
                </button>
              </div>

              {/* Amount */}
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1">Montant encaissé (DT) *</label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={montant}
                    onChange={e => setMontant(e.target.value.replace(/[^0-9.,]/g, ''))}
                    autoFocus
                    onKeyDown={e => e.key === 'Enter' && handleSave()}
                    className="w-full border border-border rounded-xl px-4 py-3 font-price text-2xl font-bold outline-none focus:border-green-500 text-center pr-14"
                    placeholder="0.000"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-text-muted font-semibold">DT</span>
                </div>
              </div>

              {/* Note */}
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1">Note</label>
                <input
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  className="w-full border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent-500"
                  placeholder="Facultatif..."
                />
              </div>

              {montantNum > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-2.5 flex justify-between items-center">
                  <span className="text-sm text-green-800 font-semibold">Nouveau solde</span>
                  <span className="font-price font-bold text-green-700">
                    {formatPrice(Math.max(0, selected.solde_credit - montantNum))}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex gap-3 px-5 py-4 border-t border-border">
          <button type="button" onClick={onClose} className="flex-1 bg-muted hover:bg-border font-semibold py-2.5 rounded-xl text-sm transition-colors">Annuler</button>
          {selected && (
            <button
              type="button"
              onClick={handleSave}
              disabled={loading || montantNum <= 0}
              className="flex-1 bg-green-500 hover:bg-green-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold py-2.5 rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
            >
              {loading ? 'Enregistrement...' : <><DollarSign size={14} /> Encaisser {formatPrice(montantNum)}</>}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Inline Service Selector ──────────────────────────────────────────────────
function ServiceSelectorModal({ onSelect, onClose }: { onSelect: (s: ServicePOS) => void; onClose: () => void }) {
  const [services, setServices] = useState<ServicePOS[]>([])

  useEffect(() => {
    loadData('Chargement services', () => api.servicesPosList(), { silent: true }).then(s => {
      if (s) setServices(s as ServicePOS[])
    })
  }, [])

  const colors = [
    'bg-green-50 border-green-300 hover:bg-green-100',
    'bg-red-50 border-red-300 hover:bg-red-100',
    'bg-orange-50 border-orange-300 hover:bg-orange-100',
  ]

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-[380px] animate-slide-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-bold text-base flex items-center gap-2">
            <Zap size={16} className="text-accent-500" />
            Choisir un service
          </h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">✕</button>
        </div>
        <div className="p-6 grid gap-3">
          {services.map((svc, i) => (
            <button
              key={svc.id}
              onClick={() => onSelect(svc)}
              className={`flex items-center gap-4 p-4 rounded-xl border-2 font-semibold text-left transition-all ${colors[i % colors.length]}`}
            >
              <span className="text-2xl">🏦</span>
              <div>
                <div className="font-bold text-text-primary">{svc.nom}</div>
                <div className="text-xs text-text-muted">Code: {svc.code_barre}</div>
              </div>
            </button>
          ))}
          {services.length === 0 && (
            <p className="text-center text-text-muted text-sm py-4">Chargement...</p>
          )}
        </div>
      </div>
    </div>
  )
}

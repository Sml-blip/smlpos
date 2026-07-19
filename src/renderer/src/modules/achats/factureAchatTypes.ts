import { generateId, generateReference } from '../../lib/utils'
import { generateInternalEan13 } from '../../lib/ean13'

export type PendingProduct = {
  nom: string
  reference: string
  code_barre: string | null
  prix_achat: number | null
  prix_vente: number
  categorie: string
  type: 'F' | 'NF'
  tva_taux?: number
  description?: string | null
  cout_supplementaire?: number
  tva_achat_pct?: number
  marge_pct?: number | null
  coef_av?: number | null
  cout_de_revient?: number | null
  prix_vente_ht?: number | null
  prix_achat_ttc?: number | null
  stock_minimum?: number
  fournisseur?: string | null
  numero_serie?: string | null
}

export type FactureLigneState = {
  id: string
  designation: string
  quantite: number
  nouveau_prix_achat: number
  tva_taux: number
  produit_id: string
  pendingProduct?: PendingProduct
  /** Cached when a serial-tracked product is linked */
  tracks_serial?: boolean
  /** One S/N per unit for serial-tracked products */
  numeros_serie?: string[]
}

export function productTracksSerial(prod: {
  has_serial_number?: number | boolean | null
  numero_serie?: string | null
}): boolean {
  return !!prod.has_serial_number || !!(prod.numero_serie?.trim())
}

export function emptyFactureLigne(): FactureLigneState {
  return {
    id: generateId(),
    designation: '',
    quantite: 1,
    nouveau_prix_achat: 0,
    tva_taux: 0,
    produit_id: '',
  }
}

export function syncSerialNumsForQty(numeros_serie: string[] | undefined, quantite: number): string[] {
  const qty = Math.max(1, quantite)
  const prev = numeros_serie ?? []
  return Array.from({ length: qty }, (_, i) => prev[i] ?? '')
}

export function lineTracksSerial(
  l: FactureLigneState,
  produits: { id: string; has_serial_number?: number; numero_serie?: string | null }[],
): boolean {
  if (l.tracks_serial) return true
  if (!l.produit_id) return false
  const p = produits.find(x => x.id === l.produit_id)
  return p ? productTracksSerial(p) : false
}

export function lineRequiresSerialValidation(l: FactureLigneState): boolean {
  return !!l.tracks_serial
}

export function serialNumsForLine(
  l: FactureLigneState,
  produits: { id: string; has_serial_number?: number; numero_serie?: string | null }[],
): string[] | undefined {
  if (!lineTracksSerial(l, produits)) return undefined
  return syncSerialNumsForQty(l.numeros_serie, l.quantite)
}

export function lineHasInventoryLink(l: FactureLigneState): boolean {
  return !!l.produit_id || !!l.pendingProduct
}

export function validateSerialLines(
  lignes: FactureLigneState[],
  produits: { id: string; has_serial_number?: number; numero_serie?: string | null; nom?: string }[],
): string | null {
  for (const l of lignes) {
    if (!lineRequiresSerialValidation(l)) continue
    if (!lineHasInventoryLink(l)) {
      return `Ligne « ${l.designation || 'sans nom'} » : liez un produit inventaire pour les numéros de série`
    }
    const nums = syncSerialNumsForQty(l.numeros_serie, l.quantite)
    const filled = nums.map(s => s.trim()).filter(Boolean)
    const name = produits.find(p => p.id === l.produit_id)?.nom ?? l.designation
    if (filled.length !== l.quantite) {
      return `"${name}" : renseignez ${l.quantite} numéro(s) de série (${filled.length}/${l.quantite})`
    }
    if (new Set(filled.map(s => s.toLowerCase())).size !== filled.length) {
      return `"${name}" : numéros de série en double sur la même ligne`
    }
  }
  const allFilled: string[] = []
  for (const l of lignes) {
    if (!lineRequiresSerialValidation(l)) continue
    allFilled.push(...syncSerialNumsForQty(l.numeros_serie, l.quantite).map(s => s.trim()).filter(Boolean))
  }
  if (new Set(allFilled.map(s => s.toLowerCase())).size !== allFilled.length) {
    return 'Numéros de série en double entre plusieurs lignes'
  }
  return null
}

export function mergeProductIntoLine(
  l: FactureLigneState,
  p: {
    id: string
    nom: string
    prix_achat?: number | null
    prix_vente: number
    tva_taux?: number
    has_serial_number?: number
    numero_serie?: string | null
  },
): FactureLigneState {
  const tracks = productTracksSerial(p)
  return {
    ...l,
    produit_id: p.id,
    designation: p.nom,
    nouveau_prix_achat: p.prix_achat ?? p.prix_vente,
    tva_taux: p.tva_taux ?? l.tva_taux,
    pendingProduct: undefined,
    tracks_serial: tracks,
    numeros_serie: tracks ? syncSerialNumsForQty(l.numeros_serie, l.quantite) : undefined,
  }
}

export function newLineFromProduct(
  p: {
    id: string
    nom: string
    prix_achat?: number | null
    prix_vente: number
    tva_taux?: number
    has_serial_number?: number
    numero_serie?: string | null
  },
  quantite = 1,
): FactureLigneState {
  const tracks = productTracksSerial(p)
  return {
    id: generateId(),
    designation: p.nom,
    quantite,
    nouveau_prix_achat: p.prix_achat ?? p.prix_vente,
    tva_taux: p.tva_taux ?? 0,
    produit_id: p.id,
    tracks_serial: tracks,
    numeros_serie: tracks ? syncSerialNumsForQty([], quantite) : undefined,
  }
}

export function generatePendingBarcode(): string {
  return generateInternalEan13()
}

export function pendingFromQuickCreate(
  nom: string,
  prixAchat: string,
  prixVente: string,
): PendingProduct {
  return {
    nom: nom.trim(),
    reference: generateReference(),
    code_barre: generatePendingBarcode(),
    prix_achat: parseFloat(prixAchat) || null,
    prix_vente: parseFloat(prixVente) || 0,
    categorie: 'Général',
    type: 'F',
    tva_taux: 0,
    stock_minimum: 5,
  }
}

export function ligneBarcodeInfo(
  l: FactureLigneState,
  produits: { id: string; nom: string; code_barre?: string; reference: string; prix_vente: number }[],
): { code: string; nom: string; prix: number; ref: string } | null {
  if (l.pendingProduct?.code_barre) {
    return {
      code: l.pendingProduct.code_barre,
      nom: l.pendingProduct.nom,
      prix: l.pendingProduct.prix_vente,
      ref: l.pendingProduct.reference,
    }
  }
  if (l.produit_id) {
    const p = produits.find((x) => x.id === l.produit_id)
    if (p?.code_barre) {
      return {
        code: p.code_barre,
        nom: p.nom,
        prix: p.prix_vente,
        ref: p.reference,
      }
    }
  }
  return null
}

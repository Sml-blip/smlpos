import { generateId, generateReference } from '../../lib/utils'

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

export function generatePendingBarcode(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const rand = String(Math.floor(Math.random() * 99999)).padStart(5, '0')
  return `SML-${date}-${rand}`
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

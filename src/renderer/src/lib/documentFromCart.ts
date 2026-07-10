import type { CartItem, Vente } from './types'
import type { InvoiceLineData } from '../components/InvoicePrintTemplate'
import {
  applyTotalsToDoc,
  buildInvoiceLineFromCart,
  round3,
  sumInvoiceLines,
} from './invoiceLineCalc'
import type { InvoiceDocData } from '../components/InvoicePrintTemplate'
import { documentAllowsNF, filterLignesForDocument } from './documentProductRules'

export function cartLineRemiseTotal(items: CartItem[]): number {
  return round3(items.reduce((s, item) => {
    const brut = item.quantite * item.prix_unitaire
    return s + brut * (item.remise_pct / 100)
  }, 0))
}

/** Cart-level remise (panier), excluding per-line remises already in items. */
export function remisePanierFromVente(vente: Vente, items: CartItem[]): number {
  return Math.max(0, round3((vente.total_remises ?? 0) - cartLineRemiseTotal(items)))
}

export function tvaRateForCartItem(
  item: CartItem,
  defaultTva: number,
  calculateTva: boolean,
): number {
  if (!calculateTva || item.type_produit !== 'F') return 0
  return item.tva_taux ?? defaultTva
}

export function documentCalculatesTva(typeDocument: string): boolean {
  return typeDocument === 'FACTURE_VENTE'
    || typeDocument === 'FACTURE_JOURNALIERE_F'
    || typeDocument === 'BON_LIVRAISON'
    || typeDocument === 'DEVIS'
}

export function cartItemsToInvoiceLines(
  items: CartItem[],
  typeDocument: string,
  defaultTva: number,
): InvoiceLineData[] {
  const eligible = filterLignesForDocument(typeDocument, items)
  const withTva = documentCalculatesTva(typeDocument)
  return eligible.map((item, idx) => buildInvoiceLineFromCart({
    id: item.produit_id || `line-${idx}`,
    designation: item.designation,
    quantite: item.quantite,
    prix_unitaire_ttc: item.prix_unitaire,
    remise_pct: item.remise_pct || 0,
    tva_taux: tvaRateForCartItem(item, defaultTva, withTva),
    numero_serie: item.numero_serie ?? null,
  }))
}

export function taxBucketsFromLines(lignes: InvoiceLineData[]): {
  ht_7: number
  tva_7: number
  ht_19: number
  tva_19: number
} {
  let ht_7 = 0
  let tva_7 = 0
  let ht_19 = 0
  let tva_19 = 0
  for (const l of lignes) {
    const rate = Math.round(l.tva_taux || 0)
    if (rate <= 7) {
      ht_7 += l.total_ht
      tva_7 += l.total_tva
    } else {
      ht_19 += l.total_ht
      tva_19 += l.total_tva
    }
  }
  return {
    ht_7: round3(ht_7),
    tva_7: round3(tva_7),
    ht_19: round3(ht_19),
    tva_19: round3(tva_19),
  }
}

export function buildPosDocumentPreview(
  input: {
    typeDocument: string
    items: CartItem[]
    vente: Vente
    defaultTva: number
    client: {
      nom: string
      tel?: string | null
      adresse?: string | null
      matricule?: string | null
    }
    numero?: string
    timbre?: number
    created_at?: string
  },
): { lignes: InvoiceLineData[]; doc: InvoiceDocData; remisePanier: number } {
  const lignes = cartItemsToInvoiceLines(input.items, input.typeDocument, input.defaultTva)
  const sums = sumInvoiceLines(lignes)
  const remisePanier = remisePanierFromVente(input.vente, input.items)
  const tax = taxBucketsFromLines(lignes)
  const isFacture = input.typeDocument === 'FACTURE_VENTE' || input.typeDocument === 'FACTURE_JOURNALIERE_F'

  const baseDoc: InvoiceDocData = {
    numero: input.numero || '—',
    type_document: input.typeDocument,
    client_nom: input.client.nom || 'Client Passager',
    client_tel: input.client.tel ?? null,
    client_adresse: input.client.adresse ?? null,
    client_matricule: input.client.matricule ?? null,
    total_ht: sums.total_ht,
    total_tva: sums.total_tva,
    total_ttc: sums.total_ttc,
    statut_paiement: 'PAYE',
    created_at: input.created_at || input.vente.created_at || new Date().toISOString(),
    timbre: isFacture ? (input.timbre ?? 1) : 0,
    total_remise: remisePanier,
  }

  const doc = applyTotalsToDoc(baseDoc, lignes, { total_remise: remisePanier, timbre: baseDoc.timbre })
  return {
    lignes,
    doc: { ...doc, ...tax } as InvoiceDocData,
    remisePanier,
  }
}

export { documentAllowsNF }

import type { TypeDocument } from './types'

/** Only BL vente may include NF lines; facture and devis require F. */
export function documentAllowsNF(typeDocument: string): boolean {
  return typeDocument === 'BON_LIVRAISON'
}

export function filterLignesForDocument<T extends { type_produit?: string }>(
  typeDocument: string,
  lignes: T[],
): T[] {
  if (documentAllowsNF(typeDocument)) return lignes
  return lignes.filter(l => (l.type_produit as string | undefined) !== 'NF')
}

export function canCreateDocumentFromLignes(
  typeDocument: string,
  lignes: { type_produit?: string }[],
): boolean {
  const eligible = filterLignesForDocument(typeDocument, lignes)
  return eligible.length > 0
}

export function documentCreateBlockedMessage(typeDocument: string): string {
  if (documentAllowsNF(typeDocument)) return 'Aucune ligne — ajoutez au moins un produit'
  return 'Aucun produit facturé (F) — conversion impossible'
}

export type PosDocType = 'FACTURE_VENTE' | 'BON_LIVRAISON' | 'DEVIS'

export function posDocTypeFromVente(typeVente: 'FACTURE' | 'BL_VENTE' | 'DEVIS'): TypeDocument {
  return typeVente === 'FACTURE' ? 'FACTURE_VENTE' : typeVente === 'DEVIS' ? 'DEVIS' : 'BON_LIVRAISON'
}

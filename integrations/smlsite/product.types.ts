/**
 * Supabase `produits` row shape synced from SMLPOS.
 * Copy into SMLSITE repo — do not import from SMLPOS app.
 *
 * prix_vente = TTC (customer price in Tunisian dinars, 3 decimals typical)
 * actif = 1 → visible/sellable in POS; website should mirror with actif = 1 AND type = 'F'
 */

export interface PosProduitRow {
  id: string
  reference: string
  code_barre: string | null
  nom: string
  description: string | null
  categorie: string
  categorie_id: string | null
  type: 'F' | 'NF' | string
  prix_achat: number | null
  prix_vente: number
  prix_vente_ht: number | null
  tva_taux: number
  stock_actuel: number
  stock_minimum: number
  actif: number
  has_serial_number: number
  created_at: string
  updated_at: string
}

export interface PosCategoryRow {
  id: string
  nom: string
  icone: string | null
}

/** Fields SMLSITE should copy from POS into Turso on each sync */
export type PosCatalogSyncPayload = Pick<
  PosProduitRow,
  | 'id'
  | 'reference'
  | 'code_barre'
  | 'nom'
  | 'categorie'
  | 'prix_vente'
  | 'stock_actuel'
  | 'description'
  | 'updated_at'
>

export const POS_CATALOG_SELECT =
  'id, reference, code_barre, nom, categorie, prix_vente, stock_actuel, description, type, actif, updated_at' as const


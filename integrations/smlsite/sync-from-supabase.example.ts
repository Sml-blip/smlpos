/**
 * Reference: pull catalog from Supabase into your shop DB.
 * Copy into SMLSITE — not executed by SMLPOS.
 *
 * npm install @supabase/supabase-js
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (server only)
 */

import { createClient } from '@supabase/supabase-js'
import type { PosProduitRow } from './product.types'

const PAGE = 500

function getClient() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, { auth: { persistSession: false } })
}

/** Incremental fetch — pass ISO timestamp from last successful sync */
export async function fetchPosCatalogDelta(lastSyncAt: string): Promise<PosProduitRow[]> {
  const supabase = getClient()
  const all: PosProduitRow[] = []
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from('produits')
      .select('id, reference, code_barre, nom, categorie, prix_vente, prix_vente_ht, tva_taux, stock_actuel, description, type, actif, updated_at')
      .eq('actif', 1)
      .eq('type', 'F')
      .gt('updated_at', lastSyncAt)
      .order('updated_at', { ascending: true })
      .range(from, from + PAGE - 1)

    if (error) throw new Error(error.message)
    if (!data?.length) break
    all.push(...(data as PosProduitRow[]))
    if (data.length < PAGE) break
    from += PAGE
  }

  return all
}

/** Map POS row → your Turso product upsert (implement in SMLSITE) */
export function mapPosToShopRow(p: PosProduitRow) {
  return {
    pos_id: p.id,
    reference: p.reference,
    barcode: p.code_barre,
    name: p.nom,
    category_pos: p.categorie,
    price_ttc: p.prix_vente,
    stock: p.stock_actuel,
    description_pos: p.description,
    pos_updated_at: p.updated_at,
    // slug, image_url, seo_title — SMLSITE enrich layer only
  }
}

// Example Inngest / cron handler:
// export async function syncPosCatalogJob() {
//   const lastSync = await turso.getMeta('pos_last_sync_at') ?? '1970-01-01T00:00:00.000Z'
//   const rows = await fetchPosCatalogDelta(lastSync)
//   for (const row of rows) await turso.upsertProduct(mapPosToShopRow(row))
//   if (rows.length) {
//     const maxUpdated = rows[rows.length - 1].updated_at
//     await turso.setMeta('pos_last_sync_at', maxUpdated)
//   }
// }


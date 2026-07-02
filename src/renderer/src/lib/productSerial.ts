import type { CartItem, Produit } from './types'

type SerialRow = { numero_serie: string; statut: string }

export function productTracksSerial(product: Produit): boolean {
  return product.has_serial_number === 1 || !!product.numero_serie
}

export function serialsInCart(cartItems: CartItem[], produitId: string): Set<string> {
  const used = new Set<string>()
  for (const item of cartItems) {
    if (item.produit_id !== produitId || !item.numero_serie) continue
    for (const sn of item.numero_serie.split(',')) {
      const t = sn.trim()
      if (t) used.add(t)
    }
  }
  return used
}

export async function loadAvailableSerials(product: Produit, cartItems: CartItem[]): Promise<string[]> {
  const used = serialsInCart(cartItems, product.id)
  const rows = (await window.api.serialNumbersGetByProduit(product.id)) as SerialRow[]
  const fromTable = rows
    .filter(r => r.statut === 'EN_STOCK')
    .map(r => r.numero_serie.trim())
    .filter(sn => sn && !used.has(sn))

  if (fromTable.length) return fromTable

  const fallback = product.numero_serie?.trim()
  if (fallback && !used.has(fallback)) return [fallback]

  return []
}

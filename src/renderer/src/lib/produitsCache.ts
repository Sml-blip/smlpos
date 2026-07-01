import type { Produit } from './types'

let _cache: { data: Produit[]; ts: number } = { data: [], ts: 0 }

export const PRODUITS_CACHE_TTL_MS = 60_000

export function getProduitsCache(): { data: Produit[]; ts: number } {
  return _cache
}

export function setProduitsCache(data: Produit[]): void {
  _cache = { data, ts: Date.now() }
}

/** Call on factory reset so the inventaire tab cannot show pre-wipe products. */
export function invalidateProduitsCache(): void {
  _cache = { data: [], ts: 0 }
}

export function isProduitsCacheFresh(now = Date.now()): boolean {
  return _cache.data.length > 0 && (now - _cache.ts) < PRODUITS_CACHE_TTL_MS
}

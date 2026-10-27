/** Reproducible high-level operations; execution must use real clients and API. */
export function generateWorkload(seed, count = 200) {
  if (!Number.isSafeInteger(seed) || seed < 1 || seed > 0xffffffff) throw new Error('seed must be an integer from 1 to 4294967295')
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('count must be a positive integer')
  let state = seed >>> 0
  const next = () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5
    return state >>> 0
  }
  const kinds = ['sale', 'return', 'price', 'stock', 'delete']
  return Array.from({ length: count }, (_, index) => ({
    index, device: index % 2 ? 'B' : 'A', kind: kinds[next() % kinds.length],
    product: next() % 4, value: 1 + next() % 9000,
    offline: next() % 5 === 0, restart: next() % 29 === 0,
    duplicate: next() % 7 === 0, reorder: next() % 3 === 0,
  }))
}

/** RFC 9562 UUIDv7 for newly created business records. Historical TEXT IDs stay untouched. */
export function uuidv7(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let time = BigInt(Date.now())
  for (let index = 5; index >= 0; index--) { bytes[index] = Number(time & 255n); time >>= 8n }
  bytes[6] = (bytes[6] & 15) | 112
  bytes[8] = (bytes[8] & 63) | 128
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`
}

/** Generate a valid EAN-13 code in the GS1 restricted-distribution 20 range. */
export function ean13CheckDigit(twelveDigits: string): string {
  if (!/^\d{12}$/.test(twelveDigits)) throw new Error('EAN-13 requires 12 data digits')
  const sum = twelveDigits.split('').reduce((total, digit, index) =>
    total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0)
  return String((10 - (sum % 10)) % 10)
}

export function generateInternalEan13(now = new Date()): string {
  const yy = String(now.getFullYear()).slice(-2)
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const random = String(Math.floor(Math.random() * 10_000)).padStart(4, '0')
  const data = `20${yy}${mm}${dd}${random}`
  return data + ean13CheckDigit(data)
}

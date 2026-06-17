const UNITS = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf']
const TEN_NINETEEN = ['dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf']
const TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante']

function below100(n: number): string {
  if (n === 0) return ''
  if (n < 10) return UNITS[n]
  if (n < 20) return TEN_NINETEEN[n - 10]
  if (n < 70) {
    const t = Math.floor(n / 10), u = n % 10
    if (u === 0) return TENS[t]
    if (u === 1) return TENS[t] + '-et-un'
    return TENS[t] + '-' + UNITS[u]
  }
  if (n < 80) {
    const u = n - 70
    if (u === 0) return 'soixante-dix'
    if (u === 1) return 'soixante-et-onze'
    return 'soixante-' + TEN_NINETEEN[u]
  }
  const u = n - 80
  if (u === 0) return 'quatre-vingts'
  if (u < 10) return 'quatre-vingt-' + UNITS[u]
  return 'quatre-vingt-' + TEN_NINETEEN[u - 10]
}

function below1000(n: number): string {
  if (n === 0) return ''
  const h = Math.floor(n / 100)
  const rest = n % 100
  if (h === 0) return below100(rest)
  const restStr = rest > 0 ? below100(rest) : ''
  const centStr = h === 1 ? 'cent' : UNITS[h] + ' cent' + (rest === 0 ? 's' : '')
  return rest === 0 ? centStr : centStr + ' ' + restStr
}

function intToWordsFr(n: number): string {
  if (n === 0) return 'zéro'
  const parts: string[] = []
  if (n >= 1_000_000) {
    const m = Math.floor(n / 1_000_000)
    parts.push(m === 1 ? 'un million' : below1000(m) + ' millions')
    n %= 1_000_000
  }
  if (n >= 1000) {
    const k = Math.floor(n / 1000)
    parts.push((k === 1 ? '' : below1000(k) + ' ') + 'mille')
    n %= 1000
  }
  if (n > 0) parts.push(below1000(n))
  return parts.join(' ').trim()
}

/** Convert a DT amount (3 decimal = millimes) to French words.
 *  e.g. 100.000 → "Cent Dinars zéro Millime" */
export function amountToWordsDT(amount: number): string {
  const total = Math.round(amount * 1000)
  const dinars = Math.floor(total / 1000)
  const millimes = total % 1000
  const dStr = intToWordsFr(dinars)
  const mStr = intToWordsFr(millimes)
  const dWord = dinars <= 1 ? 'Dinar' : 'Dinars'
  const mWord = millimes <= 1 ? 'Millime' : 'Millimes'
  return cap(dStr) + ' ' + dWord + ' ' + mStr + ' ' + mWord
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
}

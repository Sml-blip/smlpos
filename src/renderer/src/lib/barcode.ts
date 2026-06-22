/**
 * Code128 barcode SVG — optimized for 40mm retail labels.
 * Auto-switches B/C subsets; fixed module width + quiet zones for scanner reliability.
 */

const PATTERNS: string[] = [
  '11011001100','11001101100','11001100110','10010011000','10010001100',
  '10001001100','10011001000','10011000100','10001100100','11001001000',
  '11001000100','11000100100','10110011100','10011011100','10011001110',
  '10111001100','10011101100','10011100110','11001110010','11001011100',
  '11001001110','11011100100','11001110100','11101101110','11101001100',
  '11100101100','11100100110','11101100100','11100110100','11100110010',
  '11011011000','11011000110','11000110110','10100011000','10001011000',
  '10001000110','10110001000','10001101000','10001100010','11010001000',
  '11000101000','11000100010','10110111000','10110001110','10001101110',
  '10111011000','10111000110','10001110110','11101110110','11010001110',
  '11000101110','11011101000','11011100010','11011101110','11101011000',
  '11101000110','11100010110','11101101000','11101100010','11100011010',
  '11101111010','11001000010','11110001010','10100110000','10100001100',
  '10010110000','10010000110','10000101100','10000100110','10110010000',
  '10110000100','10011010000','10011000010','10000110100','10000110010',
  '11000010010','11001010000','11110111010','11000010100','10001111010',
  '10100111100','10010111100','10010011110','10111100100','10011110100',
  '10011110010','11110100100','11110010100','11110010010','11011011110',
  '11011110110','11110110110','10101111000','10100011110','10001011110',
  '10111101000','10111100010','11110101000','11110100010','10111011110',
  '10111101110','11101011110','11110101110',
  '11010000100', // 103 Start A
  '11010010000', // 104 Start B
  '11010011100', // 105 Start C
  '1100011101011', // 106 Stop
]

const START_A = 103
const START_B = 104
const START_C = 105
const STOP = 106
const CODE_A = 101
const CODE_B = 100
const CODE_C = 99

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9'
}

function charValueB(ch: string): number {
  const v = ch.charCodeAt(0) - 32
  if (v < 0 || v > 95) throw new Error(`Invalid Code128B char: ${ch}`)
  return v
}

/** Encode with automatic B/C subset switching (much denser for numeric runs). */
function encode128Auto(raw: string): string {
  const text = raw.trim().toUpperCase()
  if (!text) throw new Error('Empty barcode')

  const values: number[] = []
  let mode: 'A' | 'B' | 'C' = 'B'
  let i = 0

  const digitsAhead = (from: number) => {
    let n = 0
    while (from + n < text.length && isDigit(text[from + n])) n++
    return n
  }

  const allDigits = [...text].every(isDigit)
  if (allDigits && text.length >= 2) {
    if (text.length % 2 === 0) {
      mode = 'C'
      values.push(START_C)
    } else {
      values.push(START_B)
      values.push(charValueB(text[0]))
      i = 1
      if (i < text.length) {
        values.push(CODE_C)
        mode = 'C'
      }
    }
  } else {
    values.push(START_B)
  }

  while (i < text.length) {
    if (mode === 'C') {
      if (!isDigit(text[i])) {
        values.push(CODE_B)
        mode = 'B'
        continue
      }
      const pair = text.slice(i, i + 2)
      if (pair.length < 2) {
        values.push(CODE_B)
        mode = 'B'
        continue
      }
      values.push(parseInt(pair, 10))
      i += 2
      continue
    }

    // mode B
    const dCount = digitsAhead(i)
    if (dCount >= 4) {
      if (dCount % 2 === 1) {
        values.push(charValueB(text[i]))
        i += 1
      }
      values.push(CODE_C)
      mode = 'C'
      continue
    }
    values.push(charValueB(text[i]))
    i += 1
  }

  let checksum = values[0]
  for (let j = 1; j < values.length; j++) {
    checksum += j * values[j]
  }
  values.push(checksum % 103)
  values.push(STOP)

  return values.map(v => PATTERNS[v]).join('')
}

export interface BarcodeOptions {
  /** Bar height in px (legacy) */
  height?: number
  /** Bar height in mm (preferred for labels) */
  barHeightMm?: number
  /** Module width in mm — 0.33–0.40 recommended for handheld scanners */
  moduleWidthMm?: number
  /** Quiet zone in modules (GS1 min 10) */
  quietZoneModules?: number
  showText?: boolean
  fontSize?: number
  bgColor?: string
  barColor?: string
  /** Legacy total width — ignored when moduleWidthMm is set */
  width?: number
}

/** Normalize product barcode for encoding (trim, uppercase ASCII). */
export function normalizeBarcodeText(text: string): string {
  return text.trim().toUpperCase().replace(/[^\x20-\x7E]/g, '')
}

/** Generate Code128 SVG with scanner-friendly quiet zones and crisp modules. */
export function code128Svg(text: string, opts: BarcodeOptions = {}): string {
  const {
    height = 50,
    barHeightMm = 7,
    moduleWidthMm = 0.38,
    quietZoneModules = 10,
    showText = false,
    fontSize = 8,
    bgColor = '#ffffff',
    barColor = '#000000',
  } = opts

  const normalized = normalizeBarcodeText(text)
  let bits: string
  try {
    bits = encode128Auto(normalized || '?')
  } catch {
    bits = encode128Auto('0')
  }

  const dataModules = bits.length
  const totalModules = dataModules + quietZoneModules * 2
  const barH = barHeightMm > 0 ? barHeightMm : height / 3.78
  const moduleMm = moduleWidthMm > 0 ? moduleWidthMm : 0.38
  const totalWidthMm = totalModules * moduleMm
  const textAreaMm = showText ? 3 : 0
  const totalHeightMm = barH + textAreaMm

  const rects: string[] = []
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] !== '1') continue
    let j = i
    while (j < bits.length && bits[j] === '1') j++
    const x = (quietZoneModules + i) * moduleMm
    const w = (j - i) * moduleMm
    rects.push(
      `<rect x="${x.toFixed(4)}" y="0" width="${w.toFixed(4)}" height="${barH.toFixed(3)}" fill="${barColor}" shape-rendering="crispEdges"/>`,
    )
    i = j - 1
  }

  const safeText = normalized.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const textEl = showText
    ? `<text x="${(totalWidthMm / 2).toFixed(3)}" y="${(barH + textAreaMm - 0.5).toFixed(3)}" text-anchor="middle" font-family="monospace" font-size="${fontSize}px" fill="${barColor}">${safeText}</text>`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidthMm.toFixed(3)}mm" height="${totalHeightMm.toFixed(3)}mm" viewBox="0 0 ${totalWidthMm.toFixed(3)} ${totalHeightMm.toFixed(3)}">
  <rect width="100%" height="100%" fill="${bgColor}"/>
  ${rects.join('\n  ')}
  ${textEl}
</svg>`
}

/** Pick module width so barcode fits max width while staying scannable (min 0.28mm/module). */
export function moduleWidthForLabel(text: string, maxWidthMm: number): number {
  const normalized = normalizeBarcodeText(text)
  let bits: string
  try {
    bits = encode128Auto(normalized || '0')
  } catch {
    bits = encode128Auto('0')
  }
  const totalModules = bits.length + 20 // 10 quiet zone each side
  const ideal = 0.38
  const min = 0.28
  const fitted = maxWidthMm / totalModules
  return Math.max(min, Math.min(ideal, fitted))
}

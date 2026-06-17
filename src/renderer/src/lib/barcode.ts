/**
 * Code128B barcode SVG generator — pure TS, no dependencies.
 * Supports ASCII 32–127 (spaces, digits, uppercase/lowercase, punctuation).
 */

// 11-bit patterns for symbols 0–105, plus stop (13-bit) at index 106
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
  '11010010000', // 104 Start B  ← we use this
  '11010011100', // 105 Start C
  '1100011101011', // 106 Stop (13 modules)
]

const START_B = 104
const STOP    = 106

/** Encode a string as a Code128B binary bit-string (1=bar, 0=space) */
function encode128B(text: string): string {
  const values: number[] = []

  // Start B
  values.push(START_B)

  // Data
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i) - 32
    if (code < 0 || code > 95) throw new Error(`Character '${text[i]}' not in Code128B range`)
    values.push(code)
  }

  // Check digit
  let check = START_B
  for (let i = 0; i < text.length; i++) {
    check += (i + 1) * (text.charCodeAt(i) - 32)
  }
  values.push(check % 103)

  // Stop
  values.push(STOP)

  return values.map(v => PATTERNS[v]).join('')
}

export interface BarcodeOptions {
  width?: number   // total SVG width in px (default 280)
  height?: number  // bar height in px (default 60)
  fontSize?: number
  showText?: boolean
  bgColor?: string
  barColor?: string
}

/** Generate a Code128B SVG string for the given text */
export function code128Svg(text: string, opts: BarcodeOptions = {}): string {
  const {
    width = 280,
    height = 60,
    fontSize = 11,
    showText = true,
    bgColor = '#ffffff',
    barColor = '#000000',
  } = opts

  let bits: string
  try {
    bits = encode128B(text)
  } catch {
    // Fallback: encode only printable ASCII
    const safe = text.replace(/[^\x20-\x7E]/g, '')
    bits = encode128B(safe || '?')
  }

  const textAreaH = showText ? fontSize + 4 : 0
  const totalH    = height + textAreaH
  const moduleW   = width / bits.length

  const rects: string[] = []
  let i = 0
  while (i < bits.length) {
    if (bits[i] === '1') {
      let j = i
      while (j < bits.length && bits[j] === '1') j++
      const x = (i * moduleW).toFixed(2)
      const w = ((j - i) * moduleW).toFixed(2)
      rects.push(`<rect x="${x}" y="0" width="${w}" height="${height}" fill="${barColor}"/>`)
      i = j
    } else {
      i++
    }
  }

  const textEl = showText
    ? `<text x="${width / 2}" y="${height + textAreaH - 1}" text-anchor="middle" font-family="monospace" font-size="${fontSize}" fill="${barColor}">${text}</text>`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalH}" viewBox="0 0 ${width} ${totalH}">
  <rect width="${width}" height="${totalH}" fill="${bgColor}"/>
  ${rects.join('\n  ')}
  ${textEl}
</svg>`
}

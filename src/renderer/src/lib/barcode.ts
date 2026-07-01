/**
 * Barcode SVG generation — JsBarcode (EAN-8/13 + Code128) for scannable retail labels.
 */

import JsBarcode from 'jsbarcode'

export function normalizeBarcodeText(raw: string): string {
  return String(raw ?? '').trim()
}

function eanCheckDigit(digits: string): string {
  const nums = digits.split('').map(Number)
  let sum = 0
  for (let i = 0; i < nums.length; i++) {
    sum += nums[i] * (i % 2 === 0 ? 1 : 3)
  }
  const mod = sum % 10
  return mod === 0 ? '0' : String(10 - mod)
}

function resolveBarcodeFormat(text: string): { value: string; format: string } {
  const trimmed = text.trim()
  const digitsOnly = trimmed.replace(/\D/g, '')

  if (/^\d+$/.test(trimmed)) {
    if (trimmed.length === 13) return { value: trimmed, format: 'EAN13' }
    if (trimmed.length === 12) return { value: trimmed + eanCheckDigit(trimmed), format: 'EAN13' }
    if (trimmed.length === 8) return { value: trimmed, format: 'EAN8' }
    if (trimmed.length === 7) return { value: trimmed + eanCheckDigit(trimmed), format: 'EAN8' }
    if (digitsOnly.length >= 8 && digitsOnly.length <= 14) {
      if (digitsOnly.length === 13) return { value: digitsOnly, format: 'EAN13' }
      if (digitsOnly.length === 12) return { value: digitsOnly + eanCheckDigit(digitsOnly), format: 'EAN13' }
      if (digitsOnly.length === 8) return { value: digitsOnly, format: 'EAN8' }
      if (digitsOnly.length === 7) return { value: digitsOnly + eanCheckDigit(digitsOnly), format: 'EAN8' }
    }
  }

  return { value: trimmed.toUpperCase(), format: 'CODE128' }
}

export function moduleWidthForLabel(text: string, maxBarWidthMm: number): number {
  const { value, format } = resolveBarcodeFormat(text)
  const estModules = format.startsWith('EAN') ? 95 : Math.max(60, value.length * 11)
  const ideal = 0.38
  const min = 0.33
  const computed = maxBarWidthMm / estModules
  return Math.max(min, Math.min(ideal, computed))
}

export function code128Svg(
  text: string,
  opts: {
    moduleWidthMm?: number
    barHeightMm?: number
    quietZoneModules?: number
    showText?: boolean
    bgColor?: string
    barColor?: string
  } = {},
): string {
  const raw = normalizeBarcodeText(text)
  if (!raw) return ''

  const { value, format } = resolveBarcodeFormat(raw)
  const moduleMm = opts.moduleWidthMm ?? 0.38
  const barHeightMm = opts.barHeightMm ?? 9
  const quiet = opts.quietZoneModules ?? 10
  const bg = opts.bgColor ?? '#ffffff'
  const fg = opts.barColor ?? '#000000'

  if (typeof document === 'undefined') {
    return `<svg xmlns="http://www.w3.org/2000/svg"></svg>`
  }

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  try {
    JsBarcode(svg, value, {
      format,
      width: moduleMm * 3.7795275591,
      height: barHeightMm * 3.7795275591,
      displayValue: opts.showText ?? false,
      margin: quiet,
      background: bg,
      lineColor: fg,
      fontSize: 10,
    })
  } catch {
    JsBarcode(svg, value, {
      format: 'CODE128',
      width: moduleMm * 3.7795275591,
      height: barHeightMm * 3.7795275591,
      displayValue: false,
      margin: quiet,
      background: bg,
      lineColor: fg,
    })
  }

  return svg.outerHTML
}

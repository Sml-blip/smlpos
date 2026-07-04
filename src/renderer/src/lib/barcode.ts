/**
 * Barcode SVG — JsBarcode vector output for 40×20mm scannable labels.
 */

import JsBarcode from 'jsbarcode'

const MM_TO_PX = 3.7795275591

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

export function resolveBarcodeFormat(text: string): { value: string; format: string } {
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

export function pickBarcodeValue(code: string, productRef = ''): string {
  const candidates = [normalizeBarcodeText(code), normalizeBarcodeText(productRef)].filter(Boolean)
  for (const c of candidates) {
    const { format } = resolveBarcodeFormat(c)
    if (format.startsWith('EAN')) return c
  }
  return candidates.sort((a, b) => a.length - b.length)[0] ?? normalizeBarcodeText(code)
}

export function estimateModuleCount(text: string): number {
  const { value, format } = resolveBarcodeFormat(text)
  if (format === 'EAN13') return 95
  if (format === 'EAN8') return 67
  return 35 + value.length * 11
}

export function moduleWidthMmForLabel(text: string, maxBarWidthMm: number, moduleMax = 0.38): number {
  const modules = estimateModuleCount(text) + 12
  const fit = (maxBarWidthMm - 1) / modules
  return Math.max(0.2, Math.min(moduleMax, fit))
}

function applyCrispEdges(svg: SVGSVGElement): void {
  svg.setAttribute('shape-rendering', 'crispEdges')
  svg.querySelectorAll('rect').forEach(el => el.setAttribute('shape-rendering', 'crispEdges'))
}

export interface LabelBarcodeSvgOptions {
  maxWidthMm?: number
  barHeightMm?: number
  showText?: boolean
  align?: 'left' | 'right'
  moduleWidthMaxMm?: number
}

function renderBarcodeSvg(
  value: string,
  format: string,
  modulePx: number,
  barHeightPx: number,
  showText: boolean,
): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const jsOpts = {
    format,
    width: modulePx,
    height: barHeightPx,
    displayValue: showText,
    fontSize: 7,
    fontOptions: 'bold' as const,
    textMargin: 1,
    margin: 2,
    background: '#ffffff',
    lineColor: '#000000',
  }
  try {
    JsBarcode(svg, value, jsOpts)
  } catch {
    JsBarcode(svg, value, { ...jsOpts, format: 'CODE128' })
  }
  return svg
}

/** Label barcode SVG — fits inside maxWidthMm, centered via CSS in template. */
export function labelBarcodeSvg(
  text: string,
  opts: LabelBarcodeSvgOptions = {},
): string {
  const raw = normalizeBarcodeText(text)
  if (!raw) return ''

  if (typeof document === 'undefined') {
    return '<svg xmlns="http://www.w3.org/2000/svg" class="label-barcode"></svg>'
  }

  const maxWidthMm = opts.maxWidthMm ?? 34
  const barHeightMm = opts.barHeightMm ?? 6.5
  const moduleMax = opts.moduleWidthMaxMm ?? 0.38
  const maxWidthPx = maxWidthMm * MM_TO_PX
  const barHeightPx = barHeightMm * MM_TO_PX
  const { value, format } = resolveBarcodeFormat(raw)

  let moduleMm = moduleWidthMmForLabel(raw, maxWidthMm, moduleMax)
  let svg = renderBarcodeSvg(value, format, moduleMm * MM_TO_PX, barHeightPx, opts.showText ?? true)

  let svgW = parseFloat(svg.getAttribute('width') ?? '0')
  if (svgW > maxWidthPx && svgW > 0) {
    moduleMm = moduleMm * (maxWidthPx / svgW) * 0.95
    svg = renderBarcodeSvg(value, format, moduleMm * MM_TO_PX, barHeightPx, opts.showText ?? true)
    svgW = parseFloat(svg.getAttribute('width') ?? '0')
  }

  const svgHmm = parseFloat(svg.getAttribute('height') ?? '0') / MM_TO_PX
  const viewBox = svg.getAttribute('viewBox')
  if (viewBox) {
    svg.setAttribute('width', '100%')
    svg.setAttribute('height', `${Math.min(barHeightMm + (opts.showText ? 3.5 : 0), svgHmm).toFixed(2)}mm`)
  } else {
    const svgWmm = Math.min(maxWidthMm, svgW / MM_TO_PX)
    svg.setAttribute('width', `${svgWmm.toFixed(2)}mm`)
    svg.setAttribute('height', `${svgHmm.toFixed(2)}mm`)
  }
  svg.setAttribute('class', 'label-barcode')
  const align = opts.align === 'right' ? 'xMaxYMid' : 'xMinYMid'
  svg.setAttribute('preserveAspectRatio', `${align} meet`)
  applyCrispEdges(svg)
  return svg.outerHTML
}

/** @deprecated */
export function barWidthPxForLabel(text: string, maxBarWidthMm: number): number {
  return moduleWidthMmForLabel(text, maxBarWidthMm) * MM_TO_PX
}

/** @deprecated */
export function moduleWidthForLabel(text: string, maxBarWidthMm: number): number {
  return moduleWidthMmForLabel(text, maxBarWidthMm)
}

/** @deprecated */
export function code128Svg(
  text: string,
  opts: { barHeightMm?: number; showText?: boolean } = {},
): string {
  return labelBarcodeSvg(text, {
    maxWidthMm: 34,
    barHeightMm: opts.barHeightMm ?? 6.5,
    showText: opts.showText ?? true,
  })
}

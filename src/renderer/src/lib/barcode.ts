/**
 * Barcode SVG — JsBarcode vector output for 40×20mm scannable labels.
 */

import JsBarcode from 'jsbarcode'

const MM_TO_PX = 3.7795275591

type BarcodeFormatMode = 'auto' | 'EAN13' | 'EAN8' | 'CODE128'
export type LabelBarcodeFormat = 'EAN13' | 'EAN8' | 'CODE128'

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

export function resolveBarcodeFormat(text: string, mode: BarcodeFormatMode = 'auto'): { value: string; format: string } {
  const trimmed = text.trim()
  const digitsOnly = trimmed.replace(/\D/g, '')

  if (mode === 'CODE128') {
    return { value: trimmed.toUpperCase(), format: 'CODE128' }
  }
  if (mode === 'EAN13') {
    if (/^\d{13}$/.test(trimmed)) return { value: trimmed, format: 'EAN13' }
    if (/^\d{12}$/.test(trimmed)) return { value: trimmed + eanCheckDigit(trimmed), format: 'EAN13' }
    if (digitsOnly.length === 13) return { value: digitsOnly, format: 'EAN13' }
    if (digitsOnly.length === 12) return { value: digitsOnly + eanCheckDigit(digitsOnly), format: 'EAN13' }
    return { value: digitsOnly.slice(0, 13) || trimmed, format: 'EAN13' }
  }
  if (mode === 'EAN8') {
    if (/^\d{8}$/.test(trimmed)) return { value: trimmed, format: 'EAN8' }
    if (/^\d{7}$/.test(trimmed)) return { value: trimmed + eanCheckDigit(trimmed), format: 'EAN8' }
    if (digitsOnly.length === 8) return { value: digitsOnly, format: 'EAN8' }
    if (digitsOnly.length === 7) return { value: digitsOnly + eanCheckDigit(digitsOnly), format: 'EAN8' }
    return { value: digitsOnly.slice(0, 8) || trimmed, format: 'EAN8' }
  }

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

/** Label printing uses CODE128 — full product code, no truncation. */
export function pickLabelBarcodeValue(code: string, productRef = ''): string {
  return pickLabelBarcodePayload(code, productRef).value
}

export function pickLabelBarcodePayload(code: string, productRef = ''): { value: string; format: LabelBarcodeFormat } {
  const candidates = [normalizeBarcodeText(code), normalizeBarcodeText(productRef)].filter(Boolean)
  const picked = candidates[0] ?? normalizeBarcodeText(code)
  if (!picked) return { value: '0', format: 'CODE128' }
  const trimmed = picked.trim()
  const digitsOnly = trimmed.replace(/\D/g, '')

  // Prefer real EAN formats for numeric retail barcodes: they scan much better
  // than dense CODE128 on 39x20mm labels.
  if (/^\d{13}$/.test(trimmed)) return { value: trimmed, format: 'EAN13' }
  if (/^\d{8}$/.test(trimmed)) return { value: trimmed, format: 'EAN8' }
  if (digitsOnly.length === 13) return { value: digitsOnly, format: 'EAN13' }
  if (digitsOnly.length === 8) return { value: digitsOnly, format: 'EAN8' }

  return { value: resolveBarcodeFormat(picked, 'CODE128').value, format: 'CODE128' }
}

/** @deprecated Use pickLabelBarcodeValue for labels. */
export function pickEan8Value(code: string, productRef = ''): string {
  const candidates = [normalizeBarcodeText(code), normalizeBarcodeText(productRef)].filter(Boolean)
  for (const c of candidates) {
    const { value, format } = resolveBarcodeFormat(c, 'EAN8')
    if (format === 'EAN8' && /^\d{8}$/.test(value)) return value
  }
  const fallback = candidates[0] ?? normalizeBarcodeText(code) ?? '0000000'
  return resolveBarcodeFormat(fallback, 'EAN8').value
}

export function estimateCode128Modules(text: string): number {
  const { value } = resolveBarcodeFormat(text, 'CODE128')
  return 35 + value.length * 11
}

export function estimateModuleCount(text: string): number {
  const { value, format } = resolveBarcodeFormat(text)
  if (format === 'EAN13') return 95
  if (format === 'EAN8') return 67
  return estimateCode128Modules(value)
}

/** Bar area height inside a layout box (caption uses remaining ~25%). */
export function labelBarcodeBarHeightMm(boxHeightMm: number, showCaption: boolean): number {
  if (!showCaption) return boxHeightMm
  return Math.max(3, boxHeightMm * 0.75)
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
  formatMode?: BarcodeFormatMode
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

/** Label barcode SVG — bars only; caption rendered separately in HTML/editor. */
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
  const { value, format } = resolveBarcodeFormat(raw, opts.formatMode ?? 'CODE128')

  let moduleMm = moduleWidthMmForLabel(value, maxWidthMm, moduleMax)
  let svg = renderBarcodeSvg(value, format, moduleMm * MM_TO_PX, barHeightPx, false)

  let svgW = parseFloat(svg.getAttribute('width') ?? '0')
  if (svgW > maxWidthPx && svgW > 0) {
    moduleMm = moduleMm * (maxWidthPx / svgW) * 0.95
    svg = renderBarcodeSvg(value, format, moduleMm * MM_TO_PX, barHeightPx, false)
    svgW = parseFloat(svg.getAttribute('width') ?? '0')
  } else if (svgW > 0 && svgW < maxWidthPx * 0.92) {
    moduleMm = moduleMm * ((maxWidthPx * 0.98) / svgW)
    svg = renderBarcodeSvg(value, format, moduleMm * MM_TO_PX, barHeightPx, false)
    svgW = parseFloat(svg.getAttribute('width') ?? '0')
  }

  svg.setAttribute('width', '100%')
  svg.setAttribute('height', '100%')
  svg.setAttribute('class', 'label-barcode')
  svg.setAttribute('preserveAspectRatio', 'none')
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

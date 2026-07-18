import JsBarcode from 'jsbarcode'
import { pickLabelBarcodePayload } from './barcode'
import { clampLayout, defaultVisualLayout, fontPtForBox } from './labelLayout'
import { mergeLabelConfig } from './labelSettings'
import { effectiveLabelMargins, type LabelPrintConfig } from './printManager'

export interface RenderedBarcodeLabel {
  dataUrl: string
  bitmapBase64: string
  widthDots: number
  heightDots: number
  widthBytes: number
  barcodeValue: string
  barcodeFormat: 'EAN13' | 'EAN8' | 'CODE128'
  moduleDots: number
}

export interface BarcodeLabelRasterSource {
  code: string
  nom: string
  prix: number
  productRef?: string
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

const mmToDots = (mm: number, dpi: number): number => Math.round((mm * dpi) / 25.4)

function setFittedFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  weight: number,
  preferredPx: number,
  maxWidth: number,
  minPx = 6,
): number {
  let px = Math.max(minPx, Math.round(preferredPx))
  while (px > minPx) {
    ctx.font = `${weight} ${px}px Arial, Helvetica, sans-serif`
    if (ctx.measureText(text).width <= maxWidth) return px
    px -= 1
  }
  ctx.font = `${weight} ${px}px Arial, Helvetica, sans-serif`
  return px
}

function textThatFits(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let value = text
  while (value.length > 1 && ctx.measureText(`${value}...`).width > maxWidth) {
    value = value.slice(0, -1)
  }
  return `${value}...`
}

function drawTextBox(
  ctx: CanvasRenderingContext2D,
  text: string,
  box: { x: number; y: number; w: number; h: number },
  dpi: number,
  weight: number,
  maxPt: number,
  align: CanvasTextAlign = 'left',
): void {
  if (!text || box.w <= 2 || box.h <= 2) return
  ctx.save()
  ctx.beginPath()
  ctx.rect(box.x, box.y, box.w, box.h)
  ctx.clip()
  ctx.fillStyle = '#000000'
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  setFittedFont(ctx, text, weight, (fontPtForBox((box.h * 25.4) / dpi, maxPt) * dpi) / 72, box.w - 3)
  const x = align === 'center' ? box.x + box.w / 2 : align === 'right' ? box.x + box.w - 1.5 : box.x + 1.5
  ctx.fillText(textThatFits(ctx, text, box.w - 3), x, box.y + box.h / 2)
  ctx.restore()
}

function makeBarcodeCanvas(
  value: string,
  format: 'EAN13' | 'EAN8' | 'CODE128',
  moduleDots: number,
  heightDots: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  JsBarcode(canvas, value, {
    format,
    width: moduleDots,
    height: Math.max(1, heightDots),
    displayValue: false,
    margin: 0,
    background: '#ffffff',
    lineColor: '#000000',
  })
  return canvas
}

function pickBarcodeCanvas(
  value: string,
  format: 'EAN13' | 'EAN8' | 'CODE128',
  maxWidthDots: number,
  heightDots: number,
): { canvas: HTMLCanvasElement; moduleDots: number } {
  const candidates = format === 'CODE128' ? [2, 1] : [3, 2, 1]
  for (const moduleDots of candidates) {
    const canvas = makeBarcodeCanvas(value, format, moduleDots, heightDots)
    const quietZoneDots = Math.max(8, moduleDots * 10)
    if (canvas.width + quietZoneDots * 2 <= maxWidthDots) {
      return { canvas, moduleDots }
    }
  }
  throw new Error(`Code-barres trop long pour cette etiquette: ${value.length} caracteres.`)
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function packMonochromeBitmap(canvas: HTMLCanvasElement): { bitmapBase64: string; widthBytes: number } {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Impossible de preparer le bitmap de l\'etiquette.')
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const { data } = imageData
  const widthBytes = Math.ceil(canvas.width / 8)
  const packed = new Uint8Array(widthBytes * canvas.height)
  packed.fill(0xff)

  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const pixel = (y * canvas.width + x) * 4
      const luminance = data[pixel] * 0.299 + data[pixel + 1] * 0.587 + data[pixel + 2] * 0.114
      const isBlack = data[pixel + 3] > 0 && luminance < 160
      const channel = isBlack ? 0 : 255
      data[pixel] = channel
      data[pixel + 1] = channel
      data[pixel + 2] = channel
      data[pixel + 3] = 255
      if (isBlack) {
        packed[y * widthBytes + (x >> 3)] &= ~(0x80 >> (x & 7))
      }
    }
  }

  ctx.putImageData(imageData, 0, 0)
  return { bitmapBase64: bytesToBase64(packed), widthBytes }
}

export function renderBarcodeLabelRaster(
  source: BarcodeLabelRasterSource,
  configPartial?: Partial<LabelPrintConfig>,
): RenderedBarcodeLabel {
  const cfg = mergeLabelConfig(configPartial)
  const dpi = clamp(Math.round(cfg.dpi), 72, 600)
  const widthDots = mmToDots(cfg.widthMm, dpi)
  const heightDots = mmToDots(cfg.heightMm, dpi)
  const canvas = document.createElement('canvas')
  canvas.width = widthDots
  canvas.height = heightDots
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Impossible de creer l\'apercu de l\'etiquette.')

  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, widthDots, heightDots)

  const margins = effectiveLabelMargins(cfg)
  const compactLabel = cfg.widthMm <= 45 && cfg.heightMm <= 25
  const layout = compactLabel
    ? defaultVisualLayout(margins.contentW, margins.contentH)
    : clampLayout(cfg.layout, margins.contentW, margins.contentH)
  const originX = mmToDots(margins.stripLeftMm + cfg.offsetXmm, dpi)
  const originY = mmToDots(margins.stripTopMm + cfg.offsetYmm, dpi)
  const toDotBox = (box: { x: number; y: number; w: number; h: number }) => ({
    x: originX + mmToDots(box.x, dpi),
    y: originY + mmToDots(box.y, dpi),
    w: mmToDots(box.w, dpi),
    h: mmToDots(box.h, dpi),
  })

  const parsedPrice = Number(source.prix)
  const priceText = `${(Number.isFinite(parsedPrice) ? parsedPrice : 0).toFixed(3)} DT`
  const nameText = (source.nom || source.productRef || 'Produit').trim()
  if (layout.price.visible) drawTextBox(ctx, priceText, toDotBox(layout.price), dpi, 900, 11)
  if (layout.name.visible) drawTextBox(ctx, nameText, toDotBox(layout.name), dpi, 800, 8.5)

  const barcode = pickLabelBarcodePayload(source.code, source.productRef ?? '')
  let moduleDots = 0
  if (layout.barcode.visible) {
    const box = toDotBox(layout.barcode)
    const showBarcodeCaption = layout.showBarcodeText && !compactLabel
    const captionHeight = showBarcodeCaption ? Math.max(12, Math.floor(box.h * 0.22)) : 0
    const barHeight = Math.max(24, box.h - captionHeight)
    const rendered = pickBarcodeCanvas(barcode.value, barcode.format, box.w, barHeight)
    moduleDots = rendered.moduleDots
    const barcodeX = box.x + Math.floor((box.w - rendered.canvas.width) / 2)
    ctx.drawImage(rendered.canvas, barcodeX, box.y)

    if (showBarcodeCaption) {
      drawTextBox(
        ctx,
        barcode.displayValue,
        { x: box.x, y: box.y + barHeight, w: box.w, h: captionHeight },
        dpi,
        700,
        7,
        'center',
      )
    }
  }

  let output = canvas
  if (cfg.rotationDeg === 180) {
    output = document.createElement('canvas')
    output.width = widthDots
    output.height = heightDots
    const rotated = output.getContext('2d')
    if (!rotated) throw new Error('Impossible de tourner l\'etiquette.')
    rotated.imageSmoothingEnabled = false
    rotated.fillStyle = '#ffffff'
    rotated.fillRect(0, 0, widthDots, heightDots)
    rotated.translate(widthDots, heightDots)
    rotated.rotate(Math.PI)
    rotated.drawImage(canvas, 0, 0)
  }

  const packed = packMonochromeBitmap(output)
  return {
    dataUrl: output.toDataURL('image/png'),
    bitmapBase64: packed.bitmapBase64,
    widthDots,
    heightDots,
    widthBytes: packed.widthBytes,
    barcodeValue: barcode.value,
    barcodeFormat: barcode.format,
    moduleDots,
  }
}

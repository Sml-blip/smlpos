import { labelBarcodeSvg, pickBarcodeValue } from './barcode'
import type { LabelPrintConfig } from './printManager'
import { DEFAULT_LABEL_CONFIG } from './printManager'

export interface BarcodeLabelOptions {
  code: string
  nom: string
  prix: number
  productRef?: string
  config?: Partial<LabelPrintConfig>
}

export function parseLabelPrice(prix: number | string | undefined | null): number {
  if (typeof prix === 'number' && Number.isFinite(prix)) return prix
  return parseFloat(String(prix ?? '').replace(',', '.')) || 0
}

function mergeConfig(partial?: Partial<LabelPrintConfig>): LabelPrintConfig {
  const cfg = { ...DEFAULT_LABEL_CONFIG, ...partial }
  cfg.rotationDeg = partial?.rotationDeg === 0 ? 0 : 180
  return cfg
}

function escapeHtml(s: string): string {
  return s.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 40×20mm label — name top, barcode centered, price bottom (nothing cropped). */
export function buildBarcodeLabelHtml(
  code: string,
  nom: string,
  prix: number,
  productRef = '',
  configPartial?: Partial<LabelPrintConfig>,
  copies = 1,
): string {
  const cfg = mergeConfig(configPartial)
  const barcodeValue = pickBarcodeValue(code, productRef)
  const displayName = (nom || productRef || 'Produit').trim()
  const safeName = escapeHtml(displayName)
  const safeRef = escapeHtml(productRef || code)
  const priceNum = parseLabelPrice(prix)
  const priceStr = `${priceNum.toFixed(3)} DT`

  const contentW = Math.max(1, cfg.widthMm - cfg.stripLeftMm - cfg.stripRightMm)
  const maxBarWidthMm = Math.max(28, contentW - 2.5)

  const svg = labelBarcodeSvg(barcodeValue, {
    maxWidthMm: maxBarWidthMm,
    barHeightMm: 6,
    showText: true,
  })

  const labelRotate = cfg.rotationDeg === 180
    ? 'transform: rotate(180deg); transform-origin: center center;'
    : ''

  const labelInner = `
        <div class="label" style="${labelRotate}">
          <div class="label-name" title="${safeName}">${safeName}</div>
          <div class="barcode-wrap">${svg}</div>
          <div class="label-price">${priceStr}</div>
        </div>`

  const count = Math.min(99, Math.max(1, copies))
  const sheets = Array.from({ length: count }, (_, i) =>
    `<div class="sheet${i < count - 1 ? ' page-break' : ''}">${labelInner}</div>`,
  ).join('')

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Étiquette ${safeRef}</title><style>
    @page { size: ${cfg.widthMm}mm ${cfg.heightMm}mm; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: ${cfg.widthMm}mm;
      font-family: Arial, Helvetica, sans-serif;
      background: #fff;
      color: #000;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet {
      width: ${cfg.widthMm}mm;
      height: ${cfg.heightMm}mm;
      padding: 0.4mm ${cfg.stripRightMm}mm 0.4mm ${cfg.stripLeftMm}mm;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .sheet.page-break { page-break-after: always; break-after: page; }
    .label {
      width: ${contentW}mm;
      height: ${cfg.heightMm - 0.8}mm;
      display: grid;
      grid-template-rows: auto 1fr auto;
      align-items: center;
      justify-items: center;
      gap: 0.2mm;
      text-align: center;
    }
    .label-name {
      width: 100%;
      font-size: 5.5pt;
      font-weight: 700;
      line-height: 1.1;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      word-break: break-word;
      padding: 0 0.5mm;
    }
    .barcode-wrap {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      padding: 0 1mm;
    }
    .label-barcode,
    .barcode-wrap svg {
      display: block;
      margin-left: auto;
      margin-right: auto;
      max-width: ${maxBarWidthMm}mm;
      width: auto;
      height: auto;
      max-height: 10.5mm;
    }
    .label-barcode rect,
    .barcode-wrap svg rect {
      shape-rendering: crispEdges;
    }
    .label-price {
      width: 100%;
      font-size: 7.5pt;
      font-weight: 900;
      line-height: 1.1;
      white-space: nowrap;
      padding: 0 0.5mm;
    }
  </style></head><body>${sheets}</body></html>`
}

export function buildSampleLabelHtml(config?: Partial<LabelPrintConfig>): string {
  return buildBarcodeLabelHtml('1234567890123', 'Produit test scanner', 12.5, 'REF-TEST', config)
}

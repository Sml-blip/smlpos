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

/** Scannable 40×20mm label — price always visible, barcode never CSS-stretched. */
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
  const maxBarWidthMm = Math.min(36, contentW - 1)

  const svg = labelBarcodeSvg(barcodeValue, {
    maxWidthMm: maxBarWidthMm,
    barHeightMm: 7,
    showText: true,
  })

  const sheetRotate = cfg.rotationDeg === 180
    ? 'transform: rotate(180deg); transform-origin: center center;'
    : ''

  const labelInner = `
        <div class="label">
          <div class="header">
            <div class="name" title="${safeName}">${safeName}</div>
            <div class="price">${priceStr}</div>
          </div>
          <div class="barcode-wrap">${svg}</div>
        </div>`

  const count = Math.min(99, Math.max(1, copies))
  const sheets = Array.from({ length: count }, (_, i) =>
    `<div class="sheet${i < count - 1 ? ' page-break' : ''}" style="${sheetRotate}">${labelInner}</div>`,
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
      padding: 0.3mm ${cfg.stripRightMm}mm 0.3mm ${cfg.stripLeftMm}mm;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: visible;
    }
    .sheet.page-break { page-break-after: always; break-after: page; }
    .label {
      width: ${contentW}mm;
      height: ${cfg.heightMm - 0.6}mm;
      display: flex;
      flex-direction: column;
      gap: 0.3mm;
    }
    .header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1mm;
      flex-shrink: 0;
      min-height: 3.5mm;
      max-height: 5mm;
    }
    .name {
      flex: 1;
      min-width: 0;
      font-size: 5.5pt;
      font-weight: 700;
      line-height: 1.15;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      word-break: break-word;
    }
    .price {
      flex-shrink: 0;
      font-size: 8pt;
      font-weight: 900;
      white-space: nowrap;
      line-height: 1.1;
      padding-left: 0.5mm;
    }
    .barcode-wrap {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 0;
      overflow: visible;
    }
    .label-barcode,
    .barcode-wrap svg {
      display: block;
      max-width: ${maxBarWidthMm}mm;
      width: auto !important;
      height: auto !important;
    }
    .label-barcode rect,
    .barcode-wrap svg rect {
      shape-rendering: crispEdges;
    }
  </style></head><body>${sheets}</body></html>`
}

/** Sample label for Settings → Test étiquette */
export function buildSampleLabelHtml(config?: Partial<LabelPrintConfig>): string {
  return buildBarcodeLabelHtml('1234567890123', 'Produit test scanner', 12.5, 'REF-TEST', config)
}

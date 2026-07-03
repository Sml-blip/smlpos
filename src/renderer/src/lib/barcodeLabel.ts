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
  return {
    ...DEFAULT_LABEL_CONFIG,
    ...partial,
    rotationDeg: partial?.rotationDeg === 180 ? 180 : 0,
  }
}

function escapeHtml(s: string): string {
  return s.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 40×20mm label — left-anchored; 180° rotation mirrors alignment so print stays left. */
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
  const maxBarWidthMm = Math.max(24, contentW - 3.5)
  const flip = cfg.rotationDeg === 180
  /** After 180° rotation, HTML-right becomes physical-left — mirror so print reads left. */
  const anchor = flip ? 'right' : 'left'
  const flexMain = flip ? 'flex-end' : 'flex-start'
  const gridAlign = flip ? 'end' : 'start'

  const svg = labelBarcodeSvg(barcodeValue, {
    maxWidthMm: maxBarWidthMm,
    barHeightMm: 5.8,
    showText: true,
    align: anchor,
  })

  const labelRotate = flip
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
      height: ${cfg.heightMm}mm;
      font-family: Arial, Helvetica, sans-serif;
      background: #fff;
      color: #000;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet {
      width: ${cfg.widthMm}mm;
      height: ${cfg.heightMm}mm;
      padding: 0.35mm ${cfg.stripRightMm}mm 0.35mm ${cfg.stripLeftMm}mm;
      display: flex;
      align-items: stretch;
      justify-content: ${flexMain};
      overflow: hidden;
    }
    .sheet.page-break { page-break-after: always; break-after: page; }
    .label {
      width: ${contentW}mm;
      max-width: 100%;
      height: ${cfg.heightMm - 0.7}mm;
      display: grid;
      grid-template-rows: auto 1fr auto;
      align-items: center;
      justify-items: ${gridAlign};
      gap: 0.15mm;
      text-align: ${anchor};
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
      padding: 0 0.25mm 0 0;
    }
    .barcode-wrap {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: ${flexMain};
      overflow: hidden;
      padding: 0;
    }
    .label-barcode,
    .barcode-wrap svg {
      display: block;
      max-width: ${maxBarWidthMm}mm;
      width: auto;
      height: auto;
      max-height: 10mm;
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
      padding: 0 0.25mm 0 0;
    }
  </style></head><body>${sheets}</body></html>`
}

export function buildSampleLabelHtml(config?: Partial<LabelPrintConfig>): string {
  return buildBarcodeLabelHtml('1234567890123', 'Produit test scanner', 12.5, 'REF-TEST', config)
}

import { labelBarcodeSvg, pickBarcodeValue } from './barcode'
import type { LabelPrintConfig, LabelTextAlign } from './printManager'
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
    nameMaxLines: partial?.nameMaxLines === 1 ? 1 : partial?.nameMaxLines === 3 ? 3 : (partial?.nameMaxLines ?? DEFAULT_LABEL_CONFIG.nameMaxLines),
    textAlign: partial?.textAlign ?? DEFAULT_LABEL_CONFIG.textAlign,
  }
}

function escapeHtml(s: string): string {
  return s.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function resolveAlign(cfg: LabelPrintConfig): LabelTextAlign {
  if (cfg.textAlign !== 'auto') return cfg.textAlign
  return cfg.rotationDeg === 180 ? 'right' : 'left'
}

function cssAlign(align: LabelTextAlign): { anchor: string; flexMain: string; gridAlign: string; svgAlign: 'left' | 'right' } {
  if (align === 'center') {
    return { anchor: 'center', flexMain: 'center', gridAlign: 'center', svgAlign: 'left' }
  }
  if (align === 'right') {
    return { anchor: 'right', flexMain: 'flex-end', gridAlign: 'end', svgAlign: 'right' }
  }
  return { anchor: 'left', flexMain: 'flex-start', gridAlign: 'start', svgAlign: 'left' }
}

/** 40×20mm label — configurable layout from LabelPrintConfig. */
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
  const contentH = Math.max(1, cfg.heightMm - cfg.stripTopMm - cfg.stripBottomMm)
  const maxBarWidthMm = Math.max(16, contentW - cfg.barMarginMm)
  const align = resolveAlign(cfg)
  const { anchor, flexMain, gridAlign, svgAlign } = cssAlign(align)
  const flip = cfg.rotationDeg === 180

  const svg = labelBarcodeSvg(barcodeValue, {
    maxWidthMm: maxBarWidthMm,
    barHeightMm: cfg.barHeightMm,
    showText: cfg.showBarcodeText,
    align: svgAlign,
    moduleWidthMaxMm: cfg.moduleWidthMaxMm,
  })

  const labelRotate = flip
    ? 'transform: rotate(180deg); transform-origin: center center;'
    : ''

  const nameBlock = cfg.showName
    ? `<div class="label-name" title="${safeName}">${safeName}</div>`
    : ''
  const priceBlock = cfg.showPrice
    ? `<div class="label-price">${priceStr}</div>`
    : ''
  const barcodeBlock = svg ? `<div class="barcode-wrap">${svg}</div>` : ''

  const labelInner = `
        <div class="label" style="${labelRotate}">
          ${nameBlock}
          ${barcodeBlock}
          ${priceBlock}
        </div>`

  const count = Math.min(99, Math.max(1, copies))
  const sheets = Array.from({ length: count }, (_, i) =>
    `<div class="sheet${i < count - 1 ? ' page-break' : ''}">${labelInner}</div>`,
  ).join('')

  const gridRows = cfg.showName && cfg.showPrice
    ? 'auto 1fr auto'
    : cfg.showName && !cfg.showPrice
      ? 'auto 1fr'
      : !cfg.showName && cfg.showPrice
        ? '1fr auto'
        : '1fr'

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
      padding: ${cfg.stripTopMm}mm ${cfg.stripRightMm}mm ${cfg.stripBottomMm}mm ${cfg.stripLeftMm}mm;
      display: flex;
      align-items: stretch;
      justify-content: ${flexMain};
      overflow: hidden;
    }
    .sheet.page-break { page-break-after: always; break-after: page; }
    .label {
      width: ${contentW}mm;
      max-width: 100%;
      height: ${contentH}mm;
      display: grid;
      grid-template-rows: ${gridRows};
      align-items: center;
      justify-items: ${gridAlign};
      gap: 0.15mm;
      text-align: ${anchor};
    }
    .label-name {
      width: 100%;
      font-size: ${cfg.nameFontPt}pt;
      font-weight: 700;
      line-height: 1.1;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: ${cfg.nameMaxLines};
      -webkit-box-orient: vertical;
      word-break: break-word;
    }
    .barcode-wrap {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: ${flexMain};
      overflow: hidden;
    }
    .label-barcode,
    .barcode-wrap svg {
      display: block;
      max-width: ${maxBarWidthMm}mm;
      width: auto;
      height: auto;
      max-height: ${cfg.barHeightMm + (cfg.showBarcodeText ? 4 : 0)}mm;
    }
    .label-barcode rect,
    .barcode-wrap svg rect {
      shape-rendering: crispEdges;
    }
    .label-price {
      width: 100%;
      font-size: ${cfg.priceFontPt}pt;
      font-weight: 900;
      line-height: 1.1;
      white-space: nowrap;
    }
  </style></head><body>${sheets}</body></html>`
}

export function buildSampleLabelHtml(config?: Partial<LabelPrintConfig>): string {
  return buildBarcodeLabelHtml('1234567890123', 'Produit test scanner', 12.5, 'REF-TEST', config)
}

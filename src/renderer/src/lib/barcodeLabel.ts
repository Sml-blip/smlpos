import { labelBarcodeSvg, pickBarcodeValue } from './barcode'
import type { LabelPrintConfig, LabelTextAlign } from './printManager'
import { DEFAULT_LABEL_CONFIG, effectiveLabelMargins } from './printManager'

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
    contentVAlign: partial?.contentVAlign ?? DEFAULT_LABEL_CONFIG.contentVAlign,
    contentScalePct: partial?.contentScalePct ?? DEFAULT_LABEL_CONFIG.contentScalePct,
  }
}

function escapeHtml(s: string): string {
  return s.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function resolveAlign(cfg: LabelPrintConfig): LabelTextAlign {
  if (cfg.textAlign !== 'auto') return cfg.textAlign
  return cfg.rotationDeg === 180 ? 'right' : 'left'
}

function cssAlign(align: LabelTextAlign): { anchor: string; flexMain: string; crossAlign: string; svgAlign: 'left' | 'right' } {
  if (align === 'center') {
    return { anchor: 'center', flexMain: 'center', crossAlign: 'center', svgAlign: 'left' }
  }
  if (align === 'right') {
    return { anchor: 'right', flexMain: 'flex-end', crossAlign: 'flex-end', svgAlign: 'right' }
  }
  return { anchor: 'left', flexMain: 'flex-start', crossAlign: 'flex-start', svgAlign: 'left' }
}

function vAlignCss(v: LabelPrintConfig['contentVAlign']): string {
  if (v === 'center') return 'center'
  if (v === 'bottom') return 'flex-end'
  if (v === 'space-between') return 'space-between'
  return 'flex-start'
}

/** Label HTML — tight flex layout, content forced inside printable area. */
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

  const margins = effectiveLabelMargins(cfg)
  const contentW = margins.contentW
  const contentH = margins.contentH
  const padTop = margins.stripTopMm
  const padRight = margins.stripRightMm
  const padBottom = margins.stripBottomMm
  const padLeft = margins.stripLeftMm
  const maxBarWidthMm = Math.max(10, contentW - cfg.barMarginMm)
  const barBlockMaxHmm = cfg.barHeightMm + (cfg.showBarcodeText ? 3.5 : 0)
  const align = resolveAlign(cfg)
  const { anchor, flexMain, crossAlign, svgAlign } = cssAlign(align)
  const flip = cfg.rotationDeg === 180
  const scale = Math.min(2, Math.max(0.7, cfg.contentScalePct / 100))
  const scaleOrigin = anchor === 'center' ? 'top center' : anchor === 'right' ? 'top right' : 'top left'
  const scaleWidthPct = (100 / scale).toFixed(2)

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

  const nameMb = cfg.showName && svg ? cfg.gapNameBarcodeMm : 0
  const barMb = svg && cfg.showPrice ? cfg.gapBarcodePriceMm : 0

  const nameBlock = cfg.showName
    ? `<div class="label-name" title="${safeName}">${safeName}</div>`
    : ''
  const priceBlock = cfg.showPrice
    ? `<div class="label-price">${priceStr}</div>`
    : ''
  const barcodeBlock = svg ? `<div class="barcode-wrap">${svg}</div>` : ''

  const labelInner = `
        <div class="label" style="${labelRotate}">
          <div class="label-scale">
            ${nameBlock}
            ${barcodeBlock}
            ${priceBlock}
          </div>
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
      max-width: ${cfg.widthMm}mm;
      max-height: ${cfg.heightMm}mm;
      overflow: hidden;
      font-family: Arial, Helvetica, sans-serif;
      background: #fff;
      color: #000;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet {
      width: ${cfg.widthMm}mm;
      height: ${cfg.heightMm}mm;
      max-width: ${cfg.widthMm}mm;
      max-height: ${cfg.heightMm}mm;
      padding: ${padTop}mm ${padRight}mm ${padBottom}mm ${padLeft}mm;
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
      max-height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: ${vAlignCss(cfg.contentVAlign)};
      align-items: ${crossAlign};
      overflow: hidden;
      text-align: ${anchor};
    }
    .label-scale {
      width: ${scaleWidthPct}%;
      max-width: 100%;
      display: flex;
      flex-direction: column;
      align-items: ${crossAlign};
      text-align: ${anchor};
      transform: scale(${scale.toFixed(3)});
      transform-origin: ${scaleOrigin};
      overflow: hidden;
    }
    .label-name {
      flex: 0 0 auto;
      width: 100%;
      max-width: 100%;
      font-size: ${cfg.nameFontPt}pt;
      font-weight: 700;
      line-height: 1.05;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: ${cfg.nameMaxLines};
      -webkit-box-orient: vertical;
      word-break: break-word;
      margin-bottom: ${nameMb}mm;
    }
    .barcode-wrap {
      flex: 0 1 auto;
      width: 100%;
      max-width: 100%;
      min-height: 0;
      max-height: ${barBlockMaxHmm}mm;
      display: flex;
      align-items: center;
      justify-content: ${flexMain};
      overflow: hidden;
      margin-bottom: ${barMb}mm;
    }
    .label-barcode,
    .barcode-wrap svg {
      display: block;
      max-width: 100%;
      width: 100%;
      height: auto;
      max-height: ${barBlockMaxHmm}mm;
    }
    .label-barcode rect,
    .barcode-wrap svg rect {
      shape-rendering: crispEdges;
    }
    .label-price {
      flex: 0 0 auto;
      width: 100%;
      max-width: 100%;
      font-size: ${cfg.priceFontPt}pt;
      font-weight: 900;
      line-height: 1.05;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  </style></head><body>${sheets}</body></html>`
}

export function buildSampleLabelHtml(config?: Partial<LabelPrintConfig>): string {
  return buildBarcodeLabelHtml('1234567890123', 'Produit test scanner', 12.5, 'REF-TEST', config)
}

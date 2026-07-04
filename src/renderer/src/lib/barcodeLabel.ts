import { labelBarcodeSvg, pickBarcodeValue } from './barcode'
import type { LabelPrintConfig } from './printManager'
import { effectiveLabelMargins } from './printManager'
import { clampLayout, fontPtForBox, mergeVisualLayout } from './labelLayout'
import type { LabelVisualLayout } from './labelLayout'
import { mergeLabelConfig } from './labelSettings'

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
  return mergeLabelConfig(partial)
}

function escapeHtml(s: string): string {
  return s.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function elementStyle(box: { x: number; y: number; w: number; h: number }): string {
  return `left:${box.x}mm;top:${box.y}mm;width:${box.w}mm;height:${box.h}mm;`
}

/** Label HTML — absolute layout from visual editor positions. */
export function buildBarcodeLabelHtml(
  code: string,
  nom: string,
  prix: number,
  productRef = '',
  configPartial?: Partial<LabelPrintConfig>,
  copies = 1,
): string {
  const cfg = mergeConfig(configPartial)
  const margins = effectiveLabelMargins(cfg)
  const contentW = margins.contentW
  const contentH = margins.contentH
  const layout = clampLayout(cfg.layout, contentW, contentH)

  const barcodeValue = pickBarcodeValue(code, productRef)
  const displayName = (nom || productRef || 'Produit').trim()
  const safeName = escapeHtml(displayName)
  const safeRef = escapeHtml(productRef || code)
  const priceNum = parseLabelPrice(prix)
  const priceStr = `${priceNum.toFixed(3)} DT`
  const flip = cfg.rotationDeg === 180

  const svg = layout.barcode.visible
    ? labelBarcodeSvg(barcodeValue, {
        maxWidthMm: layout.barcode.w,
        barHeightMm: Math.max(3, layout.barcode.h - (layout.showBarcodeText ? 3 : 0)),
        showText: layout.showBarcodeText,
        formatMode: layout.barcodeFormat,
      })
    : ''

  const namePt = fontPtForBox(layout.name.h, 8)
  const pricePt = fontPtForBox(layout.price.h, 10)

  const nameBlock = layout.name.visible
    ? `<div class="el el-name" style="${elementStyle(layout.name)}"><span>${safeName}</span></div>`
    : ''
  const barcodeBlock = layout.barcode.visible && svg
    ? `<div class="el el-barcode" style="${elementStyle(layout.barcode)}">${svg}</div>`
    : ''
  const priceBlock = layout.price.visible
    ? `<div class="el el-price" style="${elementStyle(layout.price)}"><span>${priceStr}</span></div>`
    : ''

  const labelRotate = flip ? 'transform:rotate(180deg);transform-origin:center center;' : ''

  const labelInner = `
        <div class="label" style="${labelRotate}">
          <div class="label-area">
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
      padding: ${margins.stripTopMm}mm ${margins.stripRightMm}mm ${margins.stripBottomMm}mm ${margins.stripLeftMm}mm;
      overflow: hidden;
    }
    .sheet.page-break { page-break-after: always; break-after: page; }
    .label {
      width: ${contentW}mm;
      height: ${contentH}mm;
      overflow: hidden;
    }
    .label-area {
      position: relative;
      width: ${contentW}mm;
      height: ${contentH}mm;
      overflow: hidden;
    }
    .el {
      position: absolute;
      overflow: hidden;
    }
    .el-name {
      display: flex;
      align-items: center;
      font-size: ${namePt}pt;
      font-weight: 700;
      line-height: 1.05;
      word-break: break-word;
    }
    .el-name span {
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
      width: 100%;
    }
    .el-barcode {
      display: flex;
      align-items: center;
      justify-content: flex-start;
    }
    .el-barcode svg {
      display: block;
      width: 100%;
      height: 100%;
      max-width: 100%;
      max-height: 100%;
    }
    .el-barcode svg rect { shape-rendering: crispEdges; }
    .el-price {
      display: flex;
      align-items: center;
      font-size: ${pricePt}pt;
      font-weight: 900;
      line-height: 1.05;
      white-space: nowrap;
    }
    .el-price span {
      overflow: hidden;
      text-overflow: ellipsis;
      width: 100%;
    }
  </style></head><body>${sheets}</body></html>`
}

export function buildSampleLabelHtml(config?: Partial<LabelPrintConfig>): string {
  return buildBarcodeLabelHtml('1234567890123', 'Produit test scanner', 12.5, 'REF-TEST', config)
}

export function patchLabelLayout(
  cfg: LabelPrintConfig,
  layoutPatch: Partial<LabelVisualLayout>,
): LabelPrintConfig {
  const margins = effectiveLabelMargins(cfg)
  return {
    ...cfg,
    layout: clampLayout(mergeVisualLayout(cfg.layout, layoutPatch), margins.contentW, margins.contentH),
  }
}

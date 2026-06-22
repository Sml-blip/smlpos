import { code128Svg, moduleWidthForLabel, normalizeBarcodeText } from './barcode'
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

/** Scannable label HTML with configurable size, strips, and rotation (Gainscha-style). */
export function buildBarcodeLabelHtml(
  code: string,
  nom: string,
  prix: number,
  productRef = '',
  configPartial?: Partial<LabelPrintConfig>,
): string {
  const cfg = mergeConfig(configPartial)
  const barcodeText = normalizeBarcodeText(code)
  const displayName = (nom || productRef || 'Produit').trim().slice(0, 28)
  const safeName = displayName.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const safeRef = (productRef || code).replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const safeCode = barcodeText.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const priceNum = parseLabelPrice(prix)
  const priceStr = `${priceNum.toFixed(3)} DT`

  const contentW = Math.max(1, cfg.widthMm - cfg.stripLeftMm - cfg.stripRightMm)
  const maxBarWidthMm = Math.min(36, contentW - 2)
  const moduleMm = moduleWidthForLabel(barcodeText, maxBarWidthMm)

  const svg = code128Svg(barcodeText, {
    moduleWidthMm: moduleMm,
    barHeightMm: Math.min(7.5, cfg.heightMm * 0.38),
    quietZoneModules: 10,
    showText: false,
    bgColor: '#ffffff',
    barColor: '#000000',
  })

  const rotateStyle = cfg.rotationDeg === 180
    ? 'transform: rotate(180deg); transform-origin: center center;'
    : ''

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
      overflow: hidden;
    }
    .sheet {
      width: 100%;
      height: 100%;
      padding: 0 ${cfg.stripRightMm}mm 0 ${cfg.stripLeftMm}mm;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .label {
      width: ${contentW}mm;
      height: 100%;
      display: flex;
      flex-direction: column;
      padding: 0.4mm 0.5mm 0.3mm;
      gap: 0.2mm;
      ${rotateStyle}
    }
    .header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 1mm;
      flex-shrink: 0;
    }
    .name {
      flex: 1;
      min-width: 0;
      font-size: 5.5pt;
      font-weight: 700;
      line-height: 1.1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .price {
      flex-shrink: 0;
      font-size: 8pt;
      font-weight: 900;
      white-space: nowrap;
    }
    .barcode-wrap {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 0;
      padding: 0 0.5mm;
    }
    .barcode-wrap svg {
      display: block;
      max-width: ${maxBarWidthMm}mm;
      height: auto;
      max-height: ${Math.min(8, cfg.heightMm * 0.42)}mm;
      width: auto;
    }
    .code-line {
      flex-shrink: 0;
      font-size: 5pt;
      font-family: monospace;
      text-align: center;
      letter-spacing: 0.02em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  </style></head><body>
    <div class="sheet">
      <div class="label">
        <div class="header">
          <div class="name" title="${safeName}">${safeName}</div>
          <div class="price">${priceStr}</div>
        </div>
        <div class="barcode-wrap">${svg}</div>
        <div class="code-line">${safeCode}</div>
      </div>
    </div>
  </body></html>`
}

/** Sample label for Settings → Test étiquette */
export function buildSampleLabelHtml(config?: Partial<LabelPrintConfig>): string {
  return buildBarcodeLabelHtml('1234567890123', 'Produit test', 12.5, 'REF-TEST', config)
}

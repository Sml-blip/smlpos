import { code128Svg, moduleWidthForLabel, normalizeBarcodeText } from './barcode'

export interface BarcodeLabelOptions {
  code: string
  nom: string
  prix: number
  ref?: string
}

export function parseLabelPrice(prix: number | string | undefined | null): number {
  if (typeof prix === 'number' && Number.isFinite(prix)) return prix
  return parseFloat(String(prix ?? '').replace(',', '.')) || 0
}

/** 4cm × 2cm label: name + price, scannable Code128, ref under barcode */
export function buildBarcodeLabelHtml(code: string, nom: string, prix: number, ref = ''): string {
  const barcodeText = normalizeBarcodeText(code)
  const displayName = (nom || ref || 'Produit').trim().slice(0, 28)
  const safeName = displayName.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const safeRef = (ref || code).replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const safeCode = barcodeText.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const priceNum = parseLabelPrice(prix)
  const priceStr = `${priceNum.toFixed(3)} DT`

  const maxBarWidthMm = 36
  const moduleMm = moduleWidthForLabel(barcodeText, maxBarWidthMm)

  const svg = code128Svg(barcodeText, {
    moduleWidthMm: moduleMm,
    barHeightMm: 7.5,
    quietZoneModules: 10,
    showText: false,
    bgColor: '#ffffff',
    barColor: '#000000',
  })

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Étiquette ${safeRef}</title><style>
    @page { size: 40mm 20mm; margin: 0.5mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 40mm;
      height: 20mm;
      font-family: Arial, Helvetica, sans-serif;
      background: #fff;
      color: #000;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .label {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      padding: 0.4mm 1.5mm 0.3mm;
      gap: 0.2mm;
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
      height: 8mm;
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
    <div class="label">
      <div class="header">
        <div class="name" title="${safeName}">${safeName}</div>
        <div class="price">${priceStr}</div>
      </div>
      <div class="barcode-wrap">${svg}</div>
      <div class="code-line">${safeCode}</div>
    </div>
  </body></html>`
}

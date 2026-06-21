import { code128Svg } from './barcode'

export interface BarcodeLabelOptions {
  code: string
  nom: string
  prix: number
  ref?: string
}

/** 4cm × 2cm label: product name + barcode + price (TND) */
export function buildBarcodeLabelHtml(code: string, nom: string, prix: number, ref = ''): string {
  const displayName = (nom || ref || 'Produit').trim().slice(0, 40)
  const safeName = displayName.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const safeRef = (ref || code).replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const priceStr = `${(Number.isFinite(prix) ? prix : 0).toFixed(3)} DT`

  const svg = code128Svg(code, {
    width: 118,
    height: 32,
    showText: true,
    bgColor: '#ffffff',
    barColor: '#000000',
  })

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Étiquette ${safeRef}</title><style>
    @page { size: 40mm 20mm; margin: 0.8mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 40mm; height: 20mm;
      overflow: hidden;
      font-family: Arial, Helvetica, sans-serif;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .label {
      width: 100%; height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      padding: 0.6mm 1mm 0.8mm;
      text-align: center;
    }
    .name {
      width: 100%;
      font-size: 7.5pt;
      font-weight: 700;
      line-height: 1.15;
      max-height: 9.5pt;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #000;
    }
    .barcode-wrap {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      min-height: 0;
    }
    .barcode-wrap svg {
      display: block;
      max-width: 36mm;
      max-height: 11mm;
      height: auto;
    }
    .footer {
      width: 100%;
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 1mm;
    }
    .price {
      font-size: 10pt;
      font-weight: 800;
      color: #000;
      letter-spacing: -0.02em;
      white-space: nowrap;
    }
    .ref {
      font-size: 5.5pt;
      color: #333;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 18mm;
      text-align: right;
    }
  </style></head><body>
    <div class="label">
      <div class="name" title="${safeName}">${safeName}</div>
      <div class="barcode-wrap">${svg}</div>
      <div class="footer">
        <span class="price">${priceStr}</span>
        <span class="ref">${safeRef}</span>
      </div>
    </div>
  </body></html>`
}

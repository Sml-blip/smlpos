import { code128Svg } from './barcode'

export interface BarcodeLabelOptions {
  code: string
  nom: string
  prix: number
  ref?: string
}

/** 4cm × 2cm label: product name + barcode + price (TND) */
export function buildBarcodeLabelHtml(code: string, nom: string, prix: number, ref = ''): string {
  const displayName = (nom || ref || 'Produit').trim().slice(0, 36)
  const safeName = displayName.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const safeRef = (ref || code).replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const priceNum = Number.isFinite(prix) ? prix : parseFloat(String(prix)) || 0
  const priceStr = `${priceNum.toFixed(3)} DT`

  const svg = code128Svg(code, {
    width: 118,
    height: 30,
    showText: true,
    bgColor: '#ffffff',
    barColor: '#000000',
  })

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Étiquette ${safeRef}</title><style>
    @page { size: 40mm 20mm; margin: 0.6mm; }
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
      display: grid;
      grid-template-rows: auto 1fr auto auto;
      align-items: center;
      padding: 0.5mm 1mm 0.6mm;
      text-align: center;
    }
    .name {
      width: 100%;
      font-size: 6.5pt;
      font-weight: 700;
      line-height: 1.1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #000;
    }
    .barcode-wrap {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      min-height: 0;
    }
    .barcode-wrap svg {
      display: block;
      max-width: 36mm;
      max-height: 10mm;
      height: auto;
    }
    .price {
      font-size: 11pt;
      font-weight: 900;
      color: #000;
      letter-spacing: -0.02em;
      white-space: nowrap;
      line-height: 1;
      padding: 0.2mm 0;
    }
    .ref {
      font-size: 5pt;
      color: #444;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      width: 100%;
    }
  </style></head><body>
    <div class="label">
      <div class="name" title="${safeName}">${safeName}</div>
      <div class="barcode-wrap">${svg}</div>
      <div class="price">${priceStr}</div>
      <div class="ref">${safeRef}</div>
    </div>
  </body></html>`
}

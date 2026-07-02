/** Wrap inner HTML for native Electron print (A4 or thermal). */
export function wrapPrintHtml(innerHTML: string, pageSize: 'A4' | '58mm' | '80mm' = 'A4'): string {
  const pageRule = pageSize === 'A4'
    ? '@page{size:A4;margin:8mm}'
    : `@page{size:${pageSize} auto;margin:2mm}`
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    ${pageRule}
    html,body{margin:0;padding:0;font-family:'Inter',system-ui,-apple-system,sans-serif}
    *{box-sizing:border-box}
    @media print{
      html,body{height:auto!important;overflow:visible!important}
      body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .invoice-page{
        page-break-after:always;
        break-after:page;
        min-height:260mm;
        max-width:100%;
        border:none!important;
        margin:0!important;
        padding:8mm!important;
        position:relative;
        overflow:hidden;
      }
      .invoice-page:last-child{page-break-after:auto;break-after:auto}
      .invoice-watermark{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:0;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .invoice-page-body{position:relative;z-index:1;display:flex;flex-direction:column;flex:1;min-height:0}
      .invoice-totals{page-break-inside:avoid;break-inside:avoid}
      .invoice-footer-block{page-break-inside:avoid;break-inside:avoid;margin-top:auto}
      table{page-break-inside:auto}
      tr{page-break-inside:avoid;break-inside:avoid}
    }
  </style></head><body>${innerHTML}</body></html>`
}

export type PrinterInfo = { name: string; isDefault?: boolean; description?: string }

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
    }
  </style></head><body>${innerHTML}</body></html>`
}

export type PrinterInfo = { name: string; isDefault?: boolean; description?: string }

export interface TsplLabelData {
  codeBarre: string
  nomProduit: string
  prix: string
  widthMm?: number
  heightMm?: number
  rotationDeg?: 0 | 180
}

/** Build raw TSPL for Gainscha GS-2408D (203 DPI). */
export function buildTsplLabel(data: TsplLabelData, copies = 1): string {
  const w = data.widthMm ?? 40
  const h = data.heightMm ?? 20
  const nom = data.nomProduit.length > 32
    ? `${data.nomProduit.slice(0, 30)}..`
    : data.nomProduit
  const code = data.codeBarre.replace(/"/g, '')
  const prix = data.prix.replace(/"/g, '')
  const direction = data.rotationDeg === 180 ? 'DIRECTION 1,0' : 'DIRECTION 0,0'

  return [
    `SIZE ${w} mm,${h} mm`,
    'GAP 3 mm,0 mm',
    direction,
    'OFFSET 0 mm',
    'SPEED 2',
    'DENSITY 12',
    'SET PEEL OFF',
    'SET CUTTER OFF',
    'CODEPAGE UTF-8',
    'CLS',
    `TEXT 10,4,"2",0,1,1,"${nom}"`,
    `BARCODE 10,28,"128",55,2,4,0,"${code}"`,
    `TEXT 10,100,"2",0,1,2,"${prix}"`,
    `PRINT ${Math.max(1, copies)},1`,
  ].join('\r\n')
}

export function findGainschaPrinterName(printers: { name: string }[]): string | null {
  const match = printers.find(p => {
    const n = p.name.toLowerCase()
    return n.includes('gainscha') || n.includes('gs-24') || n.includes('gs2408')
  })
  return match?.name ?? null
}

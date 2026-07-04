/** Electron webContents.print() only accepts standard names or { width, height } in microns. */
export type ElectronPageSize = string | { width: number; height: number }

export interface CustomPageSizeMm {
  widthMm: number
  heightMm: number
}

export function mmToMicrons(mm: number): number {
  return Math.round(mm * 1000)
}

export function resolveElectronPageSize(pageSize?: string | ElectronPageSize | CustomPageSizeMm): ElectronPageSize {
  if (!pageSize || pageSize === 'A4') return 'A4'
  if (typeof pageSize === 'object') {
    if ('widthMm' in pageSize && 'heightMm' in pageSize) {
      return { width: mmToMicrons(pageSize.widthMm), height: mmToMicrons(pageSize.heightMm) }
    }
    if ('width' in pageSize && 'height' in pageSize) return pageSize as ElectronPageSize
  }
  if (pageSize === '58mm') return { width: 58000, height: 297000 }
  if (pageSize === '80mm') return { width: 80000, height: 297000 }
  if (pageSize === '40x20mm' || pageSize === 'label') return { width: 39000, height: 20000 }
  if (pageSize === 'Letter' || pageSize === 'Legal' || pageSize === 'Tabloid') return pageSize
  if (typeof pageSize === 'string' && pageSize.endsWith('mm')) {
    const n = parseFloat(pageSize)
    if (Number.isFinite(n) && n > 0) return { width: Math.round(n * 1000), height: 297000 }
  }
  return 'A4'
}

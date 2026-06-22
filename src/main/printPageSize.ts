/** Electron webContents.print() only accepts standard names or { width, height } in microns. */
export type ElectronPageSize = string | { width: number; height: number }

export function resolveElectronPageSize(pageSize?: string | ElectronPageSize): ElectronPageSize {
  if (!pageSize || pageSize === 'A4') return 'A4'
  if (typeof pageSize === 'object' && 'width' in pageSize && 'height' in pageSize) return pageSize
  if (pageSize === '58mm') return { width: 58000, height: 297000 }
  if (pageSize === '80mm') return { width: 80000, height: 297000 }
  if (pageSize === '40x20mm' || pageSize === 'label') return { width: 40000, height: 20000 }
  if (pageSize === 'Letter' || pageSize === 'Legal' || pageSize === 'Tabloid') return pageSize
  // Unknown custom strings (e.g. legacy "58mm" passed as string) — rely on CSS @page only
  if (typeof pageSize === 'string' && pageSize.endsWith('mm')) {
    const n = parseFloat(pageSize)
    if (Number.isFinite(n) && n > 0) return { width: Math.round(n * 1000), height: 297000 }
  }
  return 'A4'
}

import { DEFAULT_LABEL_CONFIG, effectiveLabelMargins, type LabelPrintConfig } from './printManager'

export type LabelElementId = 'name' | 'barcode' | 'price'

/** Inner padding so content stays inside the printable area on Gainscha-style printers. */
export const LABEL_SAFE_INSET_MM = 1.5

export interface LabelElementBox {
  x: number
  y: number
  w: number
  h: number
  visible: boolean
}

export interface LabelVisualLayout {
  name: LabelElementBox
  barcode: LabelElementBox
  price: LabelElementBox
  showBarcodeText: boolean
}

export const LABEL_ELEMENT_IDS: LabelElementId[] = ['name', 'barcode', 'price']

const BOX_LIMITS: Record<LabelElementId, { minW: number; minH: number; maxH: number }> = {
  name: { minW: 8, minH: 2.5, maxH: 6 },
  barcode: { minW: 14, minH: 6, maxH: 15 },
  price: { minW: 8, minH: 2.5, maxH: 6 },
}

const DEFAULT_H: Record<LabelElementId, number> = {
  name: 3.5,
  barcode: 13,
  price: 3.5,
}

function maxBoxWidth(contentW: number): number {
  return Math.max(8, contentW - LABEL_SAFE_INSET_MM * 2)
}

function defaultBoxWidth(contentW: number): number {
  return maxBoxWidth(contentW)
}

function clampDimension(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function printableArea(cfg: Pick<LabelPrintConfig, 'widthMm' | 'heightMm' | 'stripLeftMm' | 'stripRightMm' | 'stripTopMm' | 'stripBottomMm'>) {
  return effectiveLabelMargins(cfg)
}

export function defaultVisualLayout(contentW: number, _contentH: number): LabelVisualLayout {
  const w = defaultBoxWidth(contentW)
  const inset = LABEL_SAFE_INSET_MM
  return {
    name: { x: inset, y: 0.4, w, h: DEFAULT_H.name, visible: true },
    barcode: { x: inset, y: 4, w, h: DEFAULT_H.barcode, visible: true },
    price: { x: inset, y: 17.1, w, h: DEFAULT_H.price, visible: true },
    showBarcodeText: true,
  }
}

export function clampBox(
  id: LabelElementId,
  box: LabelElementBox,
  contentW: number,
  contentH: number,
): LabelElementBox {
  const limits = BOX_LIMITS[id]
  const maxW = maxBoxWidth(contentW)
  const maxH = Math.min(limits.maxH, contentH - LABEL_SAFE_INSET_MM * 2)
  const w = clampDimension(box.w || defaultBoxWidth(contentW), limits.minW, maxW)
  const h = clampDimension(box.h || DEFAULT_H[id], limits.minH, maxH)
  const minX = LABEL_SAFE_INSET_MM
  const minY = LABEL_SAFE_INSET_MM
  const maxX = Math.max(minX, contentW - LABEL_SAFE_INSET_MM - w)
  const maxY = Math.max(minY, contentH - LABEL_SAFE_INSET_MM - h)
  const x = clampDimension(box.x, minX, maxX)
  const y = clampDimension(box.y, minY, maxY)
  return { ...box, x, y, w, h }
}

export function clampLayout(layout: LabelVisualLayout, contentW: number, contentH: number): LabelVisualLayout {
  return {
    showBarcodeText: layout.showBarcodeText !== false,
    name: clampBox('name', layout.name, contentW, contentH),
    barcode: clampBox('barcode', layout.barcode, contentW, contentH),
    price: clampBox('price', layout.price, contentW, contentH),
  }
}

export function parseVisualLayout(raw: string | undefined, contentW: number, contentH: number): LabelVisualLayout {
  const fallback = defaultVisualLayout(contentW, contentH)
  if (!raw?.trim()) return fallback
  try {
    const j = JSON.parse(raw) as Partial<LabelVisualLayout>
    const merged: LabelVisualLayout = {
      name: { ...fallback.name, ...j.name },
      barcode: { ...fallback.barcode, ...j.barcode },
      price: { ...fallback.price, ...j.price },
      showBarcodeText: j.showBarcodeText !== false,
    }
    // Upgrade tiny legacy barcode boxes saved before larger defaults.
    if (merged.barcode.h < DEFAULT_H.barcode * 0.85) {
      merged.barcode.h = DEFAULT_H.barcode
    }
    return clampLayout(merged, contentW, contentH)
  } catch {
    return fallback
  }
}

export function serializeVisualLayout(layout: LabelVisualLayout): string {
  return JSON.stringify(layout)
}

export function mergeVisualLayout(base: LabelVisualLayout, patch: Partial<LabelVisualLayout>): LabelVisualLayout {
  return {
    ...base,
    ...patch,
    name: patch.name ? { ...base.name, ...patch.name } : base.name,
    barcode: patch.barcode ? { ...base.barcode, ...patch.barcode } : base.barcode,
    price: patch.price ? { ...base.price, ...patch.price } : base.price,
  }
}

export function resetVisualLayout(cfg: LabelPrintConfig): LabelVisualLayout {
  const { contentW, contentH } = printableArea(cfg)
  return defaultVisualLayout(contentW, contentH)
}

/** Font size (pt) derived from box height. */
export function fontPtForBox(hMm: number, maxPt: number): number {
  return Math.min(maxPt, Math.max(4, hMm * 1.45))
}

export function labelConfigWithLayout(cfg: LabelPrintConfig, layout: LabelVisualLayout): LabelPrintConfig {
  const { contentW, contentH } = printableArea(cfg)
  return { ...cfg, layout: clampLayout(layout, contentW, contentH) }
}

export function defaultLabelConfig(): LabelPrintConfig {
  const cfg = { ...DEFAULT_LABEL_CONFIG }
  const { contentW, contentH } = printableArea(cfg)
  return { ...cfg, layout: defaultVisualLayout(contentW, contentH) }
}

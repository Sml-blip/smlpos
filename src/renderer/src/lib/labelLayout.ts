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

const FIXED_H: Record<LabelElementId, number> = {
  name: 3.8,
  barcode: 9.5,
  price: 3.8,
}

function fixedBoxWidth(contentW: number): number {
  return Math.max(4, contentW - LABEL_SAFE_INSET_MM * 2)
}

export function printableArea(cfg: Pick<LabelPrintConfig, 'widthMm' | 'heightMm' | 'stripLeftMm' | 'stripRightMm' | 'stripTopMm' | 'stripBottomMm'>) {
  return effectiveLabelMargins(cfg)
}

export function defaultVisualLayout(contentW: number, _contentH: number): LabelVisualLayout {
  const w = fixedBoxWidth(contentW)
  const inset = LABEL_SAFE_INSET_MM
  return {
    name: { x: inset, y: 0.4, w, h: FIXED_H.name, visible: true },
    barcode: { x: inset, y: 4.5, w, h: FIXED_H.barcode, visible: true },
    price: { x: inset, y: 14.8, w, h: FIXED_H.price, visible: true },
    showBarcodeText: true,
  }
}

/** Move-only: x/y change; w/h are fixed per element type. */
export function clampBox(
  id: LabelElementId,
  box: LabelElementBox,
  contentW: number,
  contentH: number,
): LabelElementBox {
  const w = fixedBoxWidth(contentW)
  const h = FIXED_H[id]
  const minX = LABEL_SAFE_INSET_MM
  const minY = LABEL_SAFE_INSET_MM
  const maxX = Math.max(minX, contentW - LABEL_SAFE_INSET_MM - w)
  const maxY = Math.max(minY, contentH - LABEL_SAFE_INSET_MM - h)
  const x = Math.min(Math.max(minX, box.x), maxX)
  const y = Math.min(Math.max(minY, box.y), maxY)
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

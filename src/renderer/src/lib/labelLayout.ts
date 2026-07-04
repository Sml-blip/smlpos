import { DEFAULT_LABEL_CONFIG, effectiveLabelMargins, type LabelPrintConfig } from './printManager'

export type LabelElementId = 'name' | 'barcode' | 'price'
export type BarcodeFormatMode = 'auto' | 'EAN13' | 'EAN8' | 'CODE128'

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
  barcodeFormat: BarcodeFormatMode
  showBarcodeText: boolean
}

export const LABEL_ELEMENT_IDS: LabelElementId[] = ['name', 'barcode', 'price']

export const BARCODE_FORMAT_OPTIONS: { value: BarcodeFormatMode; label: string }[] = [
  { value: 'auto', label: 'Auto (EAN si possible)' },
  { value: 'EAN13', label: 'EAN-13' },
  { value: 'EAN8', label: 'EAN-8' },
  { value: 'CODE128', label: 'Code 128' },
]

const MIN_W = 4
const MIN_H = 2

export function printableArea(cfg: Pick<LabelPrintConfig, 'widthMm' | 'heightMm' | 'stripLeftMm' | 'stripRightMm' | 'stripTopMm' | 'stripBottomMm'>) {
  return effectiveLabelMargins(cfg)
}

export function defaultVisualLayout(contentW: number, contentH: number): LabelVisualLayout {
  const w = Math.min(contentW, Math.max(MIN_W, contentW))
  return {
    name: { x: 0, y: 0.4, w, h: 3.8, visible: true },
    barcode: { x: 0, y: 4.5, w, h: 9.5, visible: true },
    price: { x: 0, y: 14.8, w, h: 3.8, visible: true },
    barcodeFormat: 'auto',
    showBarcodeText: true,
  }
}

export function clampBox(box: LabelElementBox, contentW: number, contentH: number): LabelElementBox {
  const w = Math.min(contentW, Math.max(MIN_W, box.w))
  const h = Math.min(contentH, Math.max(MIN_H, box.h))
  const x = Math.min(Math.max(0, box.x), Math.max(0, contentW - w))
  const y = Math.min(Math.max(0, box.y), Math.max(0, contentH - h))
  return { ...box, x, y, w, h }
}

export function clampLayout(layout: LabelVisualLayout, contentW: number, contentH: number): LabelVisualLayout {
  return {
    ...layout,
    name: clampBox(layout.name, contentW, contentH),
    barcode: clampBox(layout.barcode, contentW, contentH),
    price: clampBox(layout.price, contentW, contentH),
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
      barcodeFormat: isFormat(j.barcodeFormat) ? j.barcodeFormat : fallback.barcodeFormat,
      showBarcodeText: j.showBarcodeText !== false,
    }
    return clampLayout(merged, contentW, contentH)
  } catch {
    return fallback
  }
}

function isFormat(v: unknown): v is BarcodeFormatMode {
  return v === 'auto' || v === 'EAN13' || v === 'EAN8' || v === 'CODE128'
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

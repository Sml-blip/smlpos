import type { LabelPrintConfig } from './printManager'
import { DEFAULT_LABEL_CONFIG, LABEL_SETTING_KEYS, LABEL_SAFE_RIGHT_MM } from './printManager'
import {
  defaultVisualLayout,
  parseVisualLayout,
  serializeVisualLayout,
  clampLayout,
  printableArea,
  defaultLabelConfig,
} from './labelLayout'

const api = window.api

function parseNum(raw: string | undefined, fallback: number): number {
  const n = parseFloat(String(raw ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : fallback
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function normalizeStripRight(stripRightMm: number, widthMm: number): number {
  if (widthMm <= 45 && stripRightMm > 4) return LABEL_SAFE_RIGHT_MM
  if (widthMm <= 45 && stripRightMm < LABEL_SAFE_RIGHT_MM) return LABEL_SAFE_RIGHT_MM
  return stripRightMm
}

function normalizeStripLeft(stripLeftMm: number, widthMm: number): number {
  if (widthMm <= 45 && stripLeftMm > 4) return DEFAULT_LABEL_CONFIG.stripLeftMm
  return stripLeftMm
}

export function labelConfigFromSettings(all: Record<string, string>): LabelPrintConfig {
  const widthMm = parseNum(all.impression_label_width, DEFAULT_LABEL_CONFIG.widthMm)
  const heightMm = parseNum(all.impression_label_height, DEFAULT_LABEL_CONFIG.heightMm)
  const stripLeftMm = normalizeStripLeft(
    parseNum(all.impression_label_strip_left, DEFAULT_LABEL_CONFIG.stripLeftMm),
    widthMm,
  )
  const stripRightMm = normalizeStripRight(
    parseNum(all.impression_label_strip_right, DEFAULT_LABEL_CONFIG.stripRightMm),
    widthMm,
  )
  const stripTopMm = parseNum(all.impression_label_strip_top, DEFAULT_LABEL_CONFIG.stripTopMm)
  const stripBottomMm = parseNum(all.impression_label_strip_bottom, DEFAULT_LABEL_CONFIG.stripBottomMm)
  const rot = parseInt(all.impression_label_rotation ?? '0', 10)

  const base: LabelPrintConfig = {
    widthMm,
    heightMm,
    stripLeftMm,
    stripRightMm,
    stripTopMm,
    stripBottomMm,
    rotationDeg: rot === 180 ? 180 : 0,
    dpi: clamp(parseNum(all.impression_label_dpi, DEFAULT_LABEL_CONFIG.dpi), 72, 600),
    defaultCopies: clamp(parseInt(all.impression_label_copies ?? '1', 10) || 1, 1, 99),
    labelEngine: all.impression_label_engine === 'html' ? 'html' : 'gainscha',
    labelConnection: all.impression_label_connection === 'usb' ? 'usb' : 'driver',
    usbDevice: all.impression_label_usb_device ?? '',
    layout: defaultVisualLayout(1, 1),
  }

  const { contentW, contentH } = printableArea(base)
  base.layout = parseVisualLayout(all.impression_label_layout_json, contentW, contentH)
  return base
}

export function settingsFromLabelConfig(cfg: LabelPrintConfig): Record<string, string> {
  const { contentW, contentH } = printableArea(cfg)
  const layout = clampLayout(cfg.layout, contentW, contentH)
  return {
    impression_label_width: String(cfg.widthMm),
    impression_label_height: String(cfg.heightMm),
    impression_label_strip_left: String(cfg.stripLeftMm),
    impression_label_strip_right: String(cfg.stripRightMm),
    impression_label_strip_top: String(cfg.stripTopMm),
    impression_label_strip_bottom: String(cfg.stripBottomMm),
    impression_label_rotation: String(cfg.rotationDeg),
    impression_label_dpi: String(cfg.dpi),
    impression_label_copies: String(cfg.defaultCopies),
    impression_label_layout_json: serializeVisualLayout(layout),
    impression_label_engine: cfg.labelEngine,
    impression_label_connection: cfg.labelConnection,
    impression_label_usb_device: cfg.usbDevice,
  }
}

export async function loadLabelPrintConfig(): Promise<LabelPrintConfig> {
  try {
    const all = (await api.settingsGetAll()) as Record<string, string>
    return labelConfigFromSettings(all)
  } catch {
    return defaultLabelConfig()
  }
}

export async function saveLabelPrintConfig(cfg: LabelPrintConfig): Promise<void> {
  await api.settingsSetMany(settingsFromLabelConfig(cfg))
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

export function scheduleSaveLabelPrintConfig(
  cfg: LabelPrintConfig,
  onDone?: (ok: boolean) => void,
): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try {
      await saveLabelPrintConfig(cfg)
      onDone?.(true)
    } catch {
      onDone?.(false)
    }
  }, 450)
}

export function mergeLabelConfig(partial?: Partial<LabelPrintConfig>): LabelPrintConfig {
  const base = defaultLabelConfig()
  const merged: LabelPrintConfig = {
    ...base,
    ...partial,
    layout: partial?.layout
      ? { ...base.layout, ...partial.layout, name: { ...base.layout.name, ...partial.layout.name }, barcode: { ...base.layout.barcode, ...partial.layout.barcode }, price: { ...base.layout.price, ...partial.layout.price } }
      : base.layout,
    rotationDeg: partial?.rotationDeg === 180 ? 180 : partial?.rotationDeg === 0 ? 0 : (partial?.rotationDeg ?? base.rotationDeg),
    labelEngine: partial?.labelEngine === 'html' ? 'html' : partial?.labelEngine === 'gainscha' ? 'gainscha' : base.labelEngine,
    labelConnection: partial?.labelConnection === 'usb' ? 'usb' : partial?.labelConnection === 'driver' ? 'driver' : base.labelConnection,
    usbDevice: partial?.usbDevice ?? base.usbDevice,
  }
  merged.stripRightMm = normalizeStripRight(merged.stripRightMm, merged.widthMm)
  merged.stripLeftMm = normalizeStripLeft(merged.stripLeftMm, merged.widthMm)
  const { contentW, contentH } = printableArea(merged)
  merged.layout = clampLayout(merged.layout, contentW, contentH)
  return merged
}

export function pickLabelSettingsPatch(all: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of LABEL_SETTING_KEYS) {
    if (all[key] !== undefined) out[key] = all[key]
  }
  return out
}

import type { LabelPrintConfig, LabelTextAlign } from './printManager'
import { DEFAULT_LABEL_CONFIG, LABEL_SETTING_KEYS, LABEL_SAFE_RIGHT_MM } from './printManager'

const api = window.api

function parseNum(raw: string | undefined, fallback: number): number {
  const n = parseFloat(String(raw ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : fallback
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === 'true') return true
  if (raw === 'false') return false
  return fallback
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function labelConfigFromSettings(all: Record<string, string>): LabelPrintConfig {
  const rot = parseInt(all.impression_label_rotation ?? '0', 10)
  const lines = parseInt(all.impression_label_name_lines ?? '2', 10)
  const align = (all.impression_label_align ?? 'auto') as LabelTextAlign

  return {
    widthMm: parseNum(all.impression_label_width, DEFAULT_LABEL_CONFIG.widthMm),
    heightMm: parseNum(all.impression_label_height, DEFAULT_LABEL_CONFIG.heightMm),
    stripLeftMm: parseNum(all.impression_label_strip_left, DEFAULT_LABEL_CONFIG.stripLeftMm),
    stripRightMm: normalizeStripRight(
      parseNum(all.impression_label_strip_right, DEFAULT_LABEL_CONFIG.stripRightMm),
      parseNum(all.impression_label_width, DEFAULT_LABEL_CONFIG.widthMm),
    ),
    stripTopMm: parseNum(all.impression_label_strip_top, DEFAULT_LABEL_CONFIG.stripTopMm),
    stripBottomMm: parseNum(all.impression_label_strip_bottom, DEFAULT_LABEL_CONFIG.stripBottomMm),
    rotationDeg: rot === 180 ? 180 : 0,
    barHeightMm: parseNum(all.impression_label_bar_height, DEFAULT_LABEL_CONFIG.barHeightMm),
    barMarginMm: parseNum(all.impression_label_bar_margin, DEFAULT_LABEL_CONFIG.barMarginMm),
    moduleWidthMaxMm: parseNum(all.impression_label_module_max, DEFAULT_LABEL_CONFIG.moduleWidthMaxMm),
    showName: parseBool(all.impression_label_show_name, DEFAULT_LABEL_CONFIG.showName),
    showPrice: parseBool(all.impression_label_show_price, DEFAULT_LABEL_CONFIG.showPrice),
    showBarcodeText: parseBool(all.impression_label_show_barcode_text, DEFAULT_LABEL_CONFIG.showBarcodeText),
    nameFontPt: parseNum(all.impression_label_name_font, DEFAULT_LABEL_CONFIG.nameFontPt),
    priceFontPt: parseNum(all.impression_label_price_font, DEFAULT_LABEL_CONFIG.priceFontPt),
    nameMaxLines: (lines === 1 ? 1 : lines === 3 ? 3 : 2) as 1 | 2 | 3,
    textAlign: align === 'left' || align === 'center' || align === 'right' ? align : 'auto',
    dpi: clamp(parseNum(all.impression_label_dpi, DEFAULT_LABEL_CONFIG.dpi), 72, 600),
    defaultCopies: clamp(parseInt(all.impression_label_copies ?? '1', 10) || 1, 1, 99),
    gapNameBarcodeMm: parseNum(all.impression_label_gap_name_bar, DEFAULT_LABEL_CONFIG.gapNameBarcodeMm),
    gapBarcodePriceMm: parseNum(all.impression_label_gap_bar_price, DEFAULT_LABEL_CONFIG.gapBarcodePriceMm),
    contentVAlign: parseContentVAlign(all.impression_label_valign),
    contentScalePct: clamp(parseNum(all.impression_label_content_scale, DEFAULT_LABEL_CONFIG.contentScalePct), 70, 200),
  }
}

function parseContentVAlign(raw: string | undefined): LabelPrintConfig['contentVAlign'] {
  if (raw === 'center' || raw === 'bottom' || raw === 'space-between') return raw
  return 'top'
}

/** Legacy saves used 1.3–3mm; 40mm label printers need ~8mm right safe zone. */
function normalizeStripRight(stripRightMm: number, widthMm: number): number {
  if (widthMm <= 45 && stripRightMm < LABEL_SAFE_RIGHT_MM) return LABEL_SAFE_RIGHT_MM
  return stripRightMm
}

export function settingsFromLabelConfig(cfg: LabelPrintConfig): Record<string, string> {
  return {
    impression_label_width: String(cfg.widthMm),
    impression_label_height: String(cfg.heightMm),
    impression_label_strip_left: String(cfg.stripLeftMm),
    impression_label_strip_right: String(cfg.stripRightMm),
    impression_label_strip_top: String(cfg.stripTopMm),
    impression_label_strip_bottom: String(cfg.stripBottomMm),
    impression_label_rotation: String(cfg.rotationDeg),
    impression_label_bar_height: String(cfg.barHeightMm),
    impression_label_bar_margin: String(cfg.barMarginMm),
    impression_label_module_max: String(cfg.moduleWidthMaxMm),
    impression_label_show_name: String(cfg.showName),
    impression_label_show_price: String(cfg.showPrice),
    impression_label_show_barcode_text: String(cfg.showBarcodeText),
    impression_label_name_font: String(cfg.nameFontPt),
    impression_label_price_font: String(cfg.priceFontPt),
    impression_label_name_lines: String(cfg.nameMaxLines),
    impression_label_align: cfg.textAlign,
    impression_label_dpi: String(cfg.dpi),
    impression_label_copies: String(cfg.defaultCopies),
    impression_label_gap_name_bar: String(cfg.gapNameBarcodeMm),
    impression_label_gap_bar_price: String(cfg.gapBarcodePriceMm),
    impression_label_valign: cfg.contentVAlign,
    impression_label_content_scale: String(cfg.contentScalePct),
  }
}

export async function loadLabelPrintConfig(): Promise<LabelPrintConfig> {
  try {
    const all = (await api.settingsGetAll()) as Record<string, string>
    return labelConfigFromSettings(all)
  } catch {
    return { ...DEFAULT_LABEL_CONFIG }
  }
}

export async function saveLabelPrintConfig(cfg: LabelPrintConfig): Promise<void> {
  await api.settingsSetMany(settingsFromLabelConfig(cfg))
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

/** Debounced autosave for label barcode settings (450 ms). */
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
  const base = { ...DEFAULT_LABEL_CONFIG, ...partial }
  return {
    ...base,
    stripRightMm: normalizeStripRight(base.stripRightMm, base.widthMm),
    rotationDeg: partial?.rotationDeg === 180 ? 180 : partial?.rotationDeg === 0 ? 0 : base.rotationDeg,
    nameMaxLines: partial?.nameMaxLines === 1 ? 1 : partial?.nameMaxLines === 3 ? 3 : base.nameMaxLines,
    textAlign:
      partial?.textAlign === 'left' || partial?.textAlign === 'center' || partial?.textAlign === 'right'
        ? partial.textAlign
        : partial?.textAlign === 'auto'
          ? 'auto'
          : base.textAlign,
  }
}

export function pickLabelSettingsPatch(all: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of LABEL_SETTING_KEYS) {
    if (all[key] !== undefined) out[key] = all[key]
  }
  return out
}

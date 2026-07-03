import type { LabelPrintConfig } from './printManager'
import { DEFAULT_LABEL_CONFIG } from './printManager'

const api = window.api

export async function loadLabelPrintConfig(): Promise<LabelPrintConfig> {
  try {
    const all = (await api.settingsGetAll()) as Record<string, string>
    const rot = parseInt(all.impression_label_rotation ?? '0', 10)
    return {
      widthMm: parseFloat(all.impression_label_width ?? '') || DEFAULT_LABEL_CONFIG.widthMm,
      heightMm: parseFloat(all.impression_label_height ?? '') || DEFAULT_LABEL_CONFIG.heightMm,
      stripLeftMm: parseFloat(all.impression_label_strip_left ?? '') || DEFAULT_LABEL_CONFIG.stripLeftMm,
      stripRightMm: parseFloat(all.impression_label_strip_right ?? '') || DEFAULT_LABEL_CONFIG.stripRightMm,
      rotationDeg: rot === 0 ? 0 : 180,
    }
  } catch {
    return { ...DEFAULT_LABEL_CONFIG }
  }
}

export async function saveLabelPrintConfig(cfg: LabelPrintConfig): Promise<void> {
  await api.settingsSetMany({
    impression_label_width: String(cfg.widthMm),
    impression_label_height: String(cfg.heightMm),
    impression_label_strip_left: String(cfg.stripLeftMm),
    impression_label_strip_right: String(cfg.stripRightMm),
    impression_label_rotation: String(cfg.rotationDeg),
  })
}

export function mergeLabelConfig(partial?: Partial<LabelPrintConfig>): LabelPrintConfig {
  return {
    ...DEFAULT_LABEL_CONFIG,
    ...partial,
    rotationDeg: partial?.rotationDeg === 180 ? 180 : (partial?.rotationDeg === 0 ? 0 : DEFAULT_LABEL_CONFIG.rotationDeg),
  }
}

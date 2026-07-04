import type { NativePageSize, PrintProfile } from '../components/PrintManagerModal'

export type PrintKind = 'document' | 'label' | 'ticket'

export type PrintSettingsKey =
  | 'impression_printer_a4'
  | 'impression_printer_ticket'
  | 'impression_printer_label'

export type LabelTextAlign = 'auto' | 'left' | 'center' | 'right'

export interface LabelPrintConfig {
  widthMm: number
  heightMm: number
  stripLeftMm: number
  stripRightMm: number
  stripTopMm: number
  stripBottomMm: number
  rotationDeg: 0 | 180
  barHeightMm: number
  /** Extra margin subtracted from content width for barcode max width */
  barMarginMm: number
  /** Max module width (mm) — lower = denser barcode */
  moduleWidthMaxMm: number
  showName: boolean
  showPrice: boolean
  showBarcodeText: boolean
  nameFontPt: number
  priceFontPt: number
  nameMaxLines: 1 | 2 | 3
  textAlign: LabelTextAlign
  dpi: number
  defaultCopies: number
  /** Vertical gap between product name and barcode (mm) */
  gapNameBarcodeMm: number
  /** Vertical gap between barcode and price (mm) */
  gapBarcodePriceMm: number
  /** Vertical placement of content block inside the label */
  contentVAlign: 'top' | 'center' | 'bottom' | 'space-between'
  /** Scale all label content (name + barcode + price), 70–200% */
  contentScalePct: number
}

export const DEFAULT_LABEL_CONFIG: LabelPrintConfig = {
  widthMm: 40,
  heightMm: 19.9,
  stripLeftMm: 1,
  stripRightMm: 8,
  stripTopMm: 0.35,
  stripBottomMm: 0.35,
  rotationDeg: 0,
  barHeightMm: 5.8,
  barMarginMm: 1,
  moduleWidthMaxMm: 0.38,
  showName: true,
  showPrice: true,
  showBarcodeText: true,
  nameFontPt: 5.5,
  priceFontPt: 7.5,
  nameMaxLines: 2,
  textAlign: 'auto',
  dpi: 300,
  defaultCopies: 1,
  gapNameBarcodeMm: 0.2,
  gapBarcodePriceMm: 0.2,
  contentVAlign: 'top',
  contentScalePct: 100,
}

/** Gainscha / 40mm label printers often have ~8mm non-printable zone on the right. */
export const LABEL_SAFE_RIGHT_MM = 8

export function effectiveLabelMargins(cfg: Pick<LabelPrintConfig, 'widthMm' | 'heightMm' | 'stripLeftMm' | 'stripRightMm' | 'stripTopMm' | 'stripBottomMm'>) {
  const minRight = cfg.widthMm <= 45 ? LABEL_SAFE_RIGHT_MM : 3
  const stripRightMm = Math.max(cfg.stripRightMm, minRight)
  return {
    stripLeftMm: cfg.stripLeftMm,
    stripRightMm,
    stripTopMm: cfg.stripTopMm,
    stripBottomMm: cfg.stripBottomMm,
    contentW: Math.max(1, cfg.widthMm - cfg.stripLeftMm - stripRightMm),
    contentH: Math.max(1, cfg.heightMm - cfg.stripTopMm - cfg.stripBottomMm),
  }
}

export const LABEL_SETTING_KEYS = [
  'impression_label_width',
  'impression_label_height',
  'impression_label_strip_left',
  'impression_label_strip_right',
  'impression_label_strip_top',
  'impression_label_strip_bottom',
  'impression_label_rotation',
  'impression_label_bar_height',
  'impression_label_bar_margin',
  'impression_label_module_max',
  'impression_label_show_name',
  'impression_label_show_price',
  'impression_label_show_barcode_text',
  'impression_label_name_font',
  'impression_label_price_font',
  'impression_label_name_lines',
  'impression_label_align',
  'impression_label_dpi',
  'impression_label_copies',
  'impression_label_gap_name_bar',
  'impression_label_gap_bar_price',
  'impression_label_valign',
  'impression_label_content_scale',
] as const

export interface PrintJob {
  html: string
  printKind?: PrintKind
  defaultPageSize?: NativePageSize
  settingsKey?: PrintSettingsKey
  labelConfig?: Partial<LabelPrintConfig>
  /** When set, label HTML is rebuilt when label dimensions change in the modal */
  labelSource?: { code: string; nom: string; prix: number; productRef?: string }
  extraProfiles?: PrintProfile[]
}

type OpenFn = (job: PrintJob) => void

let openPrint: OpenFn | null = null

export function inferPrintKind(job: Pick<PrintJob, 'printKind' | 'defaultPageSize'>): PrintKind {
  if (job.printKind) return job.printKind
  const ps = job.defaultPageSize ?? 'A4'
  if (ps === '40x20mm') return 'label'
  if (ps === '58mm' || ps === '80mm') return 'ticket'
  return 'document'
}

export function defaultSettingsKey(kind: PrintKind): PrintSettingsKey {
  if (kind === 'label') return 'impression_printer_label'
  if (kind === 'ticket') return 'impression_printer_ticket'
  return 'impression_printer_a4'
}

export function registerPrintManager(fn: OpenFn | null): void {
  openPrint = fn
}

/** Open the global print manager modal. Returns false if the provider is not mounted yet. */
export function openPrintManager(job: PrintJob): boolean {
  if (!openPrint) {
    console.warn('[print] PrintManagerProvider not mounted')
    return false
  }
  if (!job.html?.trim()) {
    console.warn('[print] empty HTML')
    return false
  }
  const kind = inferPrintKind(job)
  openPrint({
    ...job,
    printKind: kind,
    settingsKey: job.settingsKey ?? defaultSettingsKey(kind),
  })
  return true
}

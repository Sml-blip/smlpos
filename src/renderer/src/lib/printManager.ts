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
}

export const DEFAULT_LABEL_CONFIG: LabelPrintConfig = {
  widthMm: 40,
  heightMm: 19.9,
  stripLeftMm: 1,
  stripRightMm: 3,
  stripTopMm: 0.35,
  stripBottomMm: 0.35,
  rotationDeg: 0,
  barHeightMm: 5.8,
  barMarginMm: 3.5,
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

import type { LabelVisualLayout } from './labelLayout'
import type { NativePageSize, PrintProfile } from '../components/PrintManagerModal'

export type PrintKind = 'document' | 'label' | 'ticket'

export type PrintSettingsKey =
  | 'impression_printer_a4'
  | 'impression_printer_ticket'
  | 'impression_printer_label'

export interface LabelPrintConfig {
  widthMm: number
  heightMm: number
  stripLeftMm: number
  stripRightMm: number
  stripTopMm: number
  stripBottomMm: number
  rotationDeg: 0 | 180
  dpi: number
  defaultCopies: number
  layout: LabelVisualLayout
  /** Windows: native Gainscha GTSPL SDK vs HTML spooler vs TSPL raw COPY /B */
  labelEngine: 'gainscha' | 'html' | 'tspl_raw'
  labelConnection: 'driver' | 'usb'
  usbDevice: string
}

export const DEFAULT_LABEL_CONFIG: Omit<LabelPrintConfig, 'layout'> = {
  widthMm: 40,
  heightMm: 20,
  stripLeftMm: 1,
  stripRightMm: 1,
  stripTopMm: 0.35,
  stripBottomMm: 0.35,
  rotationDeg: 0,
  dpi: 203,
  defaultCopies: 1,
  labelEngine: 'tspl_raw',
  labelConnection: 'driver',
  usbDevice: '',
}

/** Keep a small physical inset; the SDK print template uses almost the full 39mm width. */
export const LABEL_SAFE_RIGHT_MM = 1

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
  'impression_label_dpi',
  'impression_label_copies',
  'impression_label_layout_json',
  'impression_label_engine',
  'impression_label_connection',
  'impression_label_usb_device',
] as const

export interface PrintJob {
  html: string
  printKind?: PrintKind
  defaultPageSize?: NativePageSize
  settingsKey?: PrintSettingsKey
  labelConfig?: Partial<LabelPrintConfig>
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

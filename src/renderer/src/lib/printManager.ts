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
  rotationDeg: 0 | 180
}

export const DEFAULT_LABEL_CONFIG: LabelPrintConfig = {
  widthMm: 40,
  heightMm: 19.9,
  stripLeftMm: 1,
  stripRightMm: 3,
  rotationDeg: 0,
}

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

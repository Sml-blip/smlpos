import type { NativePageSize, PrintProfile } from '../components/PrintManagerModal'

export type PrintSettingsKey = 'impression_printer_a4' | 'impression_printer_ticket'

export interface PrintJob {
  html: string
  defaultPageSize?: NativePageSize
  settingsKey?: PrintSettingsKey
  extraProfiles?: PrintProfile[]
}

type OpenFn = (job: PrintJob) => void

let openPrint: OpenFn | null = null

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
  openPrint(job)
  return true
}

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import PrintManagerModal from './PrintManagerModal'
import { registerPrintManager, type PrintJob } from '../lib/printManager'

const PrintContext = createContext<(job: PrintJob) => void>(() => {})

export function usePrintManager(): (job: PrintJob) => void {
  return useContext(PrintContext)
}

export function PrintManagerProvider({ children }: { children: ReactNode }) {
  const [job, setJob] = useState<PrintJob | null>(null)

  const open = useCallback((next: PrintJob) => setJob(next), [])

  useEffect(() => {
    registerPrintManager(open)
    return () => registerPrintManager(null)
  }, [open])

  return (
    <PrintContext.Provider value={open}>
      {children}
      {job && (
        <PrintManagerModal
          html={job.html}
          printKind={job.printKind}
          defaultPageSize={job.defaultPageSize ?? 'A4'}
          settingsKey={job.settingsKey}
          labelConfig={job.labelConfig}
          labelSource={job.labelSource}
          extraProfiles={job.extraProfiles}
          onClose={() => setJob(null)}
        />
      )}
    </PrintContext.Provider>
  )
}

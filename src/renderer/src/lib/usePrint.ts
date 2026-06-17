import { useRef, useCallback } from 'react'
import { printHtmlNow } from './nativePrint'

/**
 * Native print hook — uses Electron printContent (OS dialog), not react-to-print.
 */
export function usePrint(_documentTitle: string, _pageStyle?: string) {
  const printRef = useRef<HTMLDivElement>(null)

  const handlePrint = useCallback(async () => {
    if (!printRef.current) return
    await printHtmlNow(printRef.current.innerHTML, { pageSize: 'A4' })
  }, [])

  return { printRef, handlePrint }
}

/** Thermal print hook — 58mm ticket via native IPC. */
export function usePrintThermal(_documentTitle: string) {
  const printRef = useRef<HTMLDivElement>(null)

  const handlePrint = useCallback(async () => {
    if (!printRef.current) return
    await printHtmlNow(printRef.current.innerHTML, { pageSize: '58mm', settingsKey: 'impression_printer_ticket' })
  }, [])

  return { printRef, handlePrint }
}

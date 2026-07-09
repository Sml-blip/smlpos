import { exec } from 'child_process'
import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildTsplLabel, findGainschaPrinterName, type TsplLabelData } from './tspl'

export interface TsplPrintResult {
  success: boolean
  error?: string
  printer?: string
}

function sendTsplRaw(tspl: string, printerName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tmp = join(tmpdir(), `smlpos_tspl_${Date.now()}.prn`)
    writeFileSync(tmp, tspl, 'latin1')
    const cmd = `COPY /B "${tmp}" "${printerName}"`
    exec(cmd, { shell: 'cmd.exe', windowsHide: true }, (err, _stdout, stderr) => {
      try { unlinkSync(tmp) } catch { /* ignore */ }
      if (err) reject(new Error(stderr?.trim() || err.message))
      else resolve()
    })
  })
}

export async function printTsplLabel(
  data: TsplLabelData & { copies?: number; printerName?: string },
  getPrinters: () => Promise<{ name: string }[]>,
): Promise<TsplPrintResult> {
  if (process.platform !== 'win32') {
    return { success: false, error: 'TSPL raw disponible uniquement sur Windows' }
  }
  try {
    const printers = await getPrinters()
    const printer = data.printerName?.trim() || findGainschaPrinterName(printers)
    if (!printer) {
      return {
        success: false,
        error: 'Imprimante Gainscha introuvable — vérifiez connexion USB et driver Seagull',
      }
    }
    const tspl = buildTsplLabel(data, data.copies ?? 1)
    await sendTsplRaw(tspl, printer)
    return { success: true, printer }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

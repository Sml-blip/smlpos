import { spawn } from 'child_process'
import { existsSync, mkdtempSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { is } from '@electron-toolkit/utils'

export interface GainschaLabelElement {
  x: number
  y: number
  w: number
  h: number
  visible: boolean
  text?: string
  value?: string
  displayText?: string
}

export interface GainschaPrintJob {
  connection: 'driver' | 'usb'
  printerName?: string
  usbDevice?: string
  widthMm: number
  heightMm: number
  stripLeftMm: number
  stripRightMm: number
  stripTopMm: number
  stripBottomMm: number
  rotationDeg: 0 | 180
  dpi: number
  copies: number
  showBarcodeText: boolean
  elements: {
    name: GainschaLabelElement
    barcode: GainschaLabelElement
    price: GainschaLabelElement
  }
}

export interface GainschaScriptResult {
  success: boolean
  error?: string
  version?: string
  devices?: string[]
}

function resolveGainschaRoot(): string | null {
  const candidates = [
    join(process.resourcesPath, 'resources', 'gainscha'),
    join(process.resourcesPath, 'gainscha'),
    join(__dirname, '../../resources/gainscha'),
  ]
  for (const dir of candidates) {
    const script = join(dir, 'gainscha-print.ps1')
    const dll = join(dir, 'x64', 'GTSPL_SDK.dll')
    if (existsSync(script) && existsSync(dll)) return dir
  }
  return null
}

function runPowerShell(args: string[]): Promise<GainschaScriptResult> {
  return new Promise((resolve) => {
    const psArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args]
    const child = spawn('powershell.exe', psArgs, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('error', (err) => {
      resolve({ success: false, error: err.message })
    })
    child.on('close', (code) => {
      const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? ''
      try {
        const parsed = JSON.parse(line) as GainschaScriptResult
        if (!parsed.success && !parsed.error && stderr) parsed.error = stderr.trim()
        resolve(parsed)
      } catch {
        resolve({
          success: code === 0,
          error: stderr.trim() || stdout.trim() || `Script PowerShell échoué (code ${code ?? '?'})`,
        })
      }
    })
  })
}

export function isGainschaAvailable(): boolean {
  return process.platform === 'win32' && resolveGainschaRoot() !== null
}

export async function gainschaDetectUsb(): Promise<GainschaScriptResult> {
  const root = resolveGainschaRoot()
  if (!root) return { success: false, error: 'SDK Gainscha non installé', devices: [] }
  const script = join(root, 'gainscha-print.ps1')
  return runPowerShell(['-File', script, '-Detect'])
}

export async function gainschaSdkVersion(): Promise<GainschaScriptResult> {
  const root = resolveGainschaRoot()
  if (!root) return { success: false, error: 'SDK Gainscha non installé' }
  const script = join(root, 'gainscha-print.ps1')
  return runPowerShell(['-File', script, '-Version'])
}

export async function gainschaPrintLabel(job: GainschaPrintJob): Promise<GainschaScriptResult> {
  if (process.platform !== 'win32') {
    return { success: false, error: 'SDK Gainscha disponible uniquement sur Windows' }
  }
  const root = resolveGainschaRoot()
  if (!root) {
    return { success: false, error: 'SDK Gainscha introuvable dans resources/gainscha' }
  }

  const tmpDir = mkdtempSync(join(tmpdir(), 'smlpos-gainscha-'))
  const jobPath = join(tmpDir, 'job.json')
  writeFileSync(jobPath, JSON.stringify(job), 'utf8')

  try {
    const script = join(root, 'gainscha-print.ps1')
    return await runPowerShell(['-File', script, '-JobJsonPath', jobPath])
  } finally {
    try { unlinkSync(jobPath) } catch { /* ignore */ }
  }
}

export function defaultLabelEngine(): 'gainscha' | 'html' {
  return isGainschaAvailable() ? 'gainscha' : 'html'
}

/** Dev-only helper */
export function gainschaPathsForDebug(): { root: string | null; dev: boolean } {
  return { root: resolveGainschaRoot(), dev: is.dev }
}

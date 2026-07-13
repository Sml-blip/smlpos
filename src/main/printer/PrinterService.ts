import { spawn } from 'child_process';
import { existsSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { BrowserWindow, ipcMain } from 'electron';
import { labels, printers } from 'label-printer';
import { Label40x20 } from './LabelTemplate';

// ─── Legacy/Hidden Window Types ──────────────────────────────────────────────
export type ElectronPageSize = string | { width: number; height: number };

export interface CustomPageSizeMm {
  widthMm: number;
  heightMm: number;
}

export interface PrintWindowOptions {
  printerName?: string;
  silent?: boolean;
  pageSize?: string | ElectronPageSize | CustomPageSizeMm;
  printBackground?: boolean;
  color?: boolean;
  copies?: number;
  scaleFactor?: number;
  dpi?: { horizontal: number; vertical: number };
}

export interface GainschaLabelElement {
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
  text?: string;
  value?: string;
  displayText?: string;
  format?: 'EAN13' | 'EAN8' | 'CODE128';
}

export interface GainschaPrintJob {
  connection: 'driver' | 'usb';
  printerName?: string;
  usbDevice?: string;
  widthMm: number;
  heightMm: number;
  stripLeftMm: number;
  stripRightMm: number;
  stripTopMm: number;
  stripBottomMm: number;
  rotationDeg: 0 | 180;
  dpi: number;
  copies: number;
  showBarcodeText: boolean;
  elements: {
    name: GainschaLabelElement;
    barcode: GainschaLabelElement;
    price: GainschaLabelElement;
  };
}

export interface GainschaScriptResult {
  success: boolean;
  error?: string;
  version?: string;
  devices?: string[];
}

export interface TsplPrintResult {
  success: boolean;
  error?: string;
  printer?: string;
}

interface TsplElementBox {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  visible?: boolean;
}

interface TsplLayout {
  name?: TsplElementBox;
  barcode?: TsplElementBox;
  price?: TsplElementBox;
  showBarcodeText?: boolean;
}

interface TsplLabelData {
  codeBarre: string;
  nomProduit: string;
  prix: string;
  copies: number;
  printerName: string;
  widthMm?: number;
  heightMm?: number;
  stripLeftMm?: number;
  stripRightMm?: number;
  stripTopMm?: number;
  stripBottomMm?: number;
  rotationDeg?: 0 | 180;
  layout?: TsplLayout;
  density?: number;
  speed?: number;
  gapMm?: number;
  bitmapBase64?: string;
  bitmapWidthDots?: number;
  bitmapHeightDots?: number;
  bitmapWidthBytes?: number;
}

// ─── Print a label from PNG blob bytes ───────────────────────────────────────
// labels.Image.create() requires a file path string, NOT a Buffer —
// write to a temp file, pass the path, then clean up in finally.
// printerName is passed from the UI (Windows printer name) as a display hint.
const printLabelFromPNG = async (pngBase64: string, copies: number, _printerName?: string) => {
  const T = Label40x20

  const pngBuffer = Buffer.from(pngBase64, 'base64')
  const tempImagePath = join(tmpdir(), `smlpos-label-${Date.now()}.png`)

  try {
    writeFileSync(tempImagePath, pngBuffer)

    const image = await labels.Image.create(tempImagePath, 0, 0, T.canvasW, T.canvasH)

    const label = new labels.Label(40, 19.9)
    label.add(image)

    const printersList = await printers.PrinterService.getPrinters()
    if (printersList.length === 0) {
      throw new Error(
        'Aucune imprimante TSPL accessible via USB.\n' +
        'Vérifiez que l\'imprimante est allumée et branchée en USB.\n' +
        'Si elle est installée via driver Windows (Seagull), le mode accès direct USB (WinUSB/Zadig) est requis par le mode Canvas Bitmap.'
      )
    }

    // label-printer auto-selects the USB printer; use first available
    const printer = printersList[0]
    await printer.print(label, copies, T.gapMm)
    await printer.close()
  } finally {
    try { unlinkSync(tempImagePath) } catch { /* ignore */ }
  }
}

const mmToDots = (mm: number, dpi = 203): number => Math.round((mm * dpi) / 25.4)

const escapeTsplText = (value: unknown): string =>
  String(value ?? '').replace(/"/g, "'").replace(/[\r\n]+/g, ' ').trim()

const isVisible = (box?: TsplElementBox): boolean => box?.visible !== false

const pickBarcodeFormat = (value: string): '128' | 'EAN13' | 'EAN8' => {
  if (/^\d{13}$/.test(value)) return 'EAN13'
  if (/^\d{8}$/.test(value)) return 'EAN8'
  return '128'
}

const estimateBarcodeModules = (value: string, format: '128' | 'EAN13' | 'EAN8'): number => {
  if (format === 'EAN13') return 95
  if (format === 'EAN8') return 67
  // CODE128: start + data + checksum + stop, with a small quiet-zone allowance.
  return 35 + Math.max(1, value.length) * 11 + 20
}

const pickTsplBarcodeWidth = (
  value: string,
  format: '128' | 'EAN13' | 'EAN8',
  boxWidthMm: number,
  dpi = 203,
): { narrow: number; wide: number; fits: boolean; modules: number; availableDots: number } => {
  const availableDots = Math.max(1, mmToDots(boxWidthMm, dpi) - 8)
  const modules = estimateBarcodeModules(value, format)
  const narrow = Math.max(1, Math.min(2, Math.floor(availableDots / modules)))
  return { narrow, wide: Math.max(2, narrow * 2), fits: modules <= availableDots, modules, availableDots }
}

const buildTSPL = (data: TsplLabelData): string => {
  const widthMm = Number(data.widthMm) || 40
  const heightMm = Number(data.heightMm) || 20
  const dpi = 203
  const contentLeft = Number(data.stripLeftMm) || 1
  const contentTop = Number(data.stripTopMm) || 0.35
  const layout = data.layout ?? {}
  const name = layout.name ?? { x: 11.5, y: 0.5, w: 25, h: 3, visible: true }
  const barcode = layout.barcode ?? { x: 0.6, y: 4.7, w: 37, h: 13.2, visible: true }
  const price = layout.price ?? { x: 0.6, y: 0.5, w: 10.5, h: 3, visible: true }
  const barcodeValue = escapeTsplText(data.codeBarre)
  const readable = layout.showBarcodeText === false ? 0 : 1
  const barcodeHeight = readable ? (barcode.h ?? 10) * 0.78 : (barcode.h ?? 10)
  const copies = Math.min(99, Math.max(1, Number(data.copies) || 1))
  const direction = data.rotationDeg === 180 ? 0 : 1
  const lines = [
    `SIZE ${widthMm} mm,${heightMm} mm`,
    'GAP 3 mm,0 mm',
    'CODEPAGE UTF-8',
    'DENSITY 12',
    'SPEED 2',
    `DIRECTION ${direction}`,
    'REFERENCE 0,0',
    'CLS',
  ]

  if (isVisible(name)) {
    lines.push(
      `TEXT ${mmToDots(contentLeft + (name.x ?? 0), dpi)},${mmToDots(contentTop + (name.y ?? 0), dpi)},"0",0,1,1,"${escapeTsplText(data.nomProduit)}"`,
    )
  }

  if (isVisible(price)) {
    lines.push(
      `TEXT ${mmToDots(contentLeft + (price.x ?? 0), dpi)},${mmToDots(contentTop + (price.y ?? 0), dpi)},"0",0,2,2,"${escapeTsplText(data.prix)}"`,
    )
  }

  if (isVisible(barcode) && barcodeValue) {
    const format = pickBarcodeFormat(barcodeValue)
    const widths = pickTsplBarcodeWidth(barcodeValue, format, Number(barcode.w) || 30, dpi)
    if (!widths.fits) {
      throw new Error(`Code-barres trop long pour une etiquette ${widthMm}x${heightMm} mm (${barcodeValue.length} caracteres). Utilisez un code plus court ou un vrai EAN.`)
    }
    lines.push(
      `BARCODE ${mmToDots(contentLeft + (barcode.x ?? 0), dpi)},${mmToDots(contentTop + (barcode.y ?? 0), dpi)},"${format}",${mmToDots(barcodeHeight, dpi)},${readable},0,${widths.narrow},${widths.wide},"${barcodeValue}"`,
    )
  }

  lines.push(`PRINT ${copies},1`)
  return `${lines.join('\r\n')}\r\n`
}

const buildTSPLBitmap = (data: TsplLabelData): Buffer => {
  const widthMm = Number(data.widthMm) || 40
  const heightMm = Number(data.heightMm) || 20
  const dpi = Math.min(600, Math.max(72, Math.round(Number(data.bitmapWidthDots) * 25.4 / widthMm) || 203))
  const widthDots = Math.max(1, Math.round(Number(data.bitmapWidthDots) || 0))
  const heightDots = Math.max(1, Math.round(Number(data.bitmapHeightDots) || 0))
  const widthBytes = Math.max(1, Math.round(Number(data.bitmapWidthBytes) || 0))
  const expectedWidthBytes = Math.ceil(widthDots / 8)
  const bitmap = Buffer.from(String(data.bitmapBase64 ?? ''), 'base64')
  const maxWidthDots = mmToDots(widthMm, dpi) + 1
  const maxHeightDots = mmToDots(heightMm, dpi) + 1

  if (!data.bitmapBase64 || widthBytes !== expectedWidthBytes || bitmap.length !== widthBytes * heightDots) {
    throw new Error('Le bitmap de l\'etiquette est incomplet ou invalide.')
  }
  if (widthDots > maxWidthDots || heightDots > maxHeightDots) {
    throw new Error(`Le bitmap ${widthDots}x${heightDots} depasse l'etiquette ${widthMm}x${heightMm} mm.`)
  }

  const density = Math.min(15, Math.max(1, Math.round(Number(data.density) || 9)))
  const speed = Math.min(8, Math.max(2, Math.round(Number(data.speed) || 2)))
  const gapMm = Math.min(10, Math.max(0, Number(data.gapMm) || 0))
  const copies = Math.min(99, Math.max(1, Number(data.copies) || 1))
  const prefix = Buffer.from([
    `SIZE ${widthMm} mm,${heightMm} mm`,
    `GAP ${gapMm} mm,0 mm`,
    `DENSITY ${density}`,
    `SPEED ${speed}`,
    'DIRECTION 1',
    'REFERENCE 0,0',
    'CLS',
    `BITMAP 0,0,${widthBytes},${heightDots},0,`,
  ].join('\r\n'), 'ascii')
  const suffix = Buffer.from(`\r\nPRINT ${copies},1\r\n`, 'ascii')
  return Buffer.concat([prefix, bitmap, suffix])
}

const sendTSPL = async (tspl: string | Buffer, printerName: string): Promise<void> => {
  const safePrinterName = printerName.trim()
  if (!safePrinterName) throw new Error('Veuillez selectionner une imprimante dans la liste.')

  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const dataPath = join(tmpdir(), `smlpos-label-${stamp}.tspl`)
  const psPath = join(tmpdir(), `smlpos-raw-print-${stamp}.ps1`)
  const script = `
param([string]$PrinterName, [string]$DataPath)
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);
}
"@
$bytes = [System.IO.File]::ReadAllBytes($DataPath)
$handle = [IntPtr]::Zero
if (-not [RawPrinterHelper]::OpenPrinter($PrinterName, [ref]$handle, [IntPtr]::Zero)) { throw "Impossible d'ouvrir l'imprimante: $PrinterName" }
try {
  $doc = New-Object RawPrinterHelper+DOCINFOA
  $doc.pDocName = "SMLPOS Label TSPL"
  $doc.pDataType = "RAW"
  if (-not [RawPrinterHelper]::StartDocPrinter($handle, 1, $doc)) { throw "StartDocPrinter a echoue" }
  try {
    if (-not [RawPrinterHelper]::StartPagePrinter($handle)) { throw "StartPagePrinter a echoue" }
    try {
      $written = 0
      if (-not [RawPrinterHelper]::WritePrinter($handle, $bytes, $bytes.Length, [ref]$written)) { throw "WritePrinter a echoue" }
      if ($written -ne $bytes.Length) { throw "Ecriture incomplete vers l'imprimante" }
    } finally {
      [void][RawPrinterHelper]::EndPagePrinter($handle)
    }
  } finally {
    [void][RawPrinterHelper]::EndDocPrinter($handle)
  }
} finally {
  [void][RawPrinterHelper]::ClosePrinter($handle)
}
`

  try {
    writeFileSync(dataPath, Buffer.isBuffer(tspl) ? tspl : Buffer.from(tspl, 'utf8'))
    writeFileSync(psPath, script, 'utf8')
    await new Promise<void>((resolve, reject) => {
      const child = spawn('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        psPath,
        '-PrinterName',
        safePrinterName,
        '-DataPath',
        dataPath,
      ], { windowsHide: true })
      let stderr = ''
      child.stderr.on('data', (chunk) => { stderr += String(chunk) })
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(stderr.trim() || `PowerShell raw print failed (${code})`))
      })
    })
  } finally {
    try { unlinkSync(dataPath) } catch { /* ignore */ }
    try { unlinkSync(psPath) } catch { /* ignore */ }
  }
}

export class PrinterService {
  // ─── Page Size Resolution ──────────────────────────────────────────────────
  static mmToMicrons(mm: number): number {
    return Math.round(mm * 1000);
  }

  static resolveElectronPageSize(
    pageSize?: string | ElectronPageSize | CustomPageSizeMm
  ): ElectronPageSize {
    if (!pageSize || pageSize === 'A4') return 'A4';
    if (typeof pageSize === 'object') {
      if ('widthMm' in pageSize && 'heightMm' in pageSize) {
        return {
          width: this.mmToMicrons(pageSize.widthMm),
          height: this.mmToMicrons(pageSize.heightMm),
        };
      }
      if ('width' in pageSize && 'height' in pageSize) return pageSize as ElectronPageSize;
    }
    if (pageSize === '58mm') return { width: 58000, height: 297000 };
    if (pageSize === '80mm') return { width: 80000, height: 297000 };
    if (pageSize === '40x20mm' || pageSize === 'label') return { width: 40000, height: 20000 };
    if (pageSize === 'Letter' || pageSize === 'Legal' || pageSize === 'Tabloid') return pageSize;
    if (typeof pageSize === 'string' && pageSize.endsWith('mm')) {
      const n = parseFloat(pageSize);
      if (Number.isFinite(n) && n > 0) return { width: Math.round(n * 1000), height: 297000 };
    }
    return 'A4';
  }

  // ─── A4 / Invoice HTML hidden window printing ──────────────────────────────
  static printHtmlInHiddenWindow(
    html: string,
    options: PrintWindowOptions = {}
  ): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      const win = new BrowserWindow({
        show: false,
        width: 900,
        height: 1200,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      });
      const tmpPath = join(tmpdir(), `smlpos-print-${Date.now()}.html`);
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        try {
          unlinkSync(tmpPath);
        } catch {
          /* ignore */
        }
        try {
          win.destroy();
        } catch {
          /* ignore */
        }
      };

      try {
        writeFileSync(tmpPath, html, 'utf8');
      } catch (e) {
        cleanup();
        resolve({ success: false, error: String(e) });
        return;
      }

      win.webContents.once('did-fail-load', () => {
        cleanup();
        resolve({ success: false, error: 'Échec chargement HTML impression' });
      });

      win.webContents.once('did-finish-load', () => {
        const printOpts: Electron.WebContentsPrintOptions = {
          deviceName: options.printerName || undefined,
          silent: options.silent === true,
          printBackground: options.printBackground !== false,
          color: options.color !== false,
          copies: typeof options.copies === 'number' ? options.copies : 1,
          pageSize: this.resolveElectronPageSize(options.pageSize),
        };
        if (typeof options.scaleFactor === 'number') {
          printOpts.scaleFactor = options.scaleFactor;
        }
        if (options.dpi) {
          (
            printOpts as Electron.WebContentsPrintOptions & {
              dpi?: { horizontal: number; vertical: number };
            }
          ).dpi = options.dpi;
        }
        win.webContents.print(printOpts, (success, failureReason) => {
          cleanup();
          resolve({ success, error: success ? undefined : failureReason });
        });
      });

      win.loadFile(tmpPath).catch((err) => {
        cleanup();
        resolve({ success: false, error: String(err) });
      });
    });
  }

  // ─── Deprecated / Stubbed Legacy Functions ─────────────────────────────────
  static isGainschaAvailable(): boolean {
    return false;
  }

  static async gainschaDetectUsb(): Promise<GainschaScriptResult> {
    return { success: false, error: 'SDK Gainscha déprécié au profit du mode Canvas Bitmap', devices: [] };
  }

  static async gainschaSdkVersion(): Promise<GainschaScriptResult> {
    return { success: false, error: 'SDK Gainscha déprécié' };
  }

  static async gainschaPrintLabel(_job: GainschaPrintJob): Promise<GainschaScriptResult> {
    return { success: false, error: 'SDK Gainscha déprécié' };
  }

  static async printTsplLabel(
    data: TsplLabelData,
    _getPrinters: () => Promise<{ name: string }[]>
  ): Promise<TsplPrintResult> {
    try {
      if (!data.printerName?.trim()) {
        return { success: false, error: 'Veuillez selectionner une imprimante dans la liste.' };
      }
      const tspl = data.bitmapBase64 ? buildTSPLBitmap(data) : buildTSPL(data);
      await sendTSPL(tspl, data.printerName);
      return { success: true, printer: data.printerName };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────
export const registerPrinterIPC = () => {
  // printerName comes from the Windows printer dropdown in the UI
  ipcMain.handle('printer:print', async (_, { pngBase64, copies, printerName }: {
    pngBase64:    string
    copies:       number
    printerName?: string
  }) => {
    try {
      await printLabelFromPNG(pngBase64, copies, printerName)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // Returns label-printer auto-detected USB TSPL printers
  ipcMain.handle('printer:list', async () => {
    try {
      const list = await printers.PrinterService.getPrinters()
      return list.map((p: any, i: number) => ({
        id:   i,
        name: (p as any).name ?? (p as any).deviceName ?? (p as any).description ?? `Imprimante USB ${i + 1}`,
      }))
    } catch {
      return []
    }
  })
}

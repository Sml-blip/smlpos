import { spawn, exec } from 'child_process';
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

// ─── Find Gainscha in connected USB devices ──────────────────────────────────
const getGainscha = async () => {
  // Auto-discover all connected TSPL printers (USB + network)
  const list = await printers.PrinterService.getPrinters()
  if (list.length === 0) throw new Error('Aucune imprimante trouvée — vérifier USB et alimentation')
  return list[0]
}

// ─── Print a label from PNG blob bytes ───────────────────────────────────────
const printLabelFromPNG = async (pngBase64: string, copies: number) => {
  const T = Label40x20

  // Decode base64 PNG → Buffer
  const pngBuffer = Buffer.from(pngBase64, 'base64')

  // label-printer handles: 1-bit conversion, TSPL BITMAP command, USB transport
  const image = await labels.Image.create(pngBuffer, 0, 0, T.canvasW, T.canvasH)

  // Label dimensions in mm (label-printer default unit = mm)
  const label = new labels.Label(40, 19.9)
  label.add(image)

  const printer = await getGainscha()
  await printer.print(label, copies, T.gapMm)
  await printer.close()
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
    _data: Record<string, unknown>,
    _getPrinters: () => Promise<{ name: string }[]>
  ): Promise<TsplPrintResult> {
    return { success: false, error: 'TSPL brut déprécié au profit du mode Canvas Bitmap' };
  }
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────
export const registerPrinterIPC = () => {
  ipcMain.handle('printer:print', async (_, { pngBase64, copies }: {
    pngBase64: string
    copies:    number
  }) => {
    try {
      await printLabelFromPNG(pngBase64, copies)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('printer:list', async () => {
    try {
      const list = await printers.PrinterService.getPrinters()
      return list.map((_p, i) => ({ id: i, name: `Printer ${i + 1}` }))
    } catch {
      return []
    }
  })
}

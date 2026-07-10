import { spawn, exec } from 'child_process';
import { existsSync, mkdtempSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { BrowserWindow } from 'electron';
import { configToTemplate, type LabelTemplateData } from './LabelTemplate';
import { TsplRenderer } from './TsplRenderer';

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

  // ─── Gainscha Windows driver/USB PowerShell SDK ────────────────────────────
  static resolveGainschaRoot(): string | null {
    const candidates = [
      join(process.resourcesPath, 'resources', 'gainscha'),
      join(process.resourcesPath, 'gainscha'),
      join(__dirname, '../../resources/gainscha'),
    ];
    for (const dir of candidates) {
      const script = join(dir, 'gainscha-print.ps1');
      const dll = join(dir, 'x64', 'GTSPL_SDK.dll');
      if (existsSync(script) && existsSync(dll)) return dir;
    }
    return null;
  }

  static runPowerShell(args: string[]): Promise<GainschaScriptResult> {
    return new Promise((resolve) => {
      const psArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args];
      const child = spawn('powershell.exe', psArgs, { windowsHide: true });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
      child.on('close', (code) => {
        const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? '';
        try {
          const parsed = JSON.parse(line) as GainschaScriptResult;
          if (!parsed.success && !parsed.error && stderr) parsed.error = stderr.trim();
          resolve(parsed);
        } catch {
          resolve({
            success: code === 0,
            error:
              stderr.trim() || stdout.trim() || `Script PowerShell échoué (code ${code ?? '?'})`,
          });
        }
      });
    });
  }

  static isGainschaAvailable(): boolean {
    return process.platform === 'win32' && this.resolveGainschaRoot() !== null;
  }

  static async gainschaDetectUsb(): Promise<GainschaScriptResult> {
    const root = this.resolveGainschaRoot();
    if (!root) return { success: false, error: 'SDK Gainscha non installé', devices: [] };
    const script = join(root, 'gainscha-print.ps1');
    return this.runPowerShell(['-File', script, '-Detect']);
  }

  static async gainschaSdkVersion(): Promise<GainschaScriptResult> {
    const root = this.resolveGainschaRoot();
    if (!root) return { success: false, error: 'SDK Gainscha non installé' };
    const script = join(root, 'gainscha-print.ps1');
    return this.runPowerShell(['-File', script, '-Version']);
  }

  static async gainschaPrintLabel(job: GainschaPrintJob): Promise<GainschaScriptResult> {
    if (process.platform !== 'win32') {
      return { success: false, error: 'SDK Gainscha disponible uniquement sur Windows' };
    }
    const root = this.resolveGainschaRoot();
    if (!root) {
      return { success: false, error: 'SDK Gainscha introuvable dans resources/gainscha' };
    }

    const tmpDir = mkdtempSync(join(tmpdir(), 'smlpos-gainscha-'));
    const jobPath = join(tmpDir, 'job.json');
    writeFileSync(jobPath, JSON.stringify(job), 'utf8');

    try {
      const script = join(root, 'gainscha-print.ps1');
      return await this.runPowerShell(['-File', script, '-JobJsonPath', jobPath]);
    } finally {
      try {
        unlinkSync(jobPath);
      } catch {
        /* ignore */
      }
    }
  }

  // ─── TSPL Raw Printing ─────────────────────────────────────────────────────
  static findGainschaPrinterName(printers: { name: string }[]): string | null {
    const match = printers.find((p) => {
      const n = p.name.toLowerCase();
      return n.includes('gainscha') || n.includes('gs-24') || n.includes('gs2408');
    });
    return match?.name ?? null;
  }

  static sendTsplRaw(tspl: string, printerName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tmp = join(tmpdir(), `smlpos_tspl_${Date.now()}.prn`);
      writeFileSync(tmp, tspl, 'latin1');
      const cmd = `COPY /B "${tmp}" "${printerName}"`;
      exec(cmd, { shell: 'cmd.exe', windowsHide: true }, (err, _stdout, stderr) => {
        try {
          unlinkSync(tmp);
        } catch {
          /* ignore */
        }
        if (err) reject(new Error(stderr?.trim() || err.message));
        else resolve();
      });
    });
  }

  static async printTsplLabel(
    data: {
      codeBarre: string;
      nomProduit: string;
      prix: string;
      copies?: number;
      printerName?: string;
      widthMm?: number;
      heightMm?: number;
      rotationDeg?: 0 | 180;
      layout?: {
        name: { x: number; y: number; w: number; h: number; visible: boolean };
        barcode: { x: number; y: number; w: number; h: number; visible: boolean };
        price: { x: number; y: number; w: number; h: number; visible: boolean };
        showBarcodeText: boolean;
      };
    },
    getPrinters: () => Promise<{ name: string }[]>
  ): Promise<TsplPrintResult> {
    if (process.platform !== 'win32') {
      return { success: false, error: 'TSPL raw disponible uniquement sur Windows' };
    }
    try {
      const printers = await getPrinters();
      const printer = data.printerName?.trim() || this.findGainschaPrinterName(printers);
      if (!printer) {
        return {
          success: false,
          error: 'Imprimante Gainscha introuvable — vérifiez connexion USB et driver Seagull',
        };
      }

      // Convert configured layout to template dots geometry or use default Compact40x20
      const rotationDeg = data.rotationDeg === 180 ? 180 : 0;
      const widthMm = data.widthMm ?? 40;
      const heightMm = data.heightMm ?? 20;

      const layout = data.layout ?? {
        name: { x: 10 / 8, y: 8 / 8, w: 300 / 8, h: 24 / 8, visible: true },
        barcode: { x: 10 / 8, y: 36 / 8, w: 300 / 8, h: 55 / 8, visible: true },
        price: { x: 10 / 8, y: 108 / 8, w: 300 / 8, h: 36 / 8, visible: true },
        showBarcodeText: false,
      };

      const template = configToTemplate({
        widthMm,
        heightMm,
        rotationDeg,
        layout,
      });

      const renderer = new TsplRenderer();
      const tspl = renderer.render(
        template,
        {
          nom: data.nomProduit,
          code: data.codeBarre,
          prix: data.prix,
        },
        data.copies ?? 1
      );

      await this.sendTsplRaw(tspl, printer);
      return { success: true, printer };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

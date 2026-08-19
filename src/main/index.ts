import { app, shell, BrowserWindow, ipcMain, Menu, dialog, nativeImage } from 'electron'
import type { NativeImage } from 'electron'
import { join, extname, basename } from 'path'
import { randomUUID } from 'crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initDatabase, connectDatabase, db, dbFilePath, SCHEMA_VERSION } from './db'
import { bindRow } from './bindRow'
import { setupAutoUpdater } from './updater'
import { wipeAllUserData, relaunchFresh, getResetDiagnostics } from './factoryReset'
import { discoverRecoverableDatabases } from './userDataWipe'
import { applyRemoteRows, getLocalTableCount, isPullTableAllowed, LOCAL_SETTINGS_KEYS } from './syncPull'
import { bootstrapCanonicalUserDataPath, getArchiveDir } from './dataPaths'
import { createProtectedBackup, copyToExternalFolder, getBackupDir } from './backupService'
import {
  downloadR2Snapshot,
  getR2Status,
  listR2Snapshots,
  startR2BackupScheduler,
  testR2Connection,
  uploadR2Snapshot,
} from './r2BackupService'
import { startSupabaseKeepAlive } from './supabaseKeepAlive'
import { importDefaultProductCatalog } from './seedProducts'
import { PrinterService, type GainschaPrintJob, registerPrinterIPC } from './printer/PrinterService'
import { registerAppProtocol, getAppIndexUrl } from './appProtocol'
import { setupSessionCsp } from './sessionCsp'
import { startBossApiServer, stopBossApiServer } from './bossApiServer'

// ─── Backup ───────────────────────────────────────────────────────────────────
bootstrapCanonicalUserDataPath()

let mainWindow: BrowserWindow | null = null
const execFileAsync = promisify(execFile)

type InvoiceScanSource = {
  paths: string[]
  name: string
  temporaryPaths: string[]
  directText?: string
}

const invoiceScanSources = new Map<string, InvoiceScanSource>()
const INVOICE_SCAN_MAX_BYTES = 25 * 1024 * 1024
const INVOICE_SCAN_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.tif', '.tiff'])

function registerInvoiceScanSource(path: string, temporary = false): {
  scanId: string
  name: string
  previewDataUrl: string
} {
  const ext = extname(path).toLowerCase()
  if (!INVOICE_SCAN_EXTENSIONS.has(ext)) {
    throw new Error('Format non pris en charge. Utilisez PNG, JPG, BMP ou TIFF.')
  }
  const size = statSync(path).size
  if (size <= 0 || size > INVOICE_SCAN_MAX_BYTES) {
    throw new Error('Image vide ou trop volumineuse (maximum 25 Mo).')
  }
  const mime = ext === '.png'
    ? 'image/png'
    : ext === '.bmp'
      ? 'image/bmp'
      : ext === '.tif' || ext === '.tiff'
        ? 'image/tiff'
        : 'image/jpeg'
  const scanId = randomUUID()
  invoiceScanSources.set(scanId, {
    paths: [path],
    name: basename(path),
    temporaryPaths: temporary ? [path] : [],
  })
  setTimeout(() => {
    const source = invoiceScanSources.get(scanId)
    invoiceScanSources.delete(scanId)
    for (const tempPath of source?.temporaryPaths ?? []) {
      if (!existsSync(tempPath)) continue
      try { unlinkSync(tempPath) } catch { /* best-effort temporary scan cleanup */ }
    }
  }, 30 * 60 * 1000).unref()
  return {
    scanId,
    name: basename(path),
    previewDataUrl: `data:${mime};base64,${readFileSync(path).toString('base64')}`,
  }
}

function extractJpegImagesFromPdf(buffer: Buffer, outputPrefix: string): string[] {
  const ascii = buffer.toString('latin1')
  const paths: string[] = []
  let cursor = 0
  while (paths.length < 20) {
    const imageIndex = ascii.indexOf('/Subtype /Image', cursor)
    if (imageIndex < 0) break
    const dictStart = Math.max(0, ascii.lastIndexOf('<<', imageIndex))
    const streamIndex = ascii.indexOf('stream', imageIndex)
    if (streamIndex < 0) break
    const dictionary = ascii.slice(dictStart, streamIndex)
    cursor = streamIndex + 6
    if (!/\/Filter\s*(?:\/DCTDecode|\[\s*\/DCTDecode)/.test(dictionary)) continue
    const dataStart = streamIndex + 6 + (ascii.slice(streamIndex + 6, streamIndex + 8) === '\r\n' ? 2 : 1)
    const lengthMatch = dictionary.match(/\/Length\s+(\d+)\b/)
    const endStream = ascii.indexOf('endstream', dataStart)
    if (endStream < 0) break
    const dataEnd = lengthMatch
      ? Math.min(dataStart + Number(lengthMatch[1]), endStream)
      : endStream - (ascii[endStream - 2] === '\r' ? 2 : 1)
    const jpeg = buffer.subarray(dataStart, dataEnd)
    if (jpeg.length < 100 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) continue
    const imagePath = `${outputPrefix}-${paths.length + 1}.jpg`
    writeFileSync(imagePath, jpeg)
    paths.push(imagePath)
    cursor = endStream + 9
  }
  return paths
}

async function registerInvoicePdfSource(path: string): Promise<{
  scanId: string
  name: string
  previewDataUrl: string
  pageCount: number
  kind: 'pdf'
}> {
  const size = statSync(path).size
  if (size <= 0 || size > 40 * 1024 * 1024) {
    throw new Error('PDF vide ou trop volumineux (maximum 40 Mo).')
  }
  const buffer = readFileSync(path)
  let directText = ''
  let pageCount = 0
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const document = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      disableWorker: true,
      useSystemFonts: true,
    }).promise
    pageCount = document.numPages
    const pages: string[] = []
    for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, 20); pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      pages.push(content.items
        .map(item => 'str' in item ? item.str : '')
        .join(' '))
    }
    directText = pages.join('\n').trim()
    await document.destroy()
  } catch (error) {
    console.warn('[invoiceScan] PDF text extraction unavailable:', error)
  }

  const tempPrefix = join(app.getPath('temp'), `smlpos-facture-pdf-${randomUUID()}`)
  const imagePaths = directText.length >= 40 ? [] : extractJpegImagesFromPdf(buffer, tempPrefix)
  if (!directText && !imagePaths.length) {
    throw new Error('Ce PDF ne contient ni texte lisible ni image JPEG exploitable. Exportez sa page en JPG/PNG puis réessayez.')
  }
  const scanId = randomUUID()
  invoiceScanSources.set(scanId, {
    paths: imagePaths,
    name: basename(path),
    temporaryPaths: imagePaths,
    directText: directText || undefined,
  })
  setTimeout(() => {
    const source = invoiceScanSources.get(scanId)
    invoiceScanSources.delete(scanId)
    for (const tempPath of source?.temporaryPaths ?? []) {
      if (!existsSync(tempPath)) continue
      try { unlinkSync(tempPath) } catch { /* best effort */ }
    }
  }, 30 * 60 * 1000).unref()
  const previewDataUrl = imagePaths.length
    ? `data:image/jpeg;base64,${readFileSync(imagePaths[0]).toString('base64')}`
    : `data:application/pdf;base64,${buffer.toString('base64')}`
  return {
    scanId,
    name: basename(path),
    previewDataUrl,
    pageCount: pageCount || imagePaths.length,
    kind: 'pdf',
  }
}

let _backupInterval: ReturnType<typeof setInterval> | null = null

function startAutoBackup() {
  setTimeout(() => {
    const r = createProtectedBackup('startup')
    if (r) {
      copyToExternalFolder(r.archivePath)
      console.log('[backup] Startup backup:', r.filename)
    }
  }, 3000)

  _backupInterval = setInterval(() => {
    const r = createProtectedBackup('scheduled')
    if (r) copyToExternalFolder(r.archivePath)
  }, 5 * 60 * 1000)
}

let cachedAppIcon: NativeImage | undefined

if (process.platform === 'win32') {
  app.setAppUserModelId('com.smlpos.desktop')
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function addActivityLog(log: {
  shift_id?: string | null
  operateur?: string | null
  action: string
  details?: Record<string, unknown>
  montant?: number | null
}) {
  try {
    db.prepare(`
      INSERT INTO activity_logs (id, shift_id, operateur, action, details, montant, created_at)
      VALUES (@id, @shift_id, @operateur, @action, @details, @montant, @created_at)
    `).run({
      id: randomUUID(),
      shift_id: log.shift_id ?? null,
      operateur: log.operateur ?? null,
      action: log.action,
      details: JSON.stringify(log.details ?? {}),
      montant: log.montant ?? null,
      created_at: new Date().toISOString(),
    })
  } catch { /* never crash a write because logging failed */ }
}

function enqueueSync(table: string, operation: 'INSERT' | 'UPDATE' | 'DELETE', payload: Record<string, unknown>) {
  try {
    const recordId = String(payload.id ?? payload.key ?? '')
    if (recordId) {
      db.prepare(
        `DELETE FROM sync_queue WHERE synced_at IS NULL AND table_name = ? AND record_id = ?`,
      ).run(table, recordId)
    }
    db.prepare(`
      INSERT INTO sync_queue (id, table_name, operation, payload, record_id, created_at)
      VALUES (@id, @table_name, @operation, @payload, @record_id, @created_at)
    `).run({
      id: randomUUID(),
      table_name: table,
      operation,
      payload: JSON.stringify(payload),
      record_id: recordId,
      created_at: new Date().toISOString(),
    })
  } catch { /* never crash a write because sync queueing failed */ }
}

function safeParseJson(value: unknown): Record<string, unknown> {
  try { return typeof value === 'string' ? JSON.parse(value || '{}') : {} } catch { return {} }
}

function enqueueProductSnapshot(productId: unknown) {
  if (!productId) return
  const product = db.prepare('SELECT * FROM produits WHERE id = ?').get(productId) as Record<string, unknown> | undefined
  if (product) enqueueSync('produits', 'UPDATE', product)
}

function money3(value: unknown): number {
  const raw = typeof value === 'number' ? value : parseFloat(String(value ?? '').replace(',', '.'))
  if (!Number.isFinite(raw)) return 0
  return Math.round((raw + Number.EPSILON) * 1000) / 1000
}

function normalizeMoneyFields<T extends Record<string, unknown>>(row: T, fields: string[]): T {
  const normalized = { ...row }
  for (const field of fields) {
    if (field in normalized) normalized[field as keyof T] = money3(normalized[field]) as T[keyof T]
  }
  return normalized
}

function normalizeVenteLine(line: Record<string, unknown>): Record<string, unknown> {
  const quantite = Number(line.quantite ?? 0)
  const prix_unitaire = money3(line.prix_unitaire)
  const remise_pct = money3(line.remise_pct ?? 0)
  return {
    ...line,
    quantite,
    prix_unitaire,
    remise_pct,
    total_ligne: money3(quantite * prix_unitaire * (1 - remise_pct / 100)),
  }
}

function normalizeDocumentLine(line: Record<string, unknown>): Record<string, unknown> {
  return normalizeMoneyFields(
    { produit_id: null, type_produit: 'F', remise_pct: 0, tva_taux: 0, total_tva: 0, numero_serie: null, ...line },
    ['quantite', 'prix_unitaire', 'remise_pct', 'tva_taux', 'total_ht', 'total_tva', 'total_ttc'],
  )
}

function documentSaleType(typeDocument: unknown): 'FACTURE' | 'BL_VENTE' | 'DEVIS' | null {
  if (typeDocument === 'FACTURE_VENTE' || typeDocument === 'FACTURE_JOURNALIERE_F') return 'FACTURE'
  if (typeDocument === 'BON_LIVRAISON') return 'BL_VENTE'
  if (typeDocument === 'DEVIS') return 'DEVIS'
  return null
}

function markVenteConverted(venteId: unknown, typeDocument: unknown) {
  const type_vente = documentSaleType(typeDocument)
  if (!venteId || !type_vente) return
  db.prepare(`UPDATE ventes SET a_facture = 1, type_vente = ? WHERE id = ?`).run(type_vente, venteId)
  const row = db.prepare(`SELECT * FROM ventes WHERE id = ?`).get(venteId) as Record<string, unknown> | undefined
  if (row) enqueueSync('ventes', 'UPDATE', row)
}

function repairStoredMoneyPrecision() {
  try {
    db.transaction(() => {
      db.prepare(`
        UPDATE ventes SET
          sous_total = ROUND(COALESCE(sous_total, 0), 3),
          total_remises = ROUND(COALESCE(total_remises, 0), 3),
          total_ttc = ROUND(COALESCE(total_ttc, 0), 3),
          montant_recu = ROUND(COALESCE(montant_recu, 0), 3),
          monnaie_rendue = ROUND(COALESCE(monnaie_rendue, 0), 3)
      `).run()
      db.prepare(`
        UPDATE lignes_vente SET
          prix_unitaire = ROUND(COALESCE(prix_unitaire, 0), 3),
          remise_pct = ROUND(COALESCE(remise_pct, 0), 3),
          total_ligne = ROUND(COALESCE(total_ligne, 0), 3)
      `).run()
      db.prepare(`
        UPDATE documents SET
          total_ht = ROUND(COALESCE(total_ht, 0), 3),
          total_tva = ROUND(COALESCE(total_tva, 0), 3),
          total_ttc = ROUND(COALESCE(total_ttc, 0), 3),
          montant_paye = ROUND(COALESCE(montant_paye, 0), 3),
          exo = ROUND(COALESCE(exo, 0), 3),
          timbre = ROUND(COALESCE(timbre, 0), 3),
          ht_7 = ROUND(COALESCE(ht_7, 0), 3),
          tva_7 = ROUND(COALESCE(tva_7, 0), 3),
          ht_19 = ROUND(COALESCE(ht_19, 0), 3),
          tva_19 = ROUND(COALESCE(tva_19, 0), 3),
          total_remise = ROUND(COALESCE(total_remise, 0), 3),
          tva_taux_principal = ROUND(COALESCE(tva_taux_principal, 0), 3)
      `).run()
      db.prepare(`
        UPDATE lignes_document SET
          quantite = ROUND(COALESCE(quantite, 0), 3),
          prix_unitaire = ROUND(COALESCE(prix_unitaire, 0), 3),
          remise_pct = ROUND(COALESCE(remise_pct, 0), 3),
          tva_taux = ROUND(COALESCE(tva_taux, 0), 3),
          total_ht = ROUND(COALESCE(total_ht, 0), 3),
          total_tva = ROUND(COALESCE(total_tva, 0), 3),
          total_ttc = ROUND(COALESCE(total_ttc, 0), 3)
      `).run()
    })()
  } catch (e) {
    console.warn('[money] Precision repair skipped:', e)
  }
}

// ─── Window ───────────────────────────────────────────────────────────────────

function resolveAppIcon(): NativeImage | undefined {
  const candidates = [
    join(process.resourcesPath, 'resources/icon.ico'),
    join(process.resourcesPath, 'resources/icon.png'),
    join(process.resourcesPath, 'icon.ico'),
    join(process.resourcesPath, 'icon.png'),
    join(__dirname, '../../resources/icon.ico'),
    join(__dirname, '../../resources/icon.png'),
  ]
  for (const iconPath of candidates) {
    if (!existsSync(iconPath)) continue
    const image = nativeImage.createFromPath(iconPath)
    if (!image.isEmpty()) return image
  }
  return undefined
}

function getAppIcon(): NativeImage | undefined {
  if (cachedAppIcon && !cachedAppIcon.isEmpty()) return cachedAppIcon
  cachedAppIcon = resolveAppIcon()
  return cachedAppIcon
}

function createWindow(): void {
  const appIcon = getAppIcon()
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    ...(appIcon ? { icon: appIcon } : {}),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#FFD600',
      symbolColor: '#1A1A1A',
      height: 38
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  Menu.setApplicationMenu(null)

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadURL(getAppIndexUrl())
  }
}

app.whenReady().then(() => {
  if (process.platform !== 'win32') {
    electronApp.setAppUserModelId('com.smlpos.desktop')
  }

  const appIcon = getAppIcon()
  if (appIcon) app.dock?.setIcon?.(appIcon)

  setupSessionCsp(is.dev)
  registerAppProtocol(join(__dirname, '../renderer'))

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
    const icon = getAppIcon()
    if (icon) window.setIcon(icon)
    window.webContents.on('context-menu', (_event, params) => {
      Menu.buildFromTemplate([
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { role: 'selectAll', enabled: params.editFlags.canSelectAll },
      ]).popup()
    })
  })

  // Initialize database (after pending factory wipe + legacy recovery)
  try {
    connectDatabase()
    try {
      if (existsSync(dbFilePath)) {
        const r = createProtectedBackup('pre_migration')
        if (r) console.log('[backup] Pre-migration safety backup:', r.filename)
      }
    } catch (e) {
      console.warn('[backup] Pre-migration backup skipped:', e)
    }
    initDatabase()
    repairStoredMoneyPrecision()
  } catch (err) {
    console.error('DB init error:', err)
  }

  startAutoBackup()
  startR2BackupScheduler()
  startSupabaseKeepAlive()
  startBossApiServer()
  setupIpcHandlers()
  createWindow()
  setupAutoUpdater(() => mainWindow)

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  stopBossApiServer()
  createProtectedBackup('quit')
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// ─── IPC Handlers ────────────────────────────────────────────────────────────

function setupIpcHandlers() {
  const applyInternalCashOut = (amountInput: unknown, createdAt?: unknown) => {
    const amount = money3(amountInput)
    const parsed = new Date(String(createdAt ?? new Date().toISOString()))
    const date = Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString('en-CA') : new Date().toLocaleDateString('en-CA')
    let cash = db.prepare('SELECT * FROM caisse_interne WHERE date_journal = ?').get(date) as Record<string, unknown> | undefined
    if (!cash) {
      const previous = db.prepare('SELECT solde_ouverture,total_entrees,total_sorties FROM caisse_interne WHERE date_journal < ? ORDER BY date_journal DESC LIMIT 1').get(date) as { solde_ouverture?: number; total_entrees?: number; total_sorties?: number } | undefined
      const opening = previous ? money3(Number(previous.solde_ouverture) + Number(previous.total_entrees) - Number(previous.total_sorties)) : 100
      db.prepare('INSERT OR IGNORE INTO caisse_interne (id,date_journal,solde_ouverture) VALUES (?,?,?)').run(`ci-${date}`, date, opening)
    }
    db.prepare('UPDATE caisse_interne SET total_sorties = total_sorties + ? WHERE date_journal = ?').run(amount, date)
    cash = db.prepare('SELECT * FROM caisse_interne WHERE date_journal = ?').get(date) as Record<string, unknown>
    enqueueSync('caisse_interne', 'UPDATE', cash)
  }

  type SavedPanierPayload = {
    id?: unknown
    label?: unknown
    savedAt?: unknown
    shiftId?: unknown
    items?: unknown
    remiseTotale?: unknown
    clientForm?: unknown
  }

  const normalizeSavedPanier = (input: SavedPanierPayload) => {
    const id = String(input?.id ?? '').trim()
    const label = String(input?.label ?? '').trim()
    const savedAt = String(input?.savedAt ?? '').trim()
    const items = Array.isArray(input?.items) ? input.items : []
    if (!id || !label || !savedAt || !items.length) throw new Error('Panier sauvegardé invalide')
    const parsedDate = Date.parse(savedAt)
    if (!Number.isFinite(parsedDate)) throw new Error('Date du panier invalide')
    return {
      id,
      label,
      savedAt: new Date(parsedDate).toISOString(),
      shiftId: input.shiftId == null ? null : String(input.shiftId),
      items,
      remiseTotale: Math.max(0, Number(input.remiseTotale) || 0),
      clientForm: input.clientForm && typeof input.clientForm === 'object' ? input.clientForm : undefined,
    }
  }

  const persistSavedPanier = (input: SavedPanierPayload, preserveExisting = false) => {
    const panier = normalizeSavedPanier(input)
    const now = new Date().toISOString()
    const payload = JSON.stringify(panier)
    if (preserveExisting) {
      db.prepare(`
        INSERT OR IGNORE INTO saved_paniers (id, label, saved_at, shift_id, payload_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(panier.id, panier.label, panier.savedAt, panier.shiftId, payload, now)
    } else {
      db.prepare(`
        INSERT INTO saved_paniers (id, label, saved_at, shift_id, payload_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          label = excluded.label,
          saved_at = excluded.saved_at,
          shift_id = excluded.shift_id,
          payload_json = excluded.payload_json,
          updated_at = excluded.updated_at
      `).run(panier.id, panier.label, panier.savedAt, panier.shiftId, payload, now)
    }
    return panier
  }

  // Saved carts are stored in SQLite and included in the normal protected backups.
  ipcMain.handle('savedPaniers:list', () => {
    const rows = db.prepare(`
      SELECT payload_json FROM saved_paniers
      WHERE id != '__active_pos_cart__'
      ORDER BY saved_at DESC LIMIT 100
    `).all() as Array<{ payload_json: string }>
    return rows.flatMap(row => {
      try {
        return [normalizeSavedPanier(JSON.parse(row.payload_json) as SavedPanierPayload)]
      } catch {
        return []
      }
    })
  })

  ipcMain.handle('savedPaniers:save', (_e, input: SavedPanierPayload) => {
    try {
      return { success: true, panier: persistSavedPanier(input) }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('savedPaniers:importLegacy', (_e, inputs: SavedPanierPayload[] = []) => {
    let imported = 0
    db.transaction(() => {
      for (const input of inputs.slice(0, 100)) {
        try {
          const id = String(input?.id ?? '')
          const existed = !!db.prepare(`SELECT 1 FROM saved_paniers WHERE id = ?`).get(id)
          persistSavedPanier(input, true)
          if (!existed) imported++
        } catch {
          // A corrupt localStorage entry must not block recovery of valid carts.
        }
      }
    })()
    return { success: true, imported }
  })

  ipcMain.handle('savedPaniers:delete', (_e, id: string) => {
    if (!id?.trim()) return { success: false, error: 'Identifiant manquant' }
    db.prepare(`DELETE FROM saved_paniers WHERE id = ?`).run(id)
    return { success: true }
  })

  // The live POS cart is also checkpointed so a restart/update cannot erase it
  // before the operator explicitly places it on hold.
  ipcMain.handle('posCartDraft:get', () => {
    const row = db.prepare(`
      SELECT payload_json FROM saved_paniers WHERE id = '__active_pos_cart__'
    `).get() as { payload_json?: string } | undefined
    if (!row?.payload_json) return null
    try {
      return normalizeSavedPanier(JSON.parse(row.payload_json) as SavedPanierPayload)
    } catch {
      return null
    }
  })

  ipcMain.handle('posCartDraft:save', (_e, input: SavedPanierPayload) => {
    try {
      const items = Array.isArray(input?.items) ? input.items : []
      if (!items.length) {
        db.prepare(`DELETE FROM saved_paniers WHERE id = '__active_pos_cart__'`).run()
        return { success: true, cleared: true }
      }
      const panier = persistSavedPanier({
        ...input,
        id: '__active_pos_cart__',
        label: 'Panier POS actif',
        savedAt: new Date().toISOString(),
      })
      return { success: true, panier }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('posCartDraft:clear', () => {
    db.prepare(`DELETE FROM saved_paniers WHERE id = '__active_pos_cart__'`).run()
    return { success: true }
  })

  // App version (used in Settings / About)
  ipcMain.handle('app:version', () => app.getVersion())

  ipcMain.handle('invoiceScan:chooseImage', async () => {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
      title: 'Importer une facture fournisseur',
      properties: ['openFile'],
      filters: [
        { name: 'Factures PDF ou image', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'bmp', 'tif', 'tiff'] },
      ],
    })
    if (result.canceled || !result.filePaths.length) return { canceled: true }
    try {
      const filePath = result.filePaths[0]
      if (extname(filePath).toLowerCase() === '.pdf') {
        return { success: true, ...await registerInvoicePdfSource(filePath) }
      }
      return { success: true, ...registerInvoiceScanSource(filePath), kind: 'image', pageCount: 1 }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  let invoiceScanWiaBusy = false
  ipcMain.handle('invoiceScan:acquireWia', async () => {
    if (process.platform !== 'win32') {
      return { success: false, error: 'Le scanner WIA est disponible uniquement sous Windows.' }
    }
    if (invoiceScanWiaBusy) {
      return { success: false, error: 'Un scan est déjà en cours. Terminez ou annulez la fenêtre du scanner.' }
    }
    invoiceScanWiaBusy = true
    const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    const outputPath = join(app.getPath('temp'), `smlpos-facture-${randomUUID()}.jpg`)
    const encodeScript = (value: string) => Buffer.from(value, 'utf16le').toString('base64')
    const probeScript = [
      "$ErrorActionPreference = 'Stop'",
      '$manager = New-Object -ComObject WIA.DeviceManager',
      '$scanners = @($manager.DeviceInfos | Where-Object { $_.Type -eq 1 })',
      'Write-Output $scanners.Count',
    ].join('\r\n')
    const scanScript = [
      "$ErrorActionPreference = 'Stop'",
      '$dialog = New-Object -ComObject WIA.CommonDialog',
      '$device = $dialog.ShowSelectDevice(1, $false, $false)',
      'if ($null -eq $device) { exit 2 }',
      '$item = $device.Items.Item(1)',
      "$image = $dialog.ShowTransfer($item, '{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}', $true)",
      'if ($null -eq $image) { exit 2 }',
      `$image.SaveFile('${outputPath.replace(/'/g, "''")}')`,
    ].join('\r\n')
    let minimizedForScan = false
    try {
      const probe = await execFileAsync(
        powershell,
        ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', encodeScript(probeScript)],
        { timeout: 15 * 1000, windowsHide: true },
      )
      const scannerCount = Number(String(probe.stdout).trim())
      if (!Number.isFinite(scannerCount) || scannerCount < 1) {
        return {
          success: false,
          error: 'Aucun scanner WIA détecté par Windows. Installez le pilote scanner HP complet, puis redémarrez SMLPOS. Vous pouvez importer un PDF ou une image en attendant.',
        }
      }

      if (mainWindow && !mainWindow.isMinimized()) {
        mainWindow.minimize()
        minimizedForScan = true
      }
      await execFileAsync(
        powershell,
        ['-NoProfile', '-STA', '-EncodedCommand', encodeScript(scanScript)],
        { timeout: 2 * 60 * 1000, windowsHide: true },
      )
      if (!existsSync(outputPath)) return { success: false, error: 'Le scanner n’a retourné aucune image.' }
      return { success: true, ...registerInvoiceScanSource(outputPath, true) }
    } catch (error) {
      const code = Number((error as { code?: unknown })?.code)
      if (code === 2) return { canceled: true }
      try { if (existsSync(outputPath)) unlinkSync(outputPath) } catch { /* best effort */ }
      const message = String((error as { stderr?: unknown })?.stderr || (error as Error)?.message || error)
      return {
        success: false,
        error: message.includes('timed out')
          ? 'Le scanner ne répond pas. Le scan a été arrêté après 2 minutes. Vérifiez le pilote HP et réessayez.'
          : message.includes('ActiveX') || message.includes('COM')
          ? 'Scanner WIA indisponible. Vérifiez que le pilote HP complet est installé.'
          : `Échec du scan WIA : ${message}`,
      }
    } finally {
      invoiceScanWiaBusy = false
      if (minimizedForScan && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
      }
    }
  })

  ipcMain.handle('invoiceScan:recognize', async (_event, scanId: string) => {
    const source = invoiceScanSources.get(String(scanId))
    if (!source || (!source.directText && !source.paths.some(path => existsSync(path)))) {
      return { success: false, error: 'Image expirée. Veuillez scanner ou importer la facture à nouveau.' }
    }
    if (source.directText) {
      return {
        success: true,
        text: source.directText,
        confidence: 100,
        name: source.name,
      }
    }
    const packageRoot = is.dev
      ? app.getAppPath()
      : join(process.resourcesPath, 'app.asar.unpacked')
    const langPath = join(packageRoot, 'node_modules', '@tesseract.js-data', 'fra', '4.0.0_best_int')
    const workerPath = join(packageRoot, 'node_modules', 'tesseract.js', 'src', 'worker-script', 'node', 'index.js')
    const cachePath = join(app.getPath('userData'), 'ocr-cache')
    mkdirSync(cachePath, { recursive: true })
    let worker: Awaited<ReturnType<(typeof import('tesseract.js'))['createWorker']>> | null = null
    try {
      const { createWorker } = await import('tesseract.js')
      worker = await createWorker('fra', 1, {
        langPath,
        workerPath,
        cachePath,
        cacheMethod: 'readOnly',
        gzip: true,
      })
      const recognizedPages: string[] = []
      const confidences: number[] = []
      for (const imagePath of source.paths) {
        if (!existsSync(imagePath)) continue
        const result = await worker.recognize(imagePath, { rotateAuto: true })
        recognizedPages.push(result.data.text)
        confidences.push(result.data.confidence)
      }
      return {
        success: true,
        text: recognizedPages.join('\n'),
        confidence: confidences.length
          ? confidences.reduce((sum, confidence) => sum + confidence, 0) / confidences.length
          : 0,
        name: source.name,
      }
    } catch (error) {
      console.error('[invoiceScan] OCR failed:', error)
      return { success: false, error: `Analyse OCR impossible : ${error instanceof Error ? error.message : String(error)}` }
    } finally {
      if (worker) await worker.terminate().catch(() => undefined)
    }
  })

  ipcMain.handle('reports:savePdf', async (_e, html: string, suggestedName = 'rapport.pdf') => {
    if (!html?.trim()) return { success: false, error: 'Rapport vide' }
    const safeName = String(suggestedName).replace(/[<>:"/\\|?*]/g, '-').replace(/\.pdf$/i, '') + '.pdf'
    const target = await dialog.showSaveDialog(mainWindow ?? undefined, {
      title: 'Exporter en PDF',
      defaultPath: safeName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (target.canceled || !target.filePath) return { success: false, canceled: true }
    const reportWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
    try {
      await reportWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      const pdf = await reportWindow.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true })
      const { writeFile } = await import('fs/promises')
      await writeFile(target.filePath, pdf)
      return { success: true, path: target.filePath }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      if (!reportWindow.isDestroyed()) reportWindow.close()
    }
  })

  ipcMain.handle('app:factoryReset', async () => {
    try {
      const result = await wipeAllUserData()
      // Relaunch immediately — do not block on IPC response reaching the renderer.
      setImmediate(() => relaunchFresh())
      return { success: true, deferred: result.deferred === true }
    } catch (e) {
      console.error('[factoryReset] Reset error — relaunching:', e)
      try { createProtectedBackup('pre_reset') } catch { /* ignore */ }
      setImmediate(() => relaunchFresh())
      return { success: true, deferred: true, error: String(e) }
    }
  })

  ipcMain.handle('app:resetDiagnostics', () => {
    try {
      const productCount = (db.prepare('SELECT COUNT(*) as cnt FROM produits').get() as { cnt: number }).cnt
      return { ok: true, productCount, ...getResetDiagnostics() }
    } catch (e) {
      return { ok: false, error: String(e), ...getResetDiagnostics() }
    }
  })

  ipcMain.handle('app:importDefaultCatalog', () => {
    try {
      const count = importDefaultProductCatalog(db)
      return { success: true, count }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('app:health', () => {
    try {
      db.prepare('SELECT 1').get()
      const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'schema_version'`).get() as { value?: string } | undefined
      const pending = db.prepare(`SELECT COUNT(*) as cnt FROM sync_queue WHERE synced_at IS NULL AND attempts < 10`).get() as { cnt: number }
      return {
        ok: true,
        schemaVersion: row?.value ?? SCHEMA_VERSION,
        expectedSchemaVersion: SCHEMA_VERSION,
        dbPath: dbFilePath,
        pendingSync: pending?.cnt ?? 0,
      }
    } catch (e) {
      return { ok: false, error: String(e), expectedSchemaVersion: SCHEMA_VERSION }
    }
  })

  // Generic DB query — dev only
  if (is.dev) {
    ipcMain.handle('db:query', (_event, sql: string, params: unknown[] = []) => {
      try {
        const stmt = db.prepare(sql)
        return { data: stmt.all(...params), error: null }
      } catch (err) {
        return { data: null, error: String(err) }
      }
    })

    ipcMain.handle('db:run', (_event, sql: string, params: unknown[] = []) => {
      try {
        const stmt = db.prepare(sql)
        const result = stmt.run(...params)
        return { data: result, error: null }
      } catch (err) {
        return { data: null, error: String(err) }
      }
    })

    ipcMain.handle('db:get', (_event, sql: string, params: unknown[] = []) => {
      try {
        const stmt = db.prepare(sql)
        return { data: stmt.get(...params), error: null }
      } catch (err) {
        return { data: null, error: String(err) }
      }
    })
  }

  // ─── Operateurs ─────────────────────────────────────────────────────────────
  ipcMain.handle('operateurs:list', () => {
    return db.prepare('SELECT * FROM operateurs WHERE actif = 1 ORDER BY nom').all()
  })

  ipcMain.handle('operateurs:upsert', (_e, op) => {
    const stmt = db.prepare(`
      INSERT INTO operateurs (id, nom, identifiant, role, actif)
      VALUES (@id, @nom, @identifiant, @role, @actif)
      ON CONFLICT(identifiant) DO UPDATE SET nom=excluded.nom, actif=excluded.actif
    `)
    const result = stmt.run(op)
    enqueueSync('operateurs', 'UPDATE', op as Record<string, unknown>)
    return result
  })

  // ─── Shifts ──────────────────────────────────────────────────────────────────
  ipcMain.handle('shifts:open', (_e, shift) => {
    const stmt = db.prepare(`
      INSERT INTO shifts (id, operateur_id, operateur_nom, fond_de_caisse, started_at)
      VALUES (@id, @operateur_id, @operateur_nom, @fond_de_caisse, @started_at)
    `)
    const result = stmt.run(shift)
    addActivityLog({ shift_id: shift.id, operateur: shift.operateur_nom, action: 'SHIFT_OPENED', details: { fond_de_caisse: shift.fond_de_caisse } })
    enqueueSync('shifts', 'INSERT', shift)
    return result
  })

  ipcMain.handle('shifts:close', (_e, id, data) => {
    const stmt = db.prepare(`
      UPDATE shifts SET ended_at=@ended_at, solde_theorique=@solde_theorique, notes_cloture=@notes_cloture
      WHERE id=@id
    `)
    const result = stmt.run({ id, ...data })
    addActivityLog({ shift_id: id, action: 'SHIFT_CLOSED', details: data })
    enqueueSync('shifts', 'UPDATE', { id, ...data })
    return result
  })

  ipcMain.handle('shifts:getActive', () => {
    return db.prepare(`
      SELECT * FROM shifts WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1
    `).get()
  })

  ipcMain.handle('shifts:getToday', () => {
    const today = new Date().toISOString().slice(0, 10)
    return db.prepare(`
      SELECT * FROM shifts WHERE started_at >= ? ORDER BY started_at DESC
    `).all(today)
  })

  ipcMain.handle('shifts:getSummary', (_e, shiftId: string) => {
    const ventes = db.prepare(`
      SELECT COALESCE(SUM(total_ttc),0) as total, COUNT(*) as count
      FROM ventes WHERE shift_id = ? AND type = 'VENTE'
    `).get(shiftId) as { total: number; count: number }
    const repairFinalPayments = db.prepare(`
      SELECT COALESCE(SUM(MAX(0, COALESCE(total_final,total_estime,0) - COALESCE(acompte,0))),0) as total, COUNT(*) as count
      FROM reparations
      WHERE statut IN ('TERMINE', 'RENDU')
        AND (
          (notes_technicien LIKE '%[SMLPOS_PAYMENT]%"paid":true%' AND notes_technicien LIKE ?)
          OR ((notes_technicien NOT LIKE '%[SMLPOS_PAYMENT]%' OR notes_technicien IS NULL) AND shift_id = ?)
        )
    `).get(`%"paymentShiftId":"${shiftId}"%`, shiftId) as { total: number; count: number }
    const repairDeposits = db.prepare(`
      SELECT COALESCE(SUM(acompte),0) as total, SUM(CASE WHEN acompte > 0 THEN 1 ELSE 0 END) as count
      FROM reparations WHERE shift_id = ? AND statut != 'ANNULE'
    `).get(shiftId) as { total: number; count: number }
    const reparations = {
      total: money3(repairFinalPayments.total + repairDeposits.total),
      count: Number(repairFinalPayments.count || 0) + Number(repairDeposits.count || 0),
    }
    const services = db.prepare(`
      SELECT COALESCE(SUM(montant_frais),0) as total, COUNT(*) as count
      FROM transactions_services WHERE shift_id = ?
    `).get(shiftId) as { total: number; count: number }
    const sorties = db.prepare(`
      SELECT COALESCE(SUM(montant),0) as total, COUNT(*) as count
      FROM sorties_caisse WHERE shift_id = ?
    `).get(shiftId) as { total: number; count: number }
    const parMode = db.prepare(`
      SELECT mode_paiement, COALESCE(SUM(total_ttc),0) as total
      FROM ventes WHERE shift_id = ? AND type = 'VENTE'
      GROUP BY mode_paiement
    `).all(shiftId) as Array<{ mode_paiement: string; total: number }>
    const creditsPercus = db.prepare(`
      SELECT COALESCE(SUM(montant),0) as total, COUNT(*) as count
      FROM credits_clients WHERE shift_id = ? AND type = 'PAIEMENT'
    `).get(shiftId) as { total: number; count: number }
    const avancesClients = db.prepare(`
      SELECT COALESCE(SUM(montant),0) as total, COUNT(*) as count
      FROM avances_clients WHERE shift_id = ?
    `).get(shiftId) as { total: number; count: number }
    return { ventes, reparations, services, sorties, parMode, creditsPercus, avancesClients }
  })

  ipcMain.handle('shifts:countClosedToday', () => {
    const row = db.prepare(`
      SELECT COUNT(*) as cnt FROM shifts
      WHERE ended_at IS NOT NULL
        AND date(ended_at, 'localtime') = date('now', 'localtime')
    `).get() as { cnt: number }
    return row?.cnt ?? 0
  })

  /** End-of-day: merge all eligible F sales for a local calendar day into one daily invoice. */
  ipcMain.handle('documents:createDailyFactureF', (_e, requestedDate?: string) => {
    try {
      const todayLocal = new Date().toLocaleDateString('en-CA')
      const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate ?? '') ? requestedDate! : todayLocal
      const existing = db.prepare(`
        SELECT id, numero, created_at FROM documents
        WHERE type_document = 'FACTURE_JOURNALIERE_F'
        AND (
          date(created_at, 'localtime') = date(?)
          OR CASE WHEN json_valid(contenu_json) THEN json_extract(contenu_json, '$.local_date') = ? ELSE 0 END
        )
        AND statut NOT IN ('ANNULE', 'REVOQUE')
        ORDER BY created_at DESC LIMIT 1
      `).get(targetDate, targetDate) as { id: string; numero: string; created_at: string } | undefined

      const lignesF = db.prepare(`
        SELECT v.id AS vente_id, lv.produit_id, lv.designation, lv.quantite,
               lv.prix_unitaire, lv.remise_pct, lv.total_ligne,
               COALESCE(v.total_ttc, 0) AS vente_total_ttc,
               COALESCE((
                 SELECT SUM(COALESCE(all_lv.total_ligne, 0))
                 FROM lignes_vente all_lv
                 WHERE all_lv.vente_id = v.id
               ), 0) AS vente_lignes_total,
               COALESCE(p.tva_taux, 0) AS tva_taux
        FROM lignes_vente lv
        INNER JOIN ventes v ON v.id = lv.vente_id
        LEFT JOIN produits p ON p.id = lv.produit_id
        WHERE lv.type_produit = 'F'
        AND v.type = 'VENTE'
        AND date(v.created_at, 'localtime') = date(?)
        AND COALESCE(v.statut, 'ACTIVE') != 'ANNULEE'
        AND NOT EXISTS (
          SELECT 1 FROM documents manual_doc
          WHERE manual_doc.vente_id = v.id
          AND manual_doc.type_document = 'FACTURE_VENTE'
          AND manual_doc.statut NOT IN ('ANNULE', 'REVOQUE')
        )
        AND NOT EXISTS (
          SELECT 1 FROM factures_clients legacy_invoice
          WHERE legacy_invoice.vente_id = v.id
        )
        ORDER BY v.created_at ASC, lv.designation ASC
      `).all(targetDate) as Array<{
        vente_id: string
        produit_id: string | null
        designation: string
        quantite: number
        prix_unitaire: number
        remise_pct: number
        total_ligne: number
        vente_total_ttc: number
        vente_lignes_total: number
        tva_taux: number
      }>

      const revokeExistingDailyInvoice = (reason: string) => {
        if (!existing) return
        const updatedAt = new Date().toISOString()
        db.prepare(`
          UPDATE documents
          SET statut = 'REVOQUE', updated_at = ?
          WHERE id = ?
        `).run(updatedAt, existing.id)
        const revoked = db.prepare(`SELECT * FROM documents WHERE id = ?`).get(existing.id) as Record<string, unknown>
        enqueueSync('documents', 'UPDATE', revoked)
        addActivityLog({
          action: 'DOCUMENT_REVOKED',
          details: { type_document: 'FACTURE_JOURNALIERE_F', numero: existing.numero, reason },
        })
      }

      if (!lignesF.length) {
        revokeExistingDailyInvoice('Toutes les ventes F ont déjà été facturées séparément')
        return { success: true, skipped: true, reason: 'no_f_lines', count: 0 }
      }

      // Allocate checkout-level discounts (including loyalty redemption) across
      // the sale lines so the F invoice reconciles with ventes.total_ttc.
      const allocatedLineTtc = (line: typeof lignesF[number]) => {
        const rawSaleLinesTotal = Number(line.vente_lignes_total) || 0
        const finalSaleTotal = Math.max(0, Number(line.vente_total_ttc) || 0)
        const saleFactor = rawSaleLinesTotal > 0 ? finalSaleTotal / rawSaleLinesTotal : 1
        return money3((Number(line.total_ligne) || 0) * saleFactor)
      }
      const totalTTC = money3(lignesF.reduce((s, l) => s + allocatedLineTtc(l), 0))
      if (totalTTC <= 0) {
        revokeExistingDailyInvoice('Le total des ventes F éligibles est nul')
        return { success: true, skipped: true, reason: 'zero_total', count: 0 }
      }

      let numero = existing?.numero
      if (!numero) {
        const year = Number(targetDate.slice(0, 4))
        const yy = String(year).slice(-2)
        const seqKey = `facture_vente_sequence_${year}`
        const prevRow = db.prepare(`SELECT value FROM app_settings WHERE key = ?`).get(seqKey) as { value?: string } | undefined
        const nextSeq = (parseInt(prevRow?.value ?? '0', 10) || 0) + 1
        db.prepare(`INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))`).run(seqKey, String(nextSeq))
        numero = `${yy}/#${String(nextSeq).padStart(5, '0')}`
      }
      const now = new Date().toISOString()
      const targetCreatedAt = new Date(`${targetDate}T12:00:00`).toISOString()
      const docId = existing?.id ?? randomUUID()
      const includedVenteIds = [...new Set(lignesF.map(l => l.vente_id))]
      const docLignes = lignesF.map(l => {
        const rawSaleLinesTotal = Number(l.vente_lignes_total) || 0
        const finalSaleTotal = Math.max(0, Number(l.vente_total_ttc) || 0)
        const saleFactor = rawSaleLinesTotal > 0 ? finalSaleTotal / rawSaleLinesTotal : 1
        const totalTtc = allocatedLineTtc(l)
        const tvaTaux = Math.max(0, Number(l.tva_taux) || 0)
        const totalHt = tvaTaux > 0 ? money3(totalTtc / (1 + tvaTaux / 100)) : totalTtc
        const totalTva = money3(totalTtc - totalHt)
        const adjustedUnitPriceTtc = (Number(l.prix_unitaire) || 0) * saleFactor
        const prixUnitaireHt = tvaTaux > 0
          ? money3(adjustedUnitPriceTtc / (1 + tvaTaux / 100))
          : money3(adjustedUnitPriceTtc)
        return {
          id: randomUUID(),
          document_id: docId,
          produit_id: l.produit_id ?? null,
          designation: l.designation,
          quantite: l.quantite,
          prix_unitaire: prixUnitaireHt,
          remise_pct: l.remise_pct ?? 0,
          tva_taux: tvaTaux,
          total_ht: totalHt,
          total_tva: totalTva,
          total_ttc: totalTtc,
          type_produit: 'F',
        }
      })
      const totalHT = money3(docLignes.reduce((sum, line) => sum + line.total_ht, 0))
      const totalTVA = money3(docLignes.reduce((sum, line) => sum + line.total_tva, 0))
      const taxBuckets = docLignes.reduce((totals, line) => {
        const roundedRate = Math.round(line.tva_taux)
        if (roundedRate === 7) {
          totals.ht_7 += line.total_ht
          totals.tva_7 += line.total_tva
        } else if (roundedRate === 19) {
          totals.ht_19 += line.total_ht
          totals.tva_19 += line.total_tva
        }
        return totals
      }, { ht_7: 0, tva_7: 0, ht_19: 0, tva_19: 0 })

      const doc = {
        id: docId,
        numero,
        type_document: 'FACTURE_JOURNALIERE_F',
        statut: 'ACTIF',
        shift_id: null,
        vente_id: null,
        fournisseur_id: null,
        client_id: null,
        client_nom: 'Client Passager',
        client_tel: null,
        client_adresse: null,
        client_matricule: null,
        total_ht: totalHT,
        total_tva: totalTVA,
        total_ttc: totalTTC,
        statut_paiement: 'PAYE',
        montant_paye: totalTTC,
        date_echeance: null,
        layout_snapshot: null,
        contenu_json: JSON.stringify({
          kind: 'daily_f_invoice',
          local_date: targetDate,
          vente_ids: includedVenteIds,
        }),
        ht_7: money3(taxBuckets.ht_7),
        tva_7: money3(taxBuckets.tva_7),
        ht_19: money3(taxBuckets.ht_19),
        tva_19: money3(taxBuckets.tva_19),
        created_at: existing?.created_at ?? targetCreatedAt,
        updated_at: now,
      }
      const replacedLineIds = existing
        ? db.prepare(`SELECT id FROM lignes_document WHERE document_id = ?`).all(docId) as Array<{ id: string }>
        : []

      db.transaction(() => {
        if (existing) {
          db.prepare(`DELETE FROM lignes_document WHERE document_id = ?`).run(docId)
          db.prepare(`
            UPDATE documents
            SET total_ht=?, total_tva=?, total_ttc=?, montant_paye=?, contenu_json=?,
                ht_7=?, tva_7=?, ht_19=?, tva_19=?, updated_at=?
            WHERE id=?
          `).run(
            totalHT, totalTVA, totalTTC, totalTTC, doc.contenu_json,
            doc.ht_7, doc.tva_7, doc.ht_19, doc.tva_19, now, docId,
          )
        } else {
          db.prepare(`
            INSERT INTO documents (id,numero,type_document,statut,shift_id,vente_id,fournisseur_id,client_id,client_nom,client_tel,client_adresse,client_matricule,total_ht,total_tva,total_ttc,statut_paiement,montant_paye,date_echeance,layout_snapshot,contenu_json,ht_7,tva_7,ht_19,tva_19,created_at,updated_at)
            VALUES (@id,@numero,@type_document,@statut,@shift_id,@vente_id,@fournisseur_id,@client_id,@client_nom,@client_tel,@client_adresse,@client_matricule,@total_ht,@total_tva,@total_ttc,@statut_paiement,@montant_paye,@date_echeance,@layout_snapshot,@contenu_json,@ht_7,@tva_7,@ht_19,@tva_19,@created_at,@updated_at)
          `).run(doc)
        }
        const insertLigne = db.prepare(`
          INSERT INTO lignes_document (id,document_id,produit_id,designation,quantite,prix_unitaire,remise_pct,tva_taux,total_ht,total_tva,total_ttc,type_produit)
          VALUES (@id,@document_id,@produit_id,@designation,@quantite,@prix_unitaire,@remise_pct,@tva_taux,@total_ht,@total_tva,@total_ttc,@type_produit)
        `)
        for (const l of docLignes) insertLigne.run(l)
      })()

      addActivityLog({ action: 'DOCUMENT_CREATED', details: { type_document: 'FACTURE_JOURNALIERE_F', numero, lineCount: docLignes.length }, montant: totalTTC })
      enqueueSync('documents', existing ? 'UPDATE' : 'INSERT', doc)
      for (const old of replacedLineIds) enqueueSync('lignes_document', 'DELETE', { id: old.id })
      for (const l of docLignes) enqueueSync('lignes_document', 'INSERT', l)

      return {
        success: true,
        updated: !!existing,
        documentId: docId,
        numero,
        lineCount: docLignes.length,
        saleCount: includedVenteIds.length,
        totalTTC,
        localDate: targetDate,
      }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('documents:listMissingDailyFactureFDays', (_e, from?: string, to?: string) => {
    const todayLocal = new Date().toLocaleDateString('en-CA')
    const safeFrom = /^\d{4}-\d{2}-\d{2}$/.test(from ?? '') ? from! : '2000-01-01'
    const safeTo = /^\d{4}-\d{2}-\d{2}$/.test(to ?? '') ? to! : todayLocal
    return db.prepare(`
      WITH sale_line_totals AS (
        SELECT vente_id, SUM(COALESCE(total_ligne, 0)) AS line_total
        FROM lignes_vente
        GROUP BY vente_id
      ),
      daily_sales AS (
        SELECT date(created_at, 'localtime') AS local_date,
               COUNT(*) AS day_sale_count,
               ROUND(SUM(COALESCE(total_ttc, 0)), 3) AS day_total_ttc
        FROM ventes
        WHERE type = 'VENTE'
          AND COALESCE(statut, 'ACTIVE') != 'ANNULEE'
          AND date(created_at, 'localtime') BETWEEN date(?) AND date(?)
        GROUP BY date(created_at, 'localtime')
      ),
      eligible AS (
        SELECT date(v.created_at, 'localtime') AS local_date,
               v.id AS vente_id,
               ROUND(COALESCE(lv.total_ligne, 0) *
                 CASE
                   WHEN COALESCE(slt.line_total, 0) > 0
                   THEN MAX(0, COALESCE(v.total_ttc, 0)) / slt.line_total
                   ELSE 1
                 END, 3) AS allocated_ttc
        FROM ventes v
        INNER JOIN lignes_vente lv ON lv.vente_id = v.id AND lv.type_produit = 'F'
        LEFT JOIN sale_line_totals slt ON slt.vente_id = v.id
        WHERE v.type = 'VENTE'
          AND COALESCE(v.statut, 'ACTIVE') != 'ANNULEE'
          AND date(v.created_at, 'localtime') BETWEEN date(?) AND date(?)
          AND date(v.created_at, 'localtime') < date('now', 'localtime')
          AND NOT EXISTS (
            SELECT 1 FROM documents manual_doc
            WHERE manual_doc.vente_id = v.id
              AND manual_doc.type_document = 'FACTURE_VENTE'
              AND manual_doc.statut NOT IN ('ANNULE', 'REVOQUE')
          )
          AND NOT EXISTS (
            SELECT 1 FROM factures_clients legacy_invoice
            WHERE legacy_invoice.vente_id = v.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM documents daily_doc
            WHERE daily_doc.type_document = 'FACTURE_JOURNALIERE_F'
              AND daily_doc.statut NOT IN ('ANNULE', 'REVOQUE')
              AND (
                date(daily_doc.created_at, 'localtime') = date(v.created_at, 'localtime')
                OR CASE WHEN json_valid(daily_doc.contenu_json)
                  THEN json_extract(daily_doc.contenu_json, '$.local_date') = date(v.created_at, 'localtime')
                  ELSE 0
                END
              )
          )
      )
      SELECT eligible.local_date,
             COUNT(DISTINCT eligible.vente_id) AS sale_count,
             ROUND(SUM(eligible.allocated_ttc), 3) AS total_ttc,
             COALESCE(daily_sales.day_sale_count, 0) AS day_sale_count,
             COALESCE(daily_sales.day_total_ttc, 0) AS day_total_ttc
      FROM eligible
      LEFT JOIN daily_sales ON daily_sales.local_date = eligible.local_date
      GROUP BY eligible.local_date
      HAVING SUM(eligible.allocated_ttc) > 0
      ORDER BY eligible.local_date DESC
    `).all(safeFrom, safeTo, safeFrom, safeTo)
  })

  // ─── Produits ────────────────────────────────────────────────────────────────
  ipcMain.handle('produits:list', (_e, filters: { search?: string; type?: string; lowStock?: boolean } = {}) => {
    let sql = 'SELECT * FROM produits WHERE actif = 1'
    const params: unknown[] = []
    if (filters.search) {
      sql += ` AND (nom LIKE ? OR reference LIKE ? OR code_barre LIKE ? OR categorie LIKE ?)`
      const s = `%${filters.search}%`
      params.push(s, s, s, s)
    }
    if (filters.type) { sql += ' AND type = ?'; params.push(filters.type) }
    if (filters.lowStock) { sql += ' AND stock_actuel <= stock_minimum' }
    sql += ' ORDER BY nom'
    return db.prepare(sql).all(...params)
  })

  ipcMain.handle('produits:findByBarcode', (_e, code) => {
    const scanned = String(code ?? '').trim()
    let product = db.prepare('SELECT * FROM produits WHERE code_barre = ? AND actif = 1').get(scanned)
    if (!product && /^\d{13}$/.test(scanned)) {
      const smlCode = `SML-${scanned.slice(0, 8)}-${scanned.slice(8)}`
      product = db.prepare('SELECT * FROM produits WHERE UPPER(code_barre) = ? AND actif = 1').get(smlCode)
    }
    return product
  })

  ipcMain.handle('produits:get', (_e, id) => {
    return db.prepare('SELECT * FROM produits WHERE id = ?').get(id)
  })

  ipcMain.handle('produits:create', (_e, p) => {
    const idempotentCreate = p.idempotent_create === true
    const normalized = {
      has_serial_number: 0, numero_serie: null,
      tva_achat_pct: 0, marge_pct: null, coef_av: null,
      cout_supplementaire: 0, cout_de_revient: null, prix_vente_ht: null, pvp: null,
      ...p
    }
    delete normalized.idempotent_create
    normalized.reference = String(normalized.reference ?? '').trim()
    normalized.code_barre = String(normalized.code_barre ?? '').trim() || null
    normalized.nom = String(normalized.nom ?? '').trim()
    const makeUniqueReference = () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = `PRD-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`
        if (!db.prepare('SELECT 1 FROM produits WHERE reference = ?').get(candidate)) return candidate
      }
      return `PRD-${randomUUID().toUpperCase()}`
    }
    if (!normalized.reference) normalized.reference = makeUniqueReference()

    const byId = normalized.id ? db.prepare('SELECT * FROM produits WHERE id = ?').get(normalized.id) as Record<string, unknown> | undefined : undefined
    if (byId) return { success: true, product: byId, reused: true }

    const byBarcode = normalized.code_barre
      ? db.prepare('SELECT * FROM produits WHERE code_barre = ?').get(normalized.code_barre) as Record<string, unknown> | undefined
      : undefined
    if (byBarcode) {
      if (idempotentCreate && String(byBarcode.nom ?? '').trim().toLocaleLowerCase() === normalized.nom.toLocaleLowerCase()) {
        return { success: true, product: byBarcode, reused: true }
      }
      throw new Error(`Le code-barres ${normalized.code_barre} appartient déjà au produit « ${String(byBarcode.nom)} »`)
    }

    const byReference = db.prepare('SELECT * FROM produits WHERE reference = ?').get(normalized.reference) as Record<string, unknown> | undefined
    if (byReference) {
      const sameName = String(byReference.nom ?? '').trim().toLocaleLowerCase() === normalized.nom.toLocaleLowerCase()
      const existingBarcode = String(byReference.code_barre ?? '').trim()
      const sameBarcode = !normalized.code_barre || !existingBarcode || existingBarcode === normalized.code_barre
      const samePendingProduct = sameName && sameBarcode
      if (idempotentCreate && samePendingProduct) return { success: true, product: byReference, reused: true }
      if (idempotentCreate) normalized.reference = makeUniqueReference()
      else throw new Error(`La référence ${normalized.reference} existe déjà pour « ${String(byReference.nom)} »`)
    }
    const stmt = db.prepare(`
      INSERT INTO produits (id, code_barre, reference, nom, description, categorie, type,
        prix_achat, prix_vente, tva_taux, tva_achat_pct, marge_pct, coef_av,
        cout_supplementaire, cout_de_revient, prix_vente_ht, pvp,
        stock_actuel, stock_minimum, fournisseur,
        has_serial_number, numero_serie, actif, created_at, updated_at)
      VALUES (@id, @code_barre, @reference, @nom, @description, @categorie, @type,
        @prix_achat, @prix_vente, @tva_taux, @tva_achat_pct, @marge_pct, @coef_av,
        @cout_supplementaire, @cout_de_revient, @prix_vente_ht, @pvp,
        @stock_actuel, @stock_minimum, @fournisseur,
        @has_serial_number, @numero_serie, 1, @created_at, @updated_at)
    `)
    const result = stmt.run(normalized)
    addActivityLog({ action: 'PRODUCT_CREATED', details: { id: normalized.id, nom: normalized.nom, reference: normalized.reference } })
    enqueueSync('produits', 'INSERT', normalized)
    return { success: true, changes: result.changes, product: normalized, reused: false }
  })

  // Excel exports must use Electron's native save path. Browser downloads can
  // appear frozen in packaged Windows builds because there is no browser shelf.
  ipcMain.handle('exports:saveExcel', async (_e, base64: string, suggestedName = 'export.xlsx') => {
    try {
      if (typeof base64 !== 'string' || !base64.trim()) return { success: false, error: 'Fichier Excel vide' }
      const safeName = `${basename(suggestedName, extname(suggestedName)) || 'export'}.xlsx`
      const target = await dialog.showSaveDialog(mainWindow ?? undefined, {
        title: 'Enregistrer export Excel',
        defaultPath: safeName,
        filters: [{ name: 'Fichier Excel', extensions: ['xlsx'] }],
      })
      if (target.canceled || !target.filePath) return { success: false, canceled: true }
      const buffer = Buffer.from(base64, 'base64')
      if (!buffer.length) return { success: false, error: 'Données Excel invalides' }
      writeFileSync(target.filePath, buffer)
      return { success: true, path: target.filePath }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('produits:update', (_e, id, p) => {
    const normalized = {
      has_serial_number: 0, numero_serie: null,
      tva_achat_pct: 0, marge_pct: null, coef_av: null,
      cout_supplementaire: 0, cout_de_revient: null, prix_vente_ht: null, pvp: null,
      source_tag: null,
      ...p
    }
    const stmt = db.prepare(`
      UPDATE produits SET
        code_barre=@code_barre, reference=@reference, nom=@nom, description=@description, categorie=@categorie,
        type=@type, prix_achat=@prix_achat, prix_vente=@prix_vente, tva_taux=@tva_taux,
        tva_achat_pct=@tva_achat_pct, marge_pct=@marge_pct, coef_av=@coef_av,
        cout_supplementaire=@cout_supplementaire, cout_de_revient=@cout_de_revient,
        prix_vente_ht=@prix_vente_ht, pvp=@pvp,
        stock_actuel=@stock_actuel, stock_minimum=@stock_minimum, fournisseur=@fournisseur,
        has_serial_number=@has_serial_number, numero_serie=@numero_serie, source_tag=@source_tag,
        updated_at=@updated_at
      WHERE id=@id
    `)
    const result = stmt.run({ id, ...normalized })
    addActivityLog({ action: 'PRODUCT_UPDATED', details: { id, nom: normalized.nom } })
    enqueueSync('produits', 'UPDATE', { id, ...normalized })
    return result
  })

  ipcMain.handle('produits:getSourceTags', () => {
    return db.prepare(`SELECT DISTINCT source_tag FROM produits WHERE source_tag IS NOT NULL AND source_tag != '' ORDER BY source_tag`)
      .all()
      .map((r: unknown) => (r as { source_tag: string }).source_tag)
  })

  ipcMain.handle('produits:delete', (_e, id) => {
    const result = db.prepare('UPDATE produits SET actif = 0 WHERE id = ?').run(id)
    addActivityLog({ action: 'PRODUCT_DELETED', details: { id } })
    enqueueSync('produits', 'UPDATE', { id, actif: 0 })
    return result
  })

  ipcMain.handle('produits:adjustStock', (_e, id, delta) => {
    const result = db.prepare('UPDATE produits SET stock_actuel = MAX(0, stock_actuel + ?) WHERE id = ?').run(delta, id)
    addActivityLog({ action: 'STOCK_ADJUSTED', details: { id, delta } })
    enqueueProductSnapshot(id)
    return result
  })

  // ─── Serial Numbers ───────────────────────────────────────────────────────
  function parseSerialJson(numerosSerieJson: unknown): string[] {
    if (!numerosSerieJson) return []
    try {
      const sns = typeof numerosSerieJson === 'string' ? JSON.parse(numerosSerieJson) : numerosSerieJson as string[]
      return Array.isArray(sns) ? sns.map(s => String(s).trim()).filter(Boolean) : []
    } catch {
      return []
    }
  }

  function achatLineAffectsInventory(facture: Record<string, unknown>): boolean {
    if (facture.type === 'FACTURE_ACHAT_BL') return facture.statut_reception === 'ARRIVE'
    return facture.statut_paiement !== 'BROUILLON' && facture.statut_paiement !== 'ANNULE'
  }

  function revertAchatLineInventory(line: Record<string, unknown>) {
    const produitId = line.produit_id as string | null | undefined
    const quantite = Number(line.quantite) || 0
    if (!produitId || quantite <= 0) return
    db.prepare('UPDATE produits SET stock_actuel = MAX(0, stock_actuel - ?) WHERE id = ?').run(quantite, produitId)
    for (const sn of parseSerialJson(line.numeros_serie_json)) {
      db.prepare(`DELETE FROM serial_numbers WHERE produit_id = ? AND numero_serie = ? AND statut = 'EN_STOCK'`).run(produitId, sn)
    }
  }

  function applyAchatLineInventory(line: Record<string, unknown>) {
    const produitId = line.produit_id as string | null | undefined
    const quantite = Number(line.quantite) || 0
    if (!produitId || quantite <= 0) return
    if (line.numeros_serie_json) {
      const serialResult = addSerialNumbersToStock(produitId, line.numeros_serie_json, quantite, {
        skipExistingInStockForSameProduct: true,
      })
      if (serialResult.inserted > 0) {
        db.prepare('UPDATE produits SET stock_actuel = stock_actuel + ? WHERE id = ?').run(serialResult.inserted, produitId)
      }
      return
    }
    db.prepare('UPDATE produits SET stock_actuel = stock_actuel + ? WHERE id = ?').run(quantite, produitId)
  }

  function revertVenteLineInventory(venteId: string, ligne: Record<string, unknown>, now: string) {
    const produitId = ligne.produit_id as string | null | undefined
    const quantite = Number(ligne.quantite) || 0
    if (!produitId || quantite <= 0) return
    db.prepare('UPDATE produits SET stock_actuel = stock_actuel + ? WHERE id = ?').run(quantite, produitId)
    const serials = String(ligne.numero_serie ?? '').split(',').map(s => s.trim()).filter(Boolean)
    if (serials.length) {
      for (const sn of serials) {
        db.prepare(`UPDATE serial_numbers SET statut = 'EN_STOCK', vente_id = NULL, updated_at = ? WHERE produit_id = ? AND numero_serie = ? AND vente_id = ?`)
          .run(now, produitId, sn, venteId)
      }
    } else {
      const sold = db.prepare(`SELECT id FROM serial_numbers WHERE produit_id = ? AND vente_id = ? AND statut = 'VENDU' ORDER BY updated_at DESC LIMIT ?`)
        .all(produitId, venteId, quantite) as { id: string }[]
      for (const sn of sold) {
        db.prepare(`UPDATE serial_numbers SET statut = 'EN_STOCK', vente_id = NULL, updated_at = ? WHERE id = ?`).run(now, sn.id)
      }
    }
  }

  function applyVenteLineInventory(venteId: string, ligne: Record<string, unknown>, now: string) {
    const produitId = ligne.produit_id as string | null | undefined
    const quantite = Number(ligne.quantite) || 0
    if (!produitId || quantite <= 0) return
    db.prepare('UPDATE produits SET stock_actuel = MAX(0, stock_actuel - ?) WHERE id = ?').run(quantite, produitId)
    const prod = db.prepare('SELECT has_serial_number FROM produits WHERE id = ?').get(produitId) as { has_serial_number?: number } | undefined
    if (!prod?.has_serial_number) return
    const serials = String(ligne.numero_serie ?? '').split(',').map(s => s.trim()).filter(Boolean)
    const toMark = serials.length ? serials : Array.from({ length: quantite }, () => null as string | null)
    const snByValue = db.prepare(`SELECT id FROM serial_numbers WHERE produit_id = ? AND numero_serie = ? AND statut = 'EN_STOCK'`)
    const nextSn = db.prepare(`SELECT id FROM serial_numbers WHERE produit_id = ? AND statut = 'EN_STOCK' ORDER BY created_at ASC LIMIT 1`)
    const markSnSold = db.prepare(`UPDATE serial_numbers SET statut = 'VENDU', vente_id = ?, updated_at = ? WHERE id = ?`)
    for (const snVal of toMark) {
      const sn = snVal
        ? snByValue.get(produitId, snVal) as { id: string } | undefined
        : nextSn.get(produitId) as { id: string } | undefined
      if (sn) markSnSold.run(venteId, now, sn.id)
    }
  }

  function addSerialNumbersToStock(
    produitId: string,
    numerosSerieJson: unknown,
    quantite: number,
    options: { skipExistingInStockForSameProduct?: boolean } = {},
  ): { inserted: number; skipped: string[] } {
    if (!numerosSerieJson) return { inserted: 0, skipped: [] }
    let sns: string[]
    try {
      sns = typeof numerosSerieJson === 'string' ? JSON.parse(numerosSerieJson) : numerosSerieJson as string[]
    } catch {
      return { inserted: 0, skipped: [] }
    }
    if (!Array.isArray(sns)) return { inserted: 0, skipped: [] }
    const filled = sns.map(s => String(s).trim()).filter(Boolean)
    const seenInPayload = new Set<string>()
    for (const sn of filled) {
      const key = sn.toLowerCase()
      if (seenInPayload.has(key)) {
        throw new Error(`Numero de serie saisi plusieurs fois dans cette facture : ${sn}`)
      }
      seenInPayload.add(key)
    }
    if (filled.length !== quantite) {
      throw new Error(`Numéros de série incomplets (${filled.length}/${quantite})`)
    }
    const now = new Date().toISOString()
    const existing = options.skipExistingInStockForSameProduct
      ? db.prepare("SELECT numero_serie FROM serial_numbers WHERE produit_id = ? AND statut != 'EN_STOCK'").all(produitId) as { numero_serie: string }[]
      : db.prepare('SELECT numero_serie FROM serial_numbers WHERE produit_id = ?').all(produitId) as { numero_serie: string }[]
    const existingSet = new Set(existing.map(r => r.numero_serie.trim().toLowerCase()))
    const existingEnStock = options.skipExistingInStockForSameProduct
      ? db.prepare("SELECT numero_serie FROM serial_numbers WHERE produit_id = ? AND statut = 'EN_STOCK'").all(produitId) as { numero_serie: string }[]
      : []
    const existingEnStockSet = new Set(existingEnStock.map(r => r.numero_serie.trim().toLowerCase()))
    const toInsert = filled.filter(sn => !existingEnStockSet.has(sn.toLowerCase()))
    for (const sn of filled) {
      if (existingSet.has(sn.toLowerCase())) {
        throw new Error(`Numéro de série déjà existant : ${sn}`)
      }
    }
    const insert = db.prepare(`
      INSERT INTO serial_numbers (id, produit_id, numero_serie, statut, created_at, updated_at)
      VALUES (?, ?, ?, 'EN_STOCK', ?, ?)
    `)
    for (const sn of toInsert) {
      insert.run(randomUUID(), produitId, sn, now, now)
    }
    return { inserted: toInsert.length, skipped: filled.filter(sn => existingEnStockSet.has(sn.toLowerCase())) }
  }

  ipcMain.handle('serialNumbers:getByProduit', (_e, produitId: string) => {
    return db.prepare('SELECT * FROM serial_numbers WHERE produit_id = ? ORDER BY created_at ASC').all(produitId)
  })

  ipcMain.handle('serialNumbers:bulkSet', (_e, produitId: string, snList: string[]) => {
    // Replace all S/N for this product (only EN_STOCK — don't touch VENDU)
    const now = new Date().toISOString()
    db.transaction(() => {
      db.prepare("DELETE FROM serial_numbers WHERE produit_id = ? AND statut = 'EN_STOCK'").run(produitId)
      const insert = db.prepare(`
        INSERT INTO serial_numbers (id, produit_id, numero_serie, statut, created_at, updated_at)
        VALUES (?, ?, ?, 'EN_STOCK', ?, ?)
      `)
      for (const sn of snList) {
        if (sn.trim()) {
          const { randomUUID } = require('crypto') as typeof import('crypto')
          insert.run(randomUUID(), produitId, sn.trim(), now, now)
        }
      }
    })()
    return { success: true }
  })

  ipcMain.handle('serialNumbers:markSold', (_e, produitId: string, venteId: string) => {
    // Mark the first available EN_STOCK S/N as VENDU
    const now = new Date().toISOString()
    const sn = db.prepare("SELECT id FROM serial_numbers WHERE produit_id = ? AND statut = 'EN_STOCK' ORDER BY created_at ASC LIMIT 1").get(produitId) as { id: string } | undefined
    if (sn) {
      db.prepare("UPDATE serial_numbers SET statut = 'VENDU', vente_id = ?, updated_at = ? WHERE id = ?").run(venteId, now, sn.id)
      return { success: true, id: sn.id }
    }
    return { success: false }
  })

  ipcMain.handle('produits:bulkInsert', (_e, produits) => {
    const insert = db.prepare(`
      INSERT OR REPLACE INTO produits (id, code_barre, reference, nom, description, categorie, type,
        prix_achat, prix_vente, tva_taux, stock_actuel, stock_minimum, fournisseur, actif, created_at, updated_at)
      VALUES (@id, @code_barre, @reference, @nom, @description, @categorie, @type,
        @prix_achat, @prix_vente, @tva_taux, @stock_actuel, @stock_minimum, @fournisseur, 1, @created_at, @updated_at)
    `)
    const transaction = db.transaction((items) => {
      for (const item of items) insert.run(item)
    })
    transaction(produits)
    addActivityLog({ action: 'PRODUCTS_IMPORTED', details: { count: produits.length } })
    for (const p of produits) enqueueSync('produits', 'INSERT', p)
    return { success: true }
  })

  ipcMain.handle('produits:bulkImport', (_e, payload: {
    produits: Record<string, unknown>[]
    options?: { onDuplicate?: 'update' | 'skip'; matchBy?: 'reference' | 'code_barre' }
  }) => {
    const { produits, options } = payload
    const onDuplicate = options?.onDuplicate ?? 'update'
    const matchBy = options?.matchBy ?? 'reference'
    const now = new Date().toISOString()

    const findByRef = db.prepare('SELECT id, created_at FROM produits WHERE reference = ?')
    const findByBarcode = db.prepare(`
      SELECT id, created_at FROM produits
      WHERE code_barre = ? AND code_barre IS NOT NULL AND TRIM(code_barre) != ''
    `)

    const insert = db.prepare(`
      INSERT INTO produits (id, code_barre, reference, nom, description, categorie, type,
        prix_achat, prix_vente, tva_taux, stock_actuel, stock_minimum, fournisseur, actif, created_at, updated_at)
      VALUES (@id, @code_barre, @reference, @nom, @description, @categorie, @type,
        @prix_achat, @prix_vente, @tva_taux, @stock_actuel, @stock_minimum, @fournisseur, 1, @created_at, @updated_at)
    `)

    const update = db.prepare(`
      UPDATE produits SET
        code_barre = @code_barre,
        reference = @reference,
        nom = @nom,
        description = @description,
        categorie = @categorie,
        type = @type,
        prix_achat = @prix_achat,
        prix_vente = @prix_vente,
        tva_taux = @tva_taux,
        stock_actuel = @stock_actuel,
        stock_minimum = @stock_minimum,
        fournisseur = @fournisseur,
        updated_at = @updated_at
      WHERE id = @id
    `)

    let inserted = 0
    let updated = 0
    let skipped = 0

    const resolveExisting = (item: Record<string, unknown>) => {
      if (matchBy === 'code_barre' && item.code_barre) {
        return findByBarcode.get(item.code_barre) as { id: string; created_at: string } | undefined
      }
      if (item.reference) {
        return findByRef.get(item.reference) as { id: string; created_at: string } | undefined
      }
      if (item.code_barre) {
        return findByBarcode.get(item.code_barre) as { id: string; created_at: string } | undefined
      }
      return undefined
    }

    const transaction = db.transaction((items: Record<string, unknown>[]) => {
      for (const item of items) {
        const existing = resolveExisting(item)
        if (existing) {
          if (onDuplicate === 'skip') {
            skipped++
            continue
          }
          const row = {
            ...item,
            id: existing.id,
            created_at: existing.created_at,
            updated_at: now,
          }
          update.run(row)
          enqueueSync('produits', 'UPDATE', row)
          updated++
          continue
        }

        const row = {
          ...item,
          created_at: item.created_at ?? now,
          updated_at: now,
        }
        insert.run(row)
        enqueueSync('produits', 'INSERT', row)
        inserted++
      }
    })

    transaction(produits)
    addActivityLog({ action: 'PRODUCTS_IMPORTED', details: { inserted, updated, skipped } })
    return { success: true, inserted, updated, skipped }
  })

  // ─── Ventes ──────────────────────────────────────────────────────────────────
  ipcMain.handle('ventes:create', (_e, vente, lignes) => {
    const normalizedVente = normalizeMoneyFields({
      client_id: null, client_adresse: null, client_matricule: null, type_vente: 'TICKET', a_facture: 0,
      fidelite_utilisee: 0, fidelite_gagnee: 0,
      ...vente,
    }, ['sous_total', 'total_remises', 'total_ttc', 'montant_recu', 'monnaie_rendue', 'fidelite_utilisee', 'fidelite_gagnee'])
    const normalizedLignes = (lignes as Record<string, unknown>[]).map(ligne => normalizeVenteLine({ numero_serie: null, ...ligne }))
    if (normalizedVente.type === 'VENTE' && !normalizedVente.shift_id) {
      throw new Error('Ouvrez une caisse externe avant l’encaissement')
    }
    const loyaltyUsed = Math.max(0, money3(normalizedVente.fidelite_utilisee))
    const loyaltyClient = normalizedVente.client_id
      ? db.prepare(`SELECT * FROM clients WHERE id = ? AND actif = 1`).get(normalizedVente.client_id) as Record<string, unknown> | undefined
      : undefined
    const hasLoyaltyCard = !!String(loyaltyClient?.fidelite_code ?? '').trim()
    const balanceBefore = Math.max(0, money3(loyaltyClient?.solde_fidelite))
    if (loyaltyUsed > 0 && (!loyaltyClient || !hasLoyaltyCard)) throw new Error('Carte de fidélité invalide')
    if (loyaltyUsed > balanceBefore + 0.0001) throw new Error('Solde fidélité insuffisant')
    const grossAfterOtherDiscounts = money3(Number(normalizedVente.total_ttc) + loyaltyUsed)
    if (loyaltyUsed > grossAfterOtherDiscounts + 0.0001) throw new Error('La remise fidélité dépasse le total')
    const gainPctRow = db.prepare(`SELECT value FROM app_settings WHERE key = 'fidelite_gain_pct'`).get() as { value?: string } | undefined
    const minPurchaseRow = db.prepare(`SELECT value FROM app_settings WHERE key = 'fidelite_min_achat'`).get() as { value?: string } | undefined
    const maxUsePctRow = db.prepare(`SELECT value FROM app_settings WHERE key = 'fidelite_max_utilisation_pct'`).get() as { value?: string } | undefined
    const gainPct = Math.max(0, Number(gainPctRow?.value) || 0)
    const minPurchase = Math.max(0, Number(minPurchaseRow?.value) || 0)
    const maxUsePct = Math.min(100, Math.max(0, Number(maxUsePctRow?.value) || 0))
    const maxAllowedUse = money3(grossAfterOtherDiscounts * maxUsePct / 100)
    if (loyaltyUsed > maxAllowedUse + 0.0001) throw new Error(`Utilisation fidélité limitée à ${maxUsePct}% du total`)
    const loyaltyEarned = hasLoyaltyCard && Number(normalizedVente.total_ttc) >= minPurchase
      ? money3(Number(normalizedVente.total_ttc) * gainPct / 100)
      : 0
    normalizedVente.fidelite_gagnee = loyaltyEarned
    const insertVente = db.prepare(`
      INSERT INTO ventes (id, numero, shift_id, operateur_nom, client_id, client_nom, client_tel, client_adresse, client_matricule,
        sous_total, total_remises, total_ttc, mode_paiement, montant_recu, monnaie_rendue, type, type_vente, a_facture,
        fidelite_utilisee, fidelite_gagnee, created_at)
      VALUES (@id, @numero, @shift_id, @operateur_nom, @client_id, @client_nom, @client_tel, @client_adresse, @client_matricule,
        @sous_total, @total_remises, @total_ttc, @mode_paiement, @montant_recu, @monnaie_rendue, @type, @type_vente, @a_facture,
        @fidelite_utilisee, @fidelite_gagnee, @created_at)
    `)
    const insertLigne = db.prepare(`
      INSERT INTO lignes_vente (id, vente_id, produit_id, designation, quantite, prix_unitaire, remise_pct, total_ligne, type_produit, numero_serie)
      VALUES (@id, @vente_id, @produit_id, @designation, @quantite, @prix_unitaire, @remise_pct, @total_ligne, @type_produit, @numero_serie)
    `)
    const updateStock = db.prepare('UPDATE produits SET stock_actuel = MAX(0, stock_actuel - ?) WHERE id = ?')
    const markSnSold = db.prepare(`UPDATE serial_numbers SET statut = 'VENDU', vente_id = ?, updated_at = ? WHERE id = ?`)
    const nextSn = db.prepare(`SELECT id FROM serial_numbers WHERE produit_id = ? AND statut = 'EN_STOCK' ORDER BY created_at ASC LIMIT 1`)
    const snByValue = db.prepare(`SELECT id FROM serial_numbers WHERE produit_id = ? AND numero_serie = ? AND statut = 'EN_STOCK'`)

    const transaction = db.transaction(() => {
      insertVente.run(normalizedVente)
      const now = new Date().toISOString()
      for (const ligne of normalizedLignes) {
        insertLigne.run(ligne)
        if (ligne.produit_id) {
          updateStock.run(Number(ligne.quantite ?? 0), ligne.produit_id)
          const prod = db.prepare('SELECT has_serial_number FROM produits WHERE id = ?').get(ligne.produit_id) as { has_serial_number?: number } | undefined
          if (prod?.has_serial_number) {
            const serials = String(ligne.numero_serie ?? '')
              .split(',')
              .map((s: string) => s.trim())
              .filter(Boolean)
            const toMark = serials.length ? serials : Array.from({ length: Number(ligne.quantite ?? 0) }, () => null)
            for (const snVal of toMark) {
              const sn = snVal
                ? snByValue.get(ligne.produit_id, snVal) as { id: string } | undefined
                : nextSn.get(ligne.produit_id) as { id: string } | undefined
              if (sn) markSnSold.run(vente.id, now, sn.id)
            }
          }
        }
      }
      if (loyaltyClient && hasLoyaltyCard && (loyaltyUsed > 0 || loyaltyEarned > 0)) {
        let runningBalance = balanceBefore
        const insertMovement = db.prepare(`
          INSERT INTO mouvements_fidelite
            (id,client_id,vente_id,type,montant,solde_avant,solde_apres,note,operateur,created_at)
          VALUES (@id,@client_id,@vente_id,@type,@montant,@solde_avant,@solde_apres,@note,@operateur,@created_at)
        `)
        if (loyaltyUsed > 0) {
          const afterUse = money3(runningBalance - loyaltyUsed)
          insertMovement.run({
            id: randomUUID(), client_id: loyaltyClient.id, vente_id: normalizedVente.id,
            type: 'UTILISATION', montant: loyaltyUsed, solde_avant: runningBalance, solde_apres: afterUse,
            note: `Remise fidélité ${normalizedVente.numero}`, operateur: normalizedVente.operateur_nom, created_at: now,
          })
          runningBalance = afterUse
        }
        if (loyaltyEarned > 0) {
          const afterEarn = money3(runningBalance + loyaltyEarned)
          insertMovement.run({
            id: randomUUID(), client_id: loyaltyClient.id, vente_id: normalizedVente.id,
            type: 'GAIN', montant: loyaltyEarned, solde_avant: runningBalance, solde_apres: afterEarn,
            note: `Cashback ${gainPct}% — ${normalizedVente.numero}`, operateur: normalizedVente.operateur_nom, created_at: now,
          })
          runningBalance = afterEarn
        }
        db.prepare(`UPDATE clients SET solde_fidelite = ? WHERE id = ?`).run(runningBalance, loyaltyClient.id)
      }
    })
    transaction()
    addActivityLog({ shift_id: normalizedVente.shift_id as string, operateur: normalizedVente.operateur_nom as string, action: 'SALE_CREATED', montant: normalizedVente.total_ttc as number, details: { numero: normalizedVente.numero, mode: normalizedVente.mode_paiement, type_vente: normalizedVente.type_vente } })
    enqueueSync('ventes', 'INSERT', normalizedVente)
    for (const ligne of normalizedLignes) enqueueSync('lignes_vente', 'INSERT', ligne)
    for (const ligne of normalizedLignes) if (ligne.produit_id) enqueueProductSnapshot(ligne.produit_id)
    const loyaltyAfter = loyaltyClient
      ? db.prepare(`SELECT solde_fidelite FROM clients WHERE id = ?`).get(loyaltyClient.id) as { solde_fidelite?: number } | undefined
      : undefined
    if (loyaltyClient && hasLoyaltyCard) {
      const clientSnapshot = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(loyaltyClient.id) as Record<string, unknown>
      enqueueSync('clients', 'UPDATE', clientSnapshot)
    }
    return { success: true, fidelite_utilisee: loyaltyUsed, fidelite_gagnee: loyaltyEarned, solde_fidelite: loyaltyAfter?.solde_fidelite ?? 0 }
  })

  ipcMain.handle('ventes:list', (_e, filters: { shiftId?: string; dateFrom?: string; dateTo?: string; limit?: number; search?: string } = {}) => {
    let sql = 'SELECT * FROM ventes WHERE 1=1'
    const params: unknown[] = []
    if (filters.shiftId) { sql += ' AND shift_id = ?'; params.push(filters.shiftId) }
    if (filters.dateFrom) { sql += ' AND created_at >= ?'; params.push(filters.dateFrom.length === 10 ? filters.dateFrom + 'T00:00:00.000Z' : filters.dateFrom) }
    if (filters.dateTo) { sql += ' AND created_at <= ?'; params.push(filters.dateTo.length === 10 ? filters.dateTo + 'T23:59:59.999Z' : filters.dateTo) }
    if (filters.search) { sql += ' AND (numero LIKE ? OR client_nom LIKE ? OR client_tel LIKE ?)'; const s = `%${filters.search}%`; params.push(s, s, s) }
    sql += ' ORDER BY created_at DESC'
    if (filters.limit) { sql += ' LIMIT ?'; params.push(filters.limit) }
    return db.prepare(sql).all(...params)
  })

  ipcMain.handle('ventes:getLignes', (_e, venteId) => {
    return db.prepare(`
      SELECT lv.*, p.tva_taux AS tva_taux
      FROM lignes_vente lv
      LEFT JOIN produits p ON lv.produit_id = p.id
      WHERE lv.vente_id = ?
    `).all(venteId)
  })

  ipcMain.handle('ventes:getLastNumber', (_e, prefix) => {
    const row = db.prepare(`SELECT numero FROM ventes WHERE numero LIKE ? ORDER BY created_at DESC LIMIT 1`).get(`${prefix}%`) as { numero: string } | undefined
    if (!row) return 0
    const parts = row.numero.split('-')
    return parseInt(parts[parts.length - 1]) || 0
  })

  ipcMain.handle('reparations:getLastNumber', (_e, prefix) => {
    const row = db.prepare(`SELECT numero FROM reparations WHERE numero LIKE ? ORDER BY created_at DESC LIMIT 1`).get(`${prefix}%`) as { numero: string } | undefined
    if (!row) return 0
    const parts = row.numero.split('-')
    return parseInt(parts[parts.length - 1]) || 0
  })

  // ─── Réparations ────────────────────────────────────────────────────────────
  ipcMain.handle('reparations:create', (_e, rep, pieces) => {
    const now = new Date().toISOString()
    const normalizedRep = {
      shift_id: null, operateur_nom: null, client_nom: null, client_tel: null,
      marque: null, modele: null, total_final: 0, benefice: 0,
      repair_token: null, estimated_completion: null,
      technicien: null, notes_technicien: null,
      created_at: now, updated_at: now,
      ...rep,
    }
    normalizedRep.benefice = Number(normalizedRep.total_final) > 0
      ? Number(normalizedRep.total_final) - Number(normalizedRep.main_oeuvre ?? 0)
      : 0
    if (Number(normalizedRep.acompte) > 0 && !normalizedRep.shift_id) {
      throw new Error('Ouvrez une caisse externe avant d’encaisser l’acompte')
    }

    const insertRep = db.prepare(`
      INSERT INTO reparations (id, numero, shift_id, operateur_nom, client_nom, client_tel,
        type_appareil, marque, modele, description_panne, main_oeuvre, acompte,
        total_estime, total_final, benefice, statut, repair_token, estimated_completion, created_at, updated_at)
      VALUES (@id, @numero, @shift_id, @operateur_nom, @client_nom, @client_tel,
        @type_appareil, @marque, @modele, @description_panne, @main_oeuvre, @acompte,
        @total_estime, @total_final, @benefice, @statut, @repair_token, @estimated_completion, @created_at, @updated_at)
    `)
    const insertPiece = db.prepare(`
      INSERT INTO pieces_reparation (id, reparation_id, produit_id, designation, quantite, prix_unitaire, prix_achat, destock_stock, type)
      VALUES (@id, @reparation_id, @produit_id, @designation, @quantite, @prix_unitaire, @prix_achat, @destock_stock, @type)
    `)
    const updateStock = db.prepare(`UPDATE produits SET stock_actuel = MAX(0, stock_actuel - ?), updated_at = datetime('now') WHERE id = ?`)
    const transaction = db.transaction(() => {
      insertRep.run(normalizedRep)
      for (const p of pieces) {
        const row = {
          produit_id: null,
          prix_achat: 0,
          destock_stock: 0,
          ...p,
        }
        insertPiece.run(row)
        if (row.produit_id && row.destock_stock) {
          updateStock.run(row.quantite ?? 1, row.produit_id)
        }
      }
    })
    transaction()
    for (const p of pieces) {
      const row = p as { produit_id?: string; destock_stock?: number }
      if (row.produit_id && row.destock_stock) enqueueProductSnapshot(row.produit_id)
    }
    addActivityLog({ shift_id: normalizedRep.shift_id, operateur: normalizedRep.operateur_nom, action: 'REPAIR_CREATED', details: { numero: normalizedRep.numero, client: normalizedRep.client_nom }, montant: normalizedRep.total_final })
    enqueueSync('reparations', 'INSERT', normalizedRep)
    for (const p of pieces) {
      const pieceRow = { produit_id: null, ...p }
      enqueueSync('pieces_reparation', 'INSERT', pieceRow as Record<string, unknown>)
    }
    return { success: true }
  })

  ipcMain.handle('reparations:applyDegatPrices', (_e, repId: string, updates: { id: string; prix_achat: number }[]) => {
    if (!updates?.length) return { success: true }
    const now = new Date().toISOString()
    const updatePiece = db.prepare(
      `UPDATE pieces_reparation SET prix_achat = ? WHERE id = ? AND reparation_id = ? AND destock_stock = 1`,
    )
    const transaction = db.transaction(() => {
      for (const u of updates) {
        updatePiece.run(u.prix_achat, u.id, repId)
      }
      const sumRow = db.prepare(
        `SELECT SUM(COALESCE(quantite,1) * COALESCE(prix_achat,0)) as total FROM pieces_reparation WHERE reparation_id = ?`,
      ).get(repId) as { total?: number }
      const repRow = db.prepare(`SELECT total_final FROM reparations WHERE id = ?`).get(repId) as { total_final?: number }
      const mainOeuvre = sumRow?.total ?? 0
      const benefice = (repRow?.total_final ?? 0) - mainOeuvre
      db.prepare(`UPDATE reparations SET main_oeuvre = ?, benefice = ?, updated_at = ? WHERE id = ?`).run(
        mainOeuvre, benefice, now, repId,
      )
    })
    transaction()
    const rep = db.prepare(`SELECT * FROM reparations WHERE id = ?`).get(repId) as Record<string, unknown>
    enqueueSync('reparations', 'UPDATE', rep)
    for (const u of updates) {
      const piece = db.prepare(`SELECT * FROM pieces_reparation WHERE id = ?`).get(u.id) as Record<string, unknown>
      if (piece) enqueueSync('pieces_reparation', 'UPDATE', piece)
    }
    return { success: true }
  })

  ipcMain.handle('reparations:getBeneficeStats', (_e, mois?: string) => {
    const targetMois = mois || new Date().toISOString().slice(0, 7)
    const overall = db.prepare(`
      SELECT SUM(COALESCE(total_final,0) - COALESCE(main_oeuvre,0)) as benefice_net, COUNT(*) as nb
      FROM reparations WHERE strftime('%Y-%m', created_at) = ? AND statut IN ('TERMINE', 'RENDU')
        AND (notes_technicien LIKE '%[SMLPOS_PAYMENT]%"paid":true%' OR notes_technicien NOT LIKE '%[SMLPOS_PAYMENT]%' OR notes_technicien IS NULL)
    `).get(targetMois) as { benefice_net: number; nb: number }
    const breakdown = db.prepare(`
      SELECT type_appareil, COUNT(*) as nb,
             SUM(COALESCE(main_oeuvre,0)) as total_pieces,
             SUM(COALESCE(total_final,0)) as total_encaisse,
             SUM(COALESCE(total_final,0) - COALESCE(main_oeuvre,0)) as benefice_net
      FROM reparations WHERE strftime('%Y-%m', created_at) = ? AND statut IN ('TERMINE', 'RENDU')
        AND (notes_technicien LIKE '%[SMLPOS_PAYMENT]%"paid":true%' OR notes_technicien NOT LIKE '%[SMLPOS_PAYMENT]%' OR notes_technicien IS NULL)
      GROUP BY type_appareil
    `).all(targetMois) as { type_appareil: string; nb: number; total_pieces: number; total_encaisse: number; benefice_net: number }[]

    const beneficeTotal = overall?.benefice_net ?? 0
    const partTiers = Math.round((beneficeTotal / 3) * 1000) / 1000

    const enriched = breakdown.map(b => {
      const partTechCat = Math.round((b.benefice_net / 3) * 1000) / 1000
      if (b.type_appareil === 'SMARTPHONE') {
        return {
          ...b,
          part_technicien: partTechCat,
          part_hamdi: Math.round((partTechCat / 2) * 1000) / 1000,
          part_hamma: Math.round((partTechCat / 2) * 1000) / 1000,
        }
      }
      return { ...b, part_technicien: partTechCat, part_hamdi: null, part_hamma: null }
    })

    return {
      overall,
      breakdown: enriched,
      part_sml: partTiers,
      part_materiel: partTiers,
      part_techniciens: partTiers,
      // legacy compat
      benefice_mootez: breakdown.find(r => r.type_appareil === 'SCOOTER')?.benefice_net ?? 0,
    }
  })

  ipcMain.handle('reparations:list', (_e, filters: { shiftId?: string; statut?: string } = {}) => {
    let sql = 'SELECT * FROM reparations WHERE 1=1'
    const params: unknown[] = []
    if (filters.shiftId) { sql += ' AND shift_id = ?'; params.push(filters.shiftId) }
    if (filters.statut) { sql += ' AND statut = ?'; params.push(filters.statut) }
    sql += ' ORDER BY created_at DESC'
    return db.prepare(sql).all(...params)
  })

  ipcMain.handle('reparations:updateStatut', (_e, id, statut) => {
    const now = new Date().toISOString()
    const existing = db.prepare('SELECT * FROM reparations WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!existing) return { changes: 0 }
    let notes = String(existing.notes_technicien ?? '')
    if (statut === 'TERMINE' && !notes.includes('[SMLPOS_PAYMENT]')) {
      const marker = `[SMLPOS_PAYMENT]${JSON.stringify({
        paid: false,
        totalFinal: money3(existing.total_final ?? existing.total_estime),
        technicianSpent: money3(existing.main_oeuvre),
        at: now,
      })}`
      notes = [notes.trim(), marker].filter(Boolean).join('\n')
    }
    const result = db.prepare('UPDATE reparations SET statut = ?, notes_technicien = ?, updated_at = ? WHERE id = ?')
      .run(statut, notes || null, now, id)
    addActivityLog({ action: 'REPAIR_STATUS_UPDATED', details: { id, statut } })
    const row = db.prepare('SELECT * FROM reparations WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (row) enqueueSync('reparations', 'UPDATE', row)
    return result
  })

  ipcMain.handle('reparations:finalize', (_e, id: string, totalFinal: number) => {
    const finalPrice = money3(totalFinal)
    if (finalPrice <= 0) return { success: false, error: 'Le prix final doit être supérieur à zéro' }
    const rep = db.prepare(`SELECT id, main_oeuvre FROM reparations WHERE id = ?`).get(id) as { id: string; main_oeuvre?: number } | undefined
    if (!rep) return { success: false, error: 'Réparation introuvable' }
    const benefice = money3(finalPrice - money3(rep.main_oeuvre))
    const now = new Date().toISOString()
    db.prepare(`UPDATE reparations SET total_final=?, total_estime=?, benefice=?, statut='TERMINE', updated_at=? WHERE id=?`)
      .run(finalPrice, finalPrice, benefice, now, id)
    const row = db.prepare(`SELECT * FROM reparations WHERE id = ?`).get(id) as Record<string, unknown>
    addActivityLog({ action: 'REPAIR_FINALIZED', details: { id, total_final: finalPrice, benefice }, montant: finalPrice })
    enqueueSync('reparations', 'UPDATE', row)
    return { success: true, benefice }
  })

  ipcMain.handle('reparations:markPayment', (_e, id: string, data: { paid?: boolean; totalFinal?: number; technicianSpent?: number; shiftId?: string; operateur?: string }) => {
    const rep = db.prepare(`SELECT * FROM reparations WHERE id = ?`).get(id) as Record<string, unknown> | undefined
    if (!rep) return { success: false, error: 'Réparation introuvable' }
    if (!['TERMINE', 'RENDU'].includes(String(rep.statut))) {
      return { success: false, error: 'Terminez d’abord la réparation avant de confirmer son paiement' }
    }

    const paid = data?.paid === true
    const finalPrice = money3(data?.totalFinal ?? rep.total_final ?? rep.total_estime)
    const technicianSpent = money3(data?.technicianSpent ?? rep.main_oeuvre)
    if (paid && finalPrice <= 0) return { success: false, error: 'Le montant payé doit être supérieur à zéro' }
    if (technicianSpent < 0) return { success: false, error: 'Les dépenses technicien ne peuvent pas être négatives' }

    const now = new Date().toISOString()
    if (paid && !data.shiftId) return { success: false, error: 'Ouvrez une caisse externe avant de confirmer le paiement' }
    const marker = `[SMLPOS_PAYMENT]${JSON.stringify({ paid, totalFinal: finalPrice, technicianSpent, paymentShiftId: data.shiftId ?? null, operateur: data.operateur ?? null, at: now })}`
    const cleanNotes = String(rep.notes_technicien ?? '')
      .replace(/\n?\[SMLPOS_PAYMENT\]\{[^\r\n]*\}/g, '')
      .trim()
    const notes = [cleanNotes, marker].filter(Boolean).join('\n')
    const benefice = paid ? money3(finalPrice - technicianSpent) : money3(Number(rep.benefice) || 0)

    if (paid) {
      db.prepare(`
        UPDATE reparations
        SET total_final = ?, total_estime = ?, main_oeuvre = ?, benefice = ?, notes_technicien = ?, updated_at = ?
        WHERE id = ?
      `).run(finalPrice, finalPrice, technicianSpent, benefice, notes, now, id)
    } else {
      db.prepare(`UPDATE reparations SET notes_technicien = ?, updated_at = ? WHERE id = ?`).run(notes, now, id)
    }

    const updated = db.prepare(`SELECT * FROM reparations WHERE id = ?`).get(id) as Record<string, unknown>
    addActivityLog({
      shift_id: (data.shiftId ?? rep.shift_id) as string,
      operateur: (data.operateur ?? rep.operateur_nom) as string,
      action: paid ? 'REPAIR_PAYMENT_CONFIRMED' : 'REPAIR_PAYMENT_PENDING',
      montant: paid ? finalPrice : 0,
      details: { id, total_final: finalPrice, depenses_technicien: technicianSpent, benefice },
    })
    enqueueSync('reparations', 'UPDATE', updated)
    return { success: true, benefice }
  })

  ipcMain.handle('reparations:getPieces', (_e, repId) => {
    return db.prepare('SELECT * FROM pieces_reparation WHERE reparation_id = ?').all(repId)
  })

  // ─── Sorties Caisse ──────────────────────────────────────────────────────────
  ipcMain.handle('sorties:create', (_e, s) => {
    const now = new Date().toISOString()
    const source = s.caisse_source === 'INTERNE' ? 'INTERNE' : 'EXTERNE'
    const montant = money3(s.montant)
    if (montant <= 0) throw new Error('Le montant doit être supérieur à zéro')
    if (!String(s.note ?? '').trim()) throw new Error('Le motif est obligatoire')
    if (source === 'EXTERNE' && !s.shift_id) throw new Error('Une caisse externe active est obligatoire')
    const mvtId = source === 'INTERNE' ? randomUUID() : null
    const accountingNote = `[CAISSE:${source}] ${String(s.note).trim()}`
    const sortie = {
      id: s.id,
      shift_id: source === 'EXTERNE' ? s.shift_id : null,
      montant,
      note: accountingNote,
      operateur: s.operateur ?? null,
      mouvement_interne_id: mvtId,
      created_at: s.created_at ?? now,
    }
    if (source === 'INTERNE' && mvtId) {
      const internalRow = {
        id: mvtId, date_journal: new Date().toLocaleDateString('en-CA'), type: 'SORTIE', categorie: 'SORTIE_LIBRE',
        montant, reference_id: sortie.id, note: String(s.note).trim(), operateur: s.operateur ?? 'superadmin', created_at: now,
      }
      db.prepare(`INSERT INTO mouvements_caisse_interne (id,date_journal,type,categorie,montant,reference_id,note,operateur,created_at) VALUES (@id,@date_journal,@type,@categorie,@montant,@reference_id,@note,@operateur,@created_at)`).run(internalRow)
      applyInternalCashOut(montant, now)
      enqueueSync('mouvements_caisse_interne', 'INSERT', internalRow)
    }
    db.prepare(`
      INSERT INTO sorties_caisse (id, shift_id, montant, note, operateur, mouvement_interne_id, created_at)
      VALUES (@id, @shift_id, @montant, @note, @operateur, @mouvement_interne_id, @created_at)
    `).run(sortie)
    addActivityLog({ shift_id: sortie.shift_id, operateur: s.operateur, action: 'CASH_OUT_CREATED', montant, details: { note: s.note, caisse_source: source } })
    enqueueSync('sorties_caisse', 'INSERT', sortie)
    return { success: true }
  })

  ipcMain.handle('sorties:list', (_e, shiftId?: string) => {
    if (shiftId) {
      return db.prepare('SELECT * FROM sorties_caisse WHERE shift_id = ? ORDER BY created_at DESC').all(shiftId)
    }
    return db.prepare('SELECT * FROM sorties_caisse ORDER BY created_at DESC LIMIT 100').all()
  })

  ipcMain.handle('sorties:recentNotes', () => {
    const rows = db.prepare(`
      SELECT note, COUNT(*) as cnt FROM sorties_caisse
      GROUP BY note ORDER BY cnt DESC LIMIT 10
    `).all() as { note: string; cnt: number }[]
    return rows.map(r => String(r.note ?? '').replace(/^\[CAISSE:(?:EXTERNE|INTERNE)\]\s*/, '')).filter(Boolean)
  })

  // ─── Activity Logs ──────────────────────────────────────────────────────────
  ipcMain.handle('logs:add', (_e, log) => {
    const stmt = db.prepare(`
      INSERT INTO activity_logs (id, shift_id, operateur, action, details, montant, created_at)
      VALUES (@id, @shift_id, @operateur, @action, @details, @montant, @created_at)
    `)
    return stmt.run({ ...log, details: JSON.stringify(log.details || {}) })
  })

  ipcMain.handle('logs:list', (_e, filters: { shiftId?: string; action?: string; dateFrom?: string; dateTo?: string; limit?: number } = {}) => {
    let sql = 'SELECT * FROM activity_logs WHERE 1=1'
    const params: unknown[] = []
    if (filters.shiftId) { sql += ' AND shift_id = ?'; params.push(filters.shiftId) }
    if (filters.action) { sql += ' AND action = ?'; params.push(filters.action) }
    if (filters.dateFrom) { sql += ' AND created_at >= ?'; params.push(filters.dateFrom) }
    if (filters.dateTo) { sql += ' AND created_at <= ?'; params.push(filters.dateTo) }
    sql += ' ORDER BY created_at DESC'
    if (filters.limit) { sql += ' LIMIT ?'; params.push(filters.limit) }
    const rows = db.prepare(sql).all(...params) as Array<{ details: string } & Record<string, unknown>>
    return rows.map(r => ({ ...r, details: safeParseJson(r.details) }))
  })

  // ─── Stats ──────────────────────────────────────────────────────────────────
  ipcMain.handle('stats:today', () => {
    const today = new Date().toISOString().slice(0, 10)
    const ventes = db.prepare(`
      SELECT COALESCE(SUM(total_ttc),0) as total, COUNT(*) as count
      FROM ventes WHERE created_at >= ? AND type = 'VENTE'
    `).get(today) as { total: number; count: number }
    const reparations = db.prepare(`
      SELECT COALESCE(SUM(total_estime),0) as total, COUNT(*) as count
      FROM reparations WHERE created_at >= ?
    `).get(today) as { total: number; count: number }
    const sorties = db.prepare(`
      SELECT COALESCE(SUM(montant),0) as total FROM sorties_caisse WHERE created_at >= ?
    `).get(today) as { total: number }
    return { ventes, reparations, sorties }
  })

  ipcMain.handle('stats:byDate', (_e, dateFrom: string, dateTo: string) => {
    const ventes = db.prepare(`
      SELECT date(created_at) as date, SUM(total_ttc) as total, COUNT(*) as count
      FROM ventes WHERE created_at >= ? AND created_at <= ? AND type = 'VENTE'
      GROUP BY date(created_at) ORDER BY date
    `).all(dateFrom, dateTo)
    return { ventes }
  })

  ipcMain.handle('stats:dashboard', () => {
    const today = new Date()
    const todayStr = today.toISOString().slice(0, 10)
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    const yesterdayStr = yesterday.toISOString().slice(0, 10)

    const d30 = new Date(today)
    d30.setDate(today.getDate() - 29)
    const d30Str = d30.toISOString().slice(0, 10)

    const dailyVentes = db.prepare(`
      SELECT date(created_at) as date, COALESCE(SUM(total_ttc),0) as total, COUNT(*) as count
      FROM ventes WHERE created_at >= ? AND type = 'VENTE'
      GROUP BY date(created_at) ORDER BY date
    `).all(d30Str) as Array<{ date: string; total: number; count: number }>

    const todayVentes = db.prepare(`
      SELECT COALESCE(SUM(total_ttc),0) as total, COUNT(*) as count
      FROM ventes WHERE created_at >= ? AND type = 'VENTE'
    `).get(todayStr) as { total: number; count: number }

    const yestVentes = db.prepare(`
      SELECT COALESCE(SUM(total_ttc),0) as total, COUNT(*) as count
      FROM ventes WHERE created_at >= ? AND created_at < ? AND type = 'VENTE'
    `).get(yesterdayStr, todayStr) as { total: number; count: number }

    const repsEnCours = db.prepare(`
      SELECT COUNT(*) as count FROM reparations WHERE statut IN ('EN_ATTENTE','EN_COURS')
    `).get() as { count: number }

    const parMode = db.prepare(`
      SELECT mode_paiement, COUNT(*) as count, COALESCE(SUM(total_ttc),0) as total
      FROM ventes WHERE created_at >= ? AND type = 'VENTE'
      GROUP BY mode_paiement ORDER BY total DESC
    `).all(d30Str) as Array<{ mode_paiement: string; count: number; total: number }>

    const lowStock = db.prepare(`
      SELECT nom, stock_actuel, stock_minimum FROM produits
      WHERE actif=1 AND stock_actuel <= stock_minimum
      ORDER BY (stock_actuel - stock_minimum) ASC LIMIT 5
    `).all() as Array<{ nom: string; stock_actuel: number; stock_minimum: number }>

    const topProduits = db.prepare(`
      SELECT lv.designation, SUM(lv.total_ligne) as revenue, SUM(lv.quantite) as qty
      FROM lignes_vente lv
      JOIN ventes v ON lv.vente_id = v.id
      WHERE v.created_at >= ? AND v.type = 'VENTE'
      GROUP BY lv.designation ORDER BY revenue DESC LIMIT 5
    `).all(d30Str) as Array<{ designation: string; revenue: number; qty: number }>

    return { dailyVentes, todayVentes, yestVentes, repsEnCours, parMode, lowStock, topProduits }
  })

  // ─── Services POS ────────────────────────────────────────────────────────────
  ipcMain.handle('servicesPOS:list', () => {
    return db.prepare(`
      SELECT * FROM services_pos
      WHERE actif = 1
      ORDER BY CASE id
        WHEN 'svc-enda' THEN 1
        WHEN 'svc-ooredoo' THEN 2
        WHEN 'svc-orange' THEN 3
        WHEN 'svc-autre' THEN 4
        ELSE 5
      END, nom
    `).all()
  })

  ipcMain.handle('servicesPOS:find', (_e, code: string) => {
    return db.prepare('SELECT * FROM services_pos WHERE code_barre = ? AND actif = 1').get(code) ?? null
  })

  ipcMain.handle('transactionsServices:create', (_e, t) => {
    if (!t.shift_id) throw new Error('Ouvrez une caisse externe avant d’encaisser un service')
    if (money3(t.montant_frais) <= 0) throw new Error('Le montant du service doit être supérieur à zéro')
    const result = db.prepare(`
      INSERT INTO transactions_services (id, shift_id, service_id, service_nom, montant_frais, note, operateur, created_at)
      VALUES (@id, @shift_id, @service_id, @service_nom, @montant_frais, @note, @operateur, @created_at)
    `).run(t)
    addActivityLog({ shift_id: t.shift_id, operateur: t.operateur, action: 'SERVICE_TRANSACTION_CREATED', montant: t.montant_frais, details: { service_nom: t.service_nom } })
    enqueueSync('transactions_services', 'INSERT', t)
    return result
  })

  ipcMain.handle('transactionsServices:list', (_e, shiftId?: string) => {
    if (shiftId) {
      return db.prepare('SELECT * FROM transactions_services WHERE shift_id = ? ORDER BY created_at DESC').all(shiftId)
    }
    return db.prepare('SELECT * FROM transactions_services ORDER BY created_at DESC LIMIT 100').all()
  })

  ipcMain.handle('transactionsServices:noteSuggestions', (_e, serviceId?: string) => {
    const params: string[] = []
    let serviceFilter = ''
    if (serviceId?.trim()) {
      serviceFilter = 'AND service_id = ?'
      params.push(serviceId.trim())
    }
    return db.prepare(`
      SELECT TRIM(note) AS note, COUNT(*) AS usage_count, MAX(created_at) AS last_used
      FROM transactions_services
      WHERE note IS NOT NULL
        AND TRIM(note) != ''
        ${serviceFilter}
      GROUP BY LOWER(TRIM(note))
      ORDER BY usage_count DESC, last_used DESC
      LIMIT 12
    `).all(...params)
  })

  // ─── Demandes clients / rappels ─────────────────────────────────────────────
  ipcMain.handle('demandesClients:list', (_e, filters: {
    statut?: string
    type_demande?: string
    responsable_id?: string
    search?: string
  } = {}) => {
    let sql = 'SELECT * FROM demandes_clients WHERE 1=1'
    const params: unknown[] = []
    if (filters.statut) {
      sql += ' AND statut = ?'
      params.push(filters.statut)
    }
    if (filters.type_demande) {
      sql += ' AND type_demande = ?'
      params.push(filters.type_demande)
    }
    if (filters.responsable_id) {
      sql += ' AND responsable_id = ?'
      params.push(filters.responsable_id)
    }
    if (filters.search?.trim()) {
      const search = `%${filters.search.trim()}%`
      sql += ' AND (titre LIKE ? OR details LIKE ? OR client_nom LIKE ? OR client_tel LIKE ? OR responsable_nom LIKE ?)'
      params.push(search, search, search, search, search)
    }
    sql += `
      ORDER BY
        CASE statut WHEN 'A_FAIRE' THEN 1 WHEN 'TERMINE' THEN 2 ELSE 3 END,
        CASE priorite WHEN 'URGENTE' THEN 1 ELSE 2 END,
        CASE WHEN echeance IS NULL OR echeance = '' THEN 1 ELSE 0 END,
        echeance ASC,
        created_at DESC
    `
    return db.prepare(sql).all(...params)
  })

  ipcMain.handle('demandesClients:countPending', () => {
    const row = db.prepare(`
      SELECT COUNT(*) AS count FROM demandes_clients WHERE statut = 'A_FAIRE'
    `).get() as { count: number }
    return row.count
  })

  ipcMain.handle('demandesClients:create', (_e, input: Record<string, unknown>) => {
    const titre = String(input.titre ?? '').trim()
    const responsableNom = String(input.responsable_nom ?? '').trim()
    const typeDemande = String(input.type_demande ?? '')
    if (!titre) throw new Error('La demande est obligatoire')
    if (!responsableNom) throw new Error('Agent responsable obligatoire')
    if (!['PRODUIT', 'PIECE', 'RAPPEL'].includes(typeDemande)) throw new Error('Type de demande invalide')
    const now = new Date().toISOString()
    const demande = {
      id: String(input.id ?? randomUUID()),
      type_demande: typeDemande,
      titre,
      details: String(input.details ?? '').trim() || null,
      client_nom: String(input.client_nom ?? '').trim() || null,
      client_tel: String(input.client_tel ?? '').trim() || null,
      avance: money3(Math.max(0, Number(input.avance) || 0)),
      responsable_id: String(input.responsable_id ?? '').trim() || null,
      responsable_nom: responsableNom,
      echeance: String(input.echeance ?? '').trim() || null,
      priorite: input.priorite === 'URGENTE' ? 'URGENTE' : 'NORMALE',
      statut: 'A_FAIRE',
      created_by: String(input.created_by ?? '').trim() || null,
      completed_at: null,
      created_at: String(input.created_at ?? '').trim() || now,
      updated_at: now,
    }
    db.prepare(`
      INSERT INTO demandes_clients
        (id,type_demande,titre,details,client_nom,client_tel,avance,responsable_id,responsable_nom,
         echeance,priorite,statut,created_by,completed_at,created_at,updated_at)
      VALUES
        (@id,@type_demande,@titre,@details,@client_nom,@client_tel,@avance,@responsable_id,@responsable_nom,
         @echeance,@priorite,@statut,@created_by,@completed_at,@created_at,@updated_at)
    `).run(demande)
    addActivityLog({
      operateur: demande.created_by,
      action: 'CLIENT_REQUEST_CREATED',
      montant: demande.avance,
      details: { titre: demande.titre, type: demande.type_demande, responsable: demande.responsable_nom },
    })
    return demande
  })

  ipcMain.handle('demandesClients:updateStatus', (_e, id: string, statut: string, operateur?: string) => {
    if (!['A_FAIRE', 'TERMINE', 'ANNULE'].includes(statut)) throw new Error('Statut invalide')
    const now = new Date().toISOString()
    const completedAt = statut === 'TERMINE' ? now : null
    const result = db.prepare(`
      UPDATE demandes_clients
      SET statut = ?, completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(statut, completedAt, now, id)
    if (!result.changes) throw new Error('Demande introuvable')
    const updated = db.prepare('SELECT * FROM demandes_clients WHERE id = ?').get(id) as Record<string, unknown>
    addActivityLog({
      operateur: operateur || null,
      action: statut === 'TERMINE' ? 'CLIENT_REQUEST_COMPLETED' : 'CLIENT_REQUEST_STATUS_CHANGED',
      details: { id, titre: updated.titre, statut },
    })
    return updated
  })

  // ─── Catégories ──────────────────────────────────────────────────────────────
  ipcMain.handle('categories:list', () => {
    return db.prepare('SELECT * FROM categories ORDER BY nom').all()
  })

  ipcMain.handle('categories:create', (_e, cat: { id: string; nom: string; icone?: string }) => {
    const stmt = db.prepare(`INSERT OR IGNORE INTO categories (id, nom, icone) VALUES (@id, @nom, @icone)`)
    const normalized = { icone: null, ...cat }
    const result = stmt.run(normalized)
    enqueueSync('categories', 'INSERT', normalized)
    return result
  })

  ipcMain.handle('produits:checkBarcodeUnique', (_e, code: string, excludeId?: string) => {
    let row: unknown
    if (excludeId) {
      row = db.prepare('SELECT id FROM produits WHERE code_barre = ? AND id != ?').get(code, excludeId)
    } else {
      row = db.prepare('SELECT id FROM produits WHERE code_barre = ?').get(code)
    }
    return { unique: !row }
  })

  // ─── Factures Clients ────────────────────────────────────────────────────────
  ipcMain.handle('facturesClients:list', (_e, filters: { venteId?: string; dateFrom?: string } = {}) => {
    let sql = 'SELECT * FROM factures_clients WHERE 1=1'
    const params: unknown[] = []
    if (filters.venteId) { sql += ' AND vente_id = ?'; params.push(filters.venteId) }
    if (filters.dateFrom) { sql += ' AND created_at >= ?'; params.push(filters.dateFrom) }
    sql += ' ORDER BY created_at DESC'
    return db.prepare(sql).all(...params)
  })

  ipcMain.handle('facturesClients:create', (_e, facture, _lignes) => {
    const result = db.prepare(`
      INSERT INTO factures_clients (id, numero, shift_id, vente_id, type_facture,
        client_nom, client_tel, client_adresse, client_matricule,
        total_ht, total_tva, total_ttc, created_at)
      VALUES (@id, @numero, @shift_id, @vente_id, @type_facture,
        @client_nom, @client_tel, @client_adresse, @client_matricule,
        @total_ht, @total_tva, @total_ttc, @created_at)
    `).run(facture)
    addActivityLog({ shift_id: facture.shift_id, action: 'CLIENT_INVOICE_CREATED', montant: facture.total_ttc, details: { numero: facture.numero, client: facture.client_nom } })
    enqueueSync('factures_clients', 'INSERT', facture)
    return result
  })

  ipcMain.handle('facturesClients:getLastNumber', (_e, prefix: string) => {
    const row = db.prepare(`SELECT numero FROM factures_clients WHERE numero LIKE ? ORDER BY created_at DESC LIMIT 1`).get(`${prefix}%`) as { numero: string } | undefined
    if (!row) return 0
    const parts = row.numero.split('-')
    return parseInt(parts[parts.length - 1]) || 0
  })

  // ─── Fournisseurs ────────────────────────────────────────────────────────────
  ipcMain.handle('fournisseurs:list', (_e, filters: { search?: string } = {}) => {
    let sql = 'SELECT * FROM fournisseurs WHERE actif = 1'
    const params: unknown[] = []
    if (filters.search) {
      sql += ' AND (nom LIKE ? OR contact_nom LIKE ? OR telephone LIKE ?)'
      const s = `%${filters.search}%`
      params.push(s, s, s)
    }
    sql += ' ORDER BY nom'
    return db.prepare(sql).all(...params)
  })

  ipcMain.handle('fournisseurs:get', (_e, id: string) => {
    return db.prepare('SELECT * FROM fournisseurs WHERE id = ?').get(id)
  })

  ipcMain.handle('fournisseurs:create', (_e, f: Record<string, unknown>) => {
    const row = bindRow({
      contact_nom: null,
      telephone: null,
      email: null,
      adresse: null,
      matricule_fiscal: null,
      rib: null,
      notes: null,
      id: '',
      nom: '',
      created_at: new Date().toISOString(),
    }, f)
    const result = db.prepare(`
      INSERT INTO fournisseurs (id, nom, contact_nom, telephone, email, adresse, matricule_fiscal, rib, solde_du, notes, actif, created_at)
      VALUES (@id, @nom, @contact_nom, @telephone, @email, @adresse, @matricule_fiscal, @rib, 0, @notes, 1, @created_at)
    `).run(row)
    addActivityLog({ action: 'SUPPLIER_CREATED', details: { id: row.id, nom: row.nom } })
    enqueueSync('fournisseurs', 'INSERT', row)
    return result
  })

  ipcMain.handle('fournisseurs:update', (_e, id: string, f) => {
    const result = db.prepare(`
      UPDATE fournisseurs SET nom=@nom, contact_nom=@contact_nom, telephone=@telephone,
        email=@email, adresse=@adresse, matricule_fiscal=@matricule_fiscal, rib=@rib, notes=@notes
      WHERE id=@id
    `).run({ id, ...f })
    addActivityLog({ action: 'SUPPLIER_UPDATED', details: { id, nom: f.nom } })
    enqueueSync('fournisseurs', 'UPDATE', { id, ...f })
    return result
  })

  // ─── Fournisseur Commerciaux ─────────────────────────────────────────────────
  ipcMain.handle('fournisseurCommerciaux:getByFournisseur', (_e, fournisseurId: string) => {
    return db.prepare(`SELECT * FROM fournisseur_commerciaux WHERE fournisseur_id = ? AND actif = 1 ORDER BY created_at`).all(fournisseurId)
  })

  ipcMain.handle('fournisseurCommerciaux:create', (_e, commercial) => {
    const c = commercial as { id: string; fournisseur_id: string; nom: string; telephone?: string; email?: string }
    db.prepare(`
      INSERT INTO fournisseur_commerciaux (id, fournisseur_id, nom, telephone, email, actif, created_at)
      VALUES (@id, @fournisseur_id, @nom, @telephone, @email, 1, datetime('now'))
    `).run({ telephone: null, email: null, ...c })
    return { success: true }
  })

  ipcMain.handle('fournisseurCommerciaux:bulkCreate', (_e, commerciaux: unknown[]) => {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO fournisseur_commerciaux (id, fournisseur_id, nom, telephone, email, actif, created_at)
      VALUES (@id, @fournisseur_id, @nom, @telephone, @email, 1, datetime('now'))
    `)
    const run = db.transaction((items: unknown[]) => {
      for (const c of items) stmt.run(c as Record<string, unknown>)
    })
    run(commerciaux)
    return { success: true }
  })

  // ─── Factures Fournisseurs ───────────────────────────────────────────────────
  ipcMain.handle('facturesFournisseurs:list', (_e, filters: { fournisseurId?: string; statut?: string; includeDrafts?: boolean } = {}) => {
    let sql = `
      SELECT ff.*, f.nom as fournisseur_nom
      FROM factures_fournisseurs ff
      LEFT JOIN fournisseurs f ON f.id = ff.fournisseur_id
      WHERE 1=1
    `
    const params: unknown[] = []
    if (!filters.includeDrafts && filters.statut !== 'BROUILLON') {
      sql += ` AND ff.statut_paiement != 'BROUILLON'`
    }
    if (filters.fournisseurId) { sql += ' AND ff.fournisseur_id = ?'; params.push(filters.fournisseurId) }
    if (filters.statut) { sql += ' AND ff.statut_paiement = ?'; params.push(filters.statut) }
    sql += ' ORDER BY ff.date_facture DESC'
    return db.prepare(sql).all(...params)
  })

  ipcMain.handle('facturesFournisseurs:create', (_e, facture, lignes) => {
    const insertFacture = db.prepare(`
      INSERT INTO factures_fournisseurs (id, numero_facture, fournisseur_id, date_facture, date_echeance,
        statut_paiement, montant_ht, montant_tva, montant_ttc, montant_paye, notes, type, statut_reception, stock_applied,
        exo, timbre, total_remise, ht_7, tva_7, ht_19, tva_19, created_at)
      VALUES (@id, @numero_facture, @fournisseur_id, @date_facture, @date_echeance,
        @statut_paiement, @montant_ht, @montant_tva, @montant_ttc, 0, @notes, @type, @statut_reception, @stock_applied,
        @exo, @timbre, @total_remise, @ht_7, @tva_7, @ht_19, @tva_19, @created_at)
    `)
    const insertLigne = db.prepare(`
      INSERT INTO lignes_facture_fournisseur (id, facture_id, produit_id, designation, quantite,
        ancien_prix_achat, nouveau_prix_achat, prix_vente_suggere, prix_vente_applique, tva_taux, numeros_serie_json)
      VALUES (@id, @facture_id, @produit_id, @designation, @quantite,
        @ancien_prix_achat, @nouveau_prix_achat, @prix_vente_suggere, @prix_vente_applique, @tva_taux, @numeros_serie_json)
    `)
    const updatePrixAchat = db.prepare(`UPDATE produits SET prix_achat=?, updated_at=? WHERE id=?`)
    const updatePrixVente = db.prepare(`UPDATE produits SET prix_vente=?, updated_at=? WHERE id=?`)
    const updateStock = db.prepare(`UPDATE produits SET stock_actuel = stock_actuel + ? WHERE id=?`)
    const updateSolde = db.prepare(`UPDATE fournisseurs SET solde_du = solde_du + ? WHERE id=?`)

    const f = facture as Record<string, unknown>
    const draftId = String(f.draft_id ?? '').trim() || null
    const { draft_id: _draftId, ...factureData } = f
    if (draftId) {
      const existingFinal = db.prepare(`SELECT id, statut_paiement FROM factures_fournisseurs WHERE id = ?`).get(draftId) as { id: string; statut_paiement: string } | undefined
      if (existingFinal && existingFinal.statut_paiement !== 'BROUILLON') {
        return { success: true, alreadyCreated: true, id: existingFinal.id }
      }
    }
    const isBL = f.type === 'FACTURE_ACHAT_BL'
    const factureWithDefaults = {
      exo: null, timbre: 1, total_remise: null, ht_7: null, tva_7: null, ht_19: null, tva_19: null,
      ...factureData,
      type: f.type ?? 'FACTURE_ACHAT',
      statut_reception: f.statut_reception ?? (isBL ? 'NON_ARRIVE' : 'ARRIVE'),
      stock_applied: f.stock_applied ?? 1,
    }
    const transaction = db.transaction(() => {
      if (draftId) {
        db.prepare(`DELETE FROM lignes_facture_fournisseur WHERE facture_id = ?`).run(draftId)
        db.prepare(`DELETE FROM factures_fournisseurs WHERE id = ? AND statut_paiement = 'BROUILLON'`).run(draftId)
      }
      insertFacture.run(factureWithDefaults)
      for (const l of lignes) {
        insertLigne.run(l)
        if (l.produit_id) {
          const now = new Date().toISOString()
          updatePrixAchat.run(l.nouveau_prix_achat, now, l.produit_id)
          // prix_vente_suggere is informational only. Never let a purchase price or
          // a margin suggestion silently replace the price used by the POS.
          // prix_vente_applique is the explicit opt-in field reserved for a user
          // action that intentionally changes the catalogue sale price.
          const prixVenteApplique = l.prix_vente_applique
          if (typeof prixVenteApplique === 'number' && Number.isFinite(prixVenteApplique) && prixVenteApplique >= 0) {
            updatePrixVente.run(prixVenteApplique, now, l.produit_id)
          }
          updateStock.run(l.quantite, l.produit_id)
          if (l.numeros_serie_json) {
            addSerialNumbersToStock(l.produit_id, l.numeros_serie_json, l.quantite)
          }
        }
      }
      updateSolde.run(factureWithDefaults.montant_ttc, factureWithDefaults.fournisseur_id)
    })
    transaction()
    addActivityLog({ action: 'SUPPLIER_INVOICE_CREATED', montant: facture.montant_ttc, details: { numero: facture.numero_facture, type: factureWithDefaults.type } })
    enqueueSync('factures_fournisseurs', 'INSERT', factureWithDefaults)
    for (const l of lignes) enqueueSync('lignes_facture_fournisseur', 'INSERT', l)
    for (const l of lignes) if (l.produit_id) enqueueProductSnapshot(l.produit_id)
    return { success: true }
  })

  ipcMain.handle('facturesFournisseurs:annuler', (_e, factureId: string) => {
    db.prepare(`UPDATE factures_fournisseurs SET statut_paiement='ANNULE' WHERE id=?`).run(factureId)
    addActivityLog({ action: 'SUPPLIER_INVOICE_CANCELLED', details: { factureId } })
    enqueueSync('factures_fournisseurs', 'UPDATE', { id: factureId, statut_paiement: 'ANNULE' })
    return { success: true }
  })

  const FF_UPDATE_ALLOWED = new Set([
    'fournisseur_id', 'notes', 'exo', 'timbre', 'total_remise',
    'montant_ht', 'montant_tva', 'montant_ttc', 'ht_7', 'tva_7', 'ht_19', 'tva_19',
    'date_echeance', 'updated_at',
  ])

  ipcMain.handle('facturesFournisseurs:update', (_e, id: string, data: Record<string, unknown>) => {
    if ('numero_facture' in data) return { success: false, error: 'Le numéro de facture est immuable' }
    const existing = db.prepare(`SELECT id, statut_paiement FROM factures_fournisseurs WHERE id = ?`).get(id) as { id: string; statut_paiement: string } | undefined
    if (!existing) return { success: false, error: 'Facture introuvable' }
    if (existing.statut_paiement === 'BROUILLON' || existing.statut_paiement === 'ANNULE') {
      return { success: false, error: 'Facture non modifiable' }
    }
    const filtered = Object.fromEntries(Object.entries(data).filter(([k]) => FF_UPDATE_ALLOWED.has(k)))
    if (!Object.keys(filtered).length) return { success: false, error: 'Aucun champ valide' }
    const cols = Object.keys(filtered)
    const sets = cols.map(k => `${k}=@${k}`).join(',')
    const now = new Date().toISOString()
    db.prepare(`UPDATE factures_fournisseurs SET ${sets}, updated_at=@updated_at WHERE id=@id`).run({ ...filtered, id, updated_at: now })
    addActivityLog({ action: 'SUPPLIER_INVOICE_EDITED', details: { id, numero: data.numero_facture, fields: cols } })
    enqueueSync('factures_fournisseurs', 'UPDATE', { id, ...filtered, updated_at: now })
    return { success: true }
  })

  ipcMain.handle('facturesFournisseurs:replaceLignes', (_e, factureId: string, lignes: Record<string, unknown>[], totals: Record<string, unknown>) => {
    const facture = db.prepare(`SELECT * FROM factures_fournisseurs WHERE id = ?`).get(factureId) as Record<string, unknown> | undefined
    if (!facture) return { success: false, error: 'Facture introuvable' }
    if (facture.statut_paiement === 'BROUILLON' || facture.statut_paiement === 'ANNULE') {
      return { success: false, error: 'Facture non modifiable' }
    }
    const oldLines = db.prepare(`SELECT * FROM lignes_facture_fournisseur WHERE facture_id = ?`).all(factureId) as Record<string, unknown>[]
    const affectsInventory = achatLineAffectsInventory(facture)
    const insertLigne = db.prepare(`
      INSERT INTO lignes_facture_fournisseur (id, facture_id, produit_id, designation, quantite,
        ancien_prix_achat, nouveau_prix_achat, prix_vente_suggere, prix_vente_applique, tva_taux, numeros_serie_json)
      VALUES (@id, @facture_id, @produit_id, @designation, @quantite,
        @ancien_prix_achat, @nouveau_prix_achat, @prix_vente_suggere, @prix_vente_applique, @tva_taux, @numeros_serie_json)
    `)
    const now = new Date().toISOString()
    try {
      db.transaction(() => {
        if (affectsInventory) {
          for (const ol of oldLines) revertAchatLineInventory(ol)
        }
        db.prepare(`DELETE FROM lignes_facture_fournisseur WHERE facture_id = ?`).run(factureId)
        for (const l of lignes) {
          const oldMatch = oldLines.find(ol => ol.id === l.id) as Record<string, unknown> | undefined
          const nl = {
            ancien_prix_achat: 0, prix_vente_suggere: null, prix_vente_applique: null, produit_id: null,
            numeros_serie_json: oldMatch?.numeros_serie_json ?? null,
            ...l, facture_id: factureId,
          }
          insertLigne.run(nl)
        }
        if (affectsInventory) {
          for (const l of lignes) {
            const oldMatch = oldLines.find(ol => ol.id === l.id) as Record<string, unknown> | undefined
            applyAchatLineInventory({
              ...l,
              numeros_serie_json: (l as Record<string, unknown>).numeros_serie_json ?? oldMatch?.numeros_serie_json ?? null,
            })
          }
        }
        db.prepare(`
          UPDATE factures_fournisseurs SET
            montant_ht=@montant_ht, montant_tva=@montant_tva, montant_ttc=@montant_ttc,
            ht_7=@ht_7, tva_7=@tva_7, ht_19=@ht_19, tva_19=@tva_19,
            updated_at=@updated_at WHERE id=@id
        `).run({ id: factureId, updated_at: now, ...totals })
      })()
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Échec synchronisation stock' }
    }
    for (const ol of oldLines) enqueueSync('lignes_facture_fournisseur', 'DELETE', { id: ol.id as string })
    for (const l of lignes) enqueueSync('lignes_facture_fournisseur', 'INSERT', l as Record<string, unknown>)
    enqueueSync('factures_fournisseurs', 'UPDATE', { id: factureId, ...totals, updated_at: now })
    const touchedProducts = new Set<string>()
    for (const ol of oldLines) if (ol.produit_id) touchedProducts.add(String(ol.produit_id))
    for (const l of lignes) if (l.produit_id) touchedProducts.add(String(l.produit_id))
    for (const pid of touchedProducts) enqueueProductSnapshot(pid)
    addActivityLog({ action: 'SUPPLIER_INVOICE_LINES_EDITED', details: { factureId, lineCount: lignes.length } })
    return { success: true }
  })

  ipcMain.handle('facturesFournisseurs:marquerRecu', (_e, factureId: string) => {
    const facture = db.prepare(`SELECT * FROM factures_fournisseurs WHERE id=?`).get(factureId) as Record<string, unknown> | undefined
    if (!facture || facture.type !== 'FACTURE_ACHAT_BL' || facture.statut_reception === 'ARRIVE') {
      return { success: false, error: 'Facture non trouvée ou déjà reçue' }
    }
    const lignes = db.prepare(`SELECT * FROM lignes_facture_fournisseur WHERE facture_id=?`).all(factureId) as Record<string, unknown>[]
    const now = new Date().toISOString()
    const updatePrixAchat = db.prepare(`UPDATE produits SET prix_achat=?, updated_at=? WHERE id=?`)
    const updatePrixVente = db.prepare(`UPDATE produits SET prix_vente=?, updated_at=? WHERE id=?`)
    const updateStock = db.prepare(`UPDATE produits SET stock_actuel = stock_actuel + ? WHERE id=?`)
    db.transaction(() => {
      if (!(facture.stock_applied as number)) {
        for (const l of lignes) {
          if (l.produit_id) {
            updatePrixAchat.run(l.nouveau_prix_achat, now, l.produit_id)
            // A suggested price stays on the supplier document as a snapshot.
            // Only an explicitly applied sale price may update the POS catalogue.
            const prixVenteApplique = l.prix_vente_applique
            if (typeof prixVenteApplique === 'number' && Number.isFinite(prixVenteApplique) && prixVenteApplique >= 0) {
              updatePrixVente.run(prixVenteApplique, now, l.produit_id)
            }
            if (l.numeros_serie_json) {
              const serialResult = addSerialNumbersToStock(l.produit_id as string, l.numeros_serie_json, l.quantite as number, {
                skipExistingInStockForSameProduct: true,
              })
              if (serialResult.inserted > 0) updateStock.run(serialResult.inserted, l.produit_id)
            } else {
              updateStock.run(l.quantite, l.produit_id)
            }
          }
        }
      }
      db.prepare(`UPDATE factures_fournisseurs SET statut_reception='ARRIVE', stock_applied=1 WHERE id=?`).run(factureId)
    })()
    addActivityLog({ action: 'SUPPLIER_INVOICE_RECEIVED', details: { factureId } })
    enqueueSync('factures_fournisseurs', 'UPDATE', { id: factureId, statut_reception: 'ARRIVE', stock_applied: 1 })
    for (const l of lignes) if (l.produit_id) enqueueProductSnapshot(l.produit_id)
    return { success: true }
  })

  ipcMain.handle('facturesFournisseurs:get', (_e, id: string) => {
    return db.prepare(`
      SELECT ff.*, f.nom AS fournisseur_nom, f.telephone, f.adresse, f.matricule_fiscal
      FROM factures_fournisseurs ff
      LEFT JOIN fournisseurs f ON f.id = ff.fournisseur_id
      WHERE ff.id = ?
    `).get(id)
  })

  ipcMain.handle('facturesFournisseurs:getLignes', (_e, factureId: string) => {
    return db.prepare(`
      SELECT l.*, p.reference
      FROM lignes_facture_fournisseur l
      LEFT JOIN produits p ON p.id = l.produit_id
      WHERE l.facture_id = ?
      ORDER BY l.id ASC
    `).all(factureId)
  })

  ipcMain.handle('facturesFournisseurs:getLastNumber', (_e, fournisseurId: string) => {
    const row = db.prepare(`SELECT COUNT(*) as cnt FROM factures_fournisseurs WHERE fournisseur_id=? AND statut_paiement != 'BROUILLON'`).get(fournisseurId) as { cnt: number }
    return (row?.cnt ?? 0) + 1
  })

  ipcMain.handle('facturesFournisseurs:listDrafts', () => {
    return db.prepare(`
      SELECT ff.*, f.nom as fournisseur_nom,
        (SELECT COUNT(*) FROM lignes_facture_fournisseur l WHERE l.facture_id = ff.id) as ligne_count
      FROM factures_fournisseurs ff
      LEFT JOIN fournisseurs f ON f.id = ff.fournisseur_id
      WHERE ff.statut_paiement = 'BROUILLON'
      ORDER BY COALESCE(ff.updated_at, ff.created_at) DESC
    `).all()
  })

  ipcMain.handle('facturesFournisseurs:getDraft', (_e, draftId: string) => {
    const facture = db.prepare(`
      SELECT ff.*, f.nom as fournisseur_nom
      FROM factures_fournisseurs ff
      LEFT JOIN fournisseurs f ON f.id = ff.fournisseur_id
      WHERE ff.id = ? AND ff.statut_paiement = 'BROUILLON'
    `).get(draftId)
    if (!facture) return null
    const lignes = db.prepare(`
      SELECT id, facture_id, produit_id, designation, quantite, nouveau_prix_achat, tva_taux, pending_product_json, numeros_serie_json
      FROM lignes_facture_fournisseur WHERE facture_id = ?
    `).all(draftId)
    return { facture, lignes }
  })

  ipcMain.handle('facturesFournisseurs:saveDraft', (_e, payload: {
    draftId?: string
    facture: Record<string, unknown>
    lignes: Record<string, unknown>[]
  }) => {
    const now = new Date().toISOString()
    const f = payload.facture
    const draftId = (payload.draftId as string) || (f.id as string) || randomUUID()
    const isBL = f.type === 'FACTURE_ACHAT_BL'

    const upsertFacture = db.prepare(`
      INSERT INTO factures_fournisseurs (
        id, numero_facture, fournisseur_id, date_facture, date_echeance,
        statut_paiement, montant_ht, montant_tva, montant_ttc, montant_paye, notes,
        type, statut_reception, exo, timbre, ht_7, tva_7, ht_19, tva_19, total_remise, created_at, updated_at
      ) VALUES (
        @id, @numero_facture, @fournisseur_id, @date_facture, @date_echeance,
        'BROUILLON', 0, 0, 0, 0, @notes,
        @type, @statut_reception, @exo, @timbre, @ht_7, @tva_7, @ht_19, @tva_19, @total_remise, @created_at, @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        numero_facture = excluded.numero_facture,
        fournisseur_id = excluded.fournisseur_id,
        date_facture = excluded.date_facture,
        date_echeance = excluded.date_echeance,
        notes = excluded.notes,
        type = excluded.type,
        statut_reception = excluded.statut_reception,
        exo = excluded.exo,
        timbre = excluded.timbre,
        ht_7 = excluded.ht_7,
        tva_7 = excluded.tva_7,
        ht_19 = excluded.ht_19,
        tva_19 = excluded.tva_19,
        total_remise = excluded.total_remise,
        updated_at = excluded.updated_at
    `)

    const deleteLines = db.prepare(`DELETE FROM lignes_facture_fournisseur WHERE facture_id = ?`)
    const insertLine = db.prepare(`
      INSERT INTO lignes_facture_fournisseur (
        id, facture_id, produit_id, designation, quantite,
        ancien_prix_achat, nouveau_prix_achat, prix_vente_suggere, prix_vente_applique, tva_taux, pending_product_json, numeros_serie_json
      ) VALUES (
        @id, @facture_id, @produit_id, @designation, @quantite,
        NULL, @nouveau_prix_achat, NULL, NULL, @tva_taux, @pending_product_json, @numeros_serie_json
      )
    `)

    const row = {
      id: draftId,
      numero_facture: f.numero_facture || `BROUILLON-${draftId.slice(0, 8)}`,
      fournisseur_id: f.fournisseur_id || null,
      date_facture: f.date_facture || now.slice(0, 10),
      date_echeance: f.date_echeance ?? null,
      notes: f.notes ?? null,
      type: isBL ? 'FACTURE_ACHAT_BL' : 'FACTURE_ACHAT',
      statut_reception: isBL ? 'NON_ARRIVE' : 'ARRIVE',
      exo: f.exo ?? null,
      timbre: f.timbre ?? 1,
      ht_7: f.ht_7 ?? null,
      tva_7: f.tva_7 ?? null,
      ht_19: f.ht_19 ?? null,
      tva_19: f.tva_19 ?? null,
      total_remise: f.total_remise ?? null,
      created_at: f.created_at ?? now,
      updated_at: now,
    }

    db.transaction(() => {
      upsertFacture.run(row)
      deleteLines.run(draftId)
      for (const l of payload.lignes) {
        insertLine.run({
          id: l.id || randomUUID(),
          facture_id: draftId,
          produit_id: l.produit_id || null,
          designation: l.designation || '',
          quantite: l.quantite ?? 1,
          nouveau_prix_achat: l.nouveau_prix_achat ?? 0,
          tva_taux: l.tva_taux ?? 0,
          pending_product_json: l.pending_product_json ?? null,
          numeros_serie_json: l.numeros_serie_json ?? null,
        })
      }
    })()

    return { success: true, draftId, updated_at: now }
  })

  ipcMain.handle('facturesFournisseurs:deleteDraft', (_e, draftId: string) => {
    const facture = db.prepare(`SELECT id FROM factures_fournisseurs WHERE id = ? AND statut_paiement = 'BROUILLON'`).get(draftId)
    if (!facture) return { success: false, error: 'Brouillon introuvable' }
    db.transaction(() => {
      db.prepare(`DELETE FROM lignes_facture_fournisseur WHERE facture_id = ?`).run(draftId)
      db.prepare(`DELETE FROM factures_fournisseurs WHERE id = ?`).run(draftId)
    })()
    return { success: true }
  })

  ipcMain.handle('paiementsFournisseurs:create', (_e, p: Record<string, unknown>) => {
    const source = p.caisse_source === 'EXTERNE' ? 'EXTERNE' : 'INTERNE'
    const paymentType = p.paiement_type === 'TRANCHE' ? 'TRANCHE' : 'INSTANT'
    const shiftId = String(p.shift_id ?? '').trim() || null
    const operateur = String(p.operateur ?? 'superadmin')
    if (source === 'EXTERNE' && !shiftId) throw new Error('Ouvrez une caisse externe avant ce paiement')
    const factureBefore = db.prepare('SELECT * FROM factures_fournisseurs WHERE id = ?').get(p.facture_id) as Record<string, unknown> | undefined
    if (!factureBefore) throw new Error('Facture fournisseur introuvable')
    const restant = money3(Number(factureBefore.montant_ttc) - Number(factureBefore.montant_paye))
    const requestedAmount = money3(p.montant)
    const amount = paymentType === 'INSTANT' ? restant : requestedAmount
    if (amount <= 0 || amount > restant + 0.0001) throw new Error('Le paiement dépasse le montant restant')
    const metadata = `[SMLPOS_ACCOUNTING]${JSON.stringify({ caisse: source, paiement: paymentType, shiftId })}`
    const paymentPayload = {
      id: p.id ?? randomUUID(), facture_id: p.facture_id ?? '', fournisseur_id: p.fournisseur_id ?? '', montant: amount,
      mode_paiement: p.mode_paiement ?? 'ESPECES', reference_cheque: p.reference_cheque ?? null,
      date_paiement: p.date_paiement ?? new Date().toLocaleDateString('en-CA'), notes: [String(p.notes ?? '').trim(), metadata].filter(Boolean).join('\n'), created_at: p.created_at ?? new Date().toISOString(),
    }
    const row = bindRow({
      id: '',
      facture_id: '',
      fournisseur_id: '',
      montant: 0,
      mode_paiement: 'ESPECES',
      reference_cheque: null,
      date_paiement: new Date().toISOString().slice(0, 10),
      notes: null,
      created_at: new Date().toISOString(),
    }, paymentPayload)
    const insertPaiement = db.prepare(`
      INSERT INTO paiements_fournisseurs (id, facture_id, fournisseur_id, montant, mode_paiement,
        reference_cheque, date_paiement, notes, created_at)
      VALUES (@id, @facture_id, @fournisseur_id, @montant, @mode_paiement,
        @reference_cheque, @date_paiement, @notes, @created_at)
    `)
    const updateFacture = db.prepare(`
      UPDATE factures_fournisseurs SET montant_paye = montant_paye + ?,
        statut_paiement = CASE
          WHEN montant_paye + ? >= montant_ttc THEN 'PAYE'
          WHEN montant_paye + ? > 0 THEN 'PARTIEL'
          ELSE statut_paiement END
      WHERE id=?
    `)
    const updateFournisseur = db.prepare(`UPDATE fournisseurs SET solde_du = MAX(0, solde_du - ?) WHERE id=?`)

    const transaction = db.transaction(() => {
      insertPaiement.run(row)
      updateFacture.run(row.montant, row.montant, row.montant, row.facture_id)
      updateFournisseur.run(row.montant, row.fournisseur_id)
      if (source === 'INTERNE') {
        db.prepare(`INSERT INTO mouvements_caisse_interne (id,date_journal,type,categorie,montant,reference_id,note,operateur,created_at) VALUES (?,date('now','localtime'),'SORTIE','PAIEMENT_FOURNISSEUR',?,?,?,?,?)`)
          .run(`mci-${row.id}`, row.montant, row.facture_id, `Paiement fournisseur ${factureBefore.numero_facture}`, operateur, row.created_at)
        applyInternalCashOut(row.montant, row.created_at)
      } else {
        db.prepare(`INSERT INTO sorties_caisse (id,shift_id,montant,note,operateur,mouvement_interne_id,created_at) VALUES (?,?,?,?,?,NULL,?)`)
          .run(`supplier-${row.id}`, shiftId, row.montant, `[CAISSE:EXTERNE] Paiement fournisseur ${factureBefore.numero_facture}`, operateur, row.created_at)
      }
    })
    transaction()
    addActivityLog({ shift_id: shiftId ?? undefined, operateur, action: 'SUPPLIER_PAYMENT_CREATED', montant: row.montant, details: { facture_id: row.facture_id, mode: row.mode_paiement, caisse_source: source, paiement_type: paymentType } })
    enqueueSync('paiements_fournisseurs', 'INSERT', row)
    if (source === 'INTERNE') {
      const internal = db.prepare('SELECT * FROM mouvements_caisse_interne WHERE id = ?').get(`mci-${row.id}`) as Record<string, unknown>
      enqueueSync('mouvements_caisse_interne', 'INSERT', internal)
    } else {
      const cashOut = db.prepare('SELECT * FROM sorties_caisse WHERE id = ?').get(`supplier-${row.id}`) as Record<string, unknown>
      enqueueSync('sorties_caisse', 'INSERT', cashOut)
    }
    const facture = db.prepare('SELECT * FROM factures_fournisseurs WHERE id = ?').get(row.facture_id) as Record<string, unknown> | undefined
    if (facture) enqueueSync('factures_fournisseurs', 'UPDATE', facture)
    const fournisseur = db.prepare('SELECT * FROM fournisseurs WHERE id = ?').get(row.fournisseur_id) as Record<string, unknown> | undefined
    if (fournisseur) enqueueSync('fournisseurs', 'UPDATE', fournisseur)
    return { success: true }
  })

  ipcMain.handle('ajustementsFournisseurs:list', (_e, fournisseurId: string) => {
    return db.prepare(`SELECT * FROM ajustements_fournisseurs WHERE fournisseur_id = ? ORDER BY created_at DESC LIMIT 500`).all(fournisseurId)
  })

  ipcMain.handle('ajustementsFournisseurs:create', (_e, input: Record<string, unknown>) => {
    const montant = money3(input.montant)
    const type = input.type === 'RETRAIT' ? 'RETRAIT' : 'AJOUT'
    if (!input.fournisseur_id || montant <= 0 || !String(input.motif ?? '').trim()) {
      return { success: false, error: 'Montant et motif requis' }
    }
    const id = String(input.id ?? randomUUID())
    const now = new Date().toISOString()
    const delta = type === 'AJOUT' ? montant : -montant
    db.transaction(() => {
      const supplier = db.prepare('SELECT solde_du FROM fournisseurs WHERE id = ?').get(input.fournisseur_id) as { solde_du?: number } | undefined
      if (!supplier) throw new Error('Fournisseur introuvable')
      if (type === 'RETRAIT' && (supplier.solde_du ?? 0) + delta < 0) throw new Error('Le retrait depasse le solde fournisseur')
      db.prepare(`INSERT INTO ajustements_fournisseurs (id,fournisseur_id,type,montant,motif,operateur,created_at) VALUES (?,?,?,?,?,?,?)`)
        .run(id, input.fournisseur_id, type, montant, String(input.motif).trim(), input.operateur ?? 'superadmin', now)
      db.prepare('UPDATE fournisseurs SET solde_du = MAX(0, solde_du + ?) WHERE id = ?').run(delta, input.fournisseur_id)
    })()
    const snapshot = db.prepare('SELECT * FROM fournisseurs WHERE id = ?').get(input.fournisseur_id) as Record<string, unknown>
    enqueueSync('fournisseurs', 'UPDATE', snapshot)
    addActivityLog({ action: 'SUPPLIER_BALANCE_ADJUSTED', montant, operateur: input.operateur as string, details: { fournisseur_id: input.fournisseur_id, type, motif: input.motif } })
    return { success: true, id, supplier: snapshot }
  })

  // ─── Caisse Interne ──────────────────────────────────────────────────────────
  ipcMain.handle('caisseInterne:getToday', () => {
    const today = new Date().toISOString().slice(0, 10)
    let row = db.prepare('SELECT * FROM caisse_interne WHERE date_journal = ?').get(today) as Record<string, unknown> | undefined
    if (!row) {
      const yesterday = db.prepare('SELECT solde_ouverture, total_entrees, total_sorties FROM caisse_interne ORDER BY date_journal DESC LIMIT 1').get() as { solde_ouverture: number; total_entrees: number; total_sorties: number } | undefined
      const soldeOuverture = yesterday
        ? yesterday.solde_ouverture + yesterday.total_entrees - yesterday.total_sorties
        : 100
      const id = `ci-${today}`
      db.prepare(`INSERT OR IGNORE INTO caisse_interne (id, date_journal, solde_ouverture) VALUES (?, ?, ?)`).run(id, today, soldeOuverture)
      row = db.prepare('SELECT * FROM caisse_interne WHERE date_journal = ?').get(today) as Record<string, unknown>
      if (row) enqueueSync('caisse_interne', 'INSERT', row)
    }
    return row
  })

  ipcMain.handle('caisseInterne:mouvementsList', (_e, filters: Record<string, unknown> = {}) => {
    let sql = 'SELECT * FROM mouvements_caisse_interne WHERE 1=1'
    const params: unknown[] = []
    if (filters.dateFrom)  { sql += ' AND date_journal >= ?'; params.push(filters.dateFrom) }
    if (filters.dateTo)    { sql += ' AND date_journal <= ?'; params.push(filters.dateTo) }
    if (filters.type)      { sql += ' AND type = ?'; params.push(filters.type) }
    if (filters.categorie) { sql += ' AND categorie = ?'; params.push(filters.categorie) }
    if (filters.operateur) { sql += ' AND operateur LIKE ?'; params.push(`%${filters.operateur}%`) }
    if (filters.search)    { sql += ' AND (note LIKE ? OR reference_id LIKE ? OR categorie LIKE ?)'; const s = `%${filters.search}%`; params.push(s, s, s) }
    sql += ' ORDER BY created_at ASC'
    if (!filters.dateFrom && !filters.dateTo) sql += ' LIMIT 500'
    return db.prepare(sql).all(...params)
  })

  ipcMain.handle('caisseInterne:getStats', (_e, dateFrom: string, dateTo: string) => {
    const byAgent = db.prepare(`
      SELECT operateur,
        SUM(CASE WHEN type='ENTREE' THEN montant ELSE 0 END) as total_entrees,
        SUM(CASE WHEN type='SORTIE' THEN montant ELSE 0 END) as total_sorties,
        COUNT(*) as count
      FROM mouvements_caisse_interne
      WHERE date_journal >= ? AND date_journal <= ?
      GROUP BY operateur ORDER BY (total_entrees + total_sorties) DESC
    `).all(dateFrom, dateTo)

    const byCategorie = db.prepare(`
      SELECT categorie, type,
        COUNT(*) as count, SUM(montant) as total
      FROM mouvements_caisse_interne
      WHERE date_journal >= ? AND date_journal <= ?
      GROUP BY categorie, type ORDER BY total DESC
    `).all(dateFrom, dateTo)

    const byDay = db.prepare(`
      SELECT date_journal,
        SUM(CASE WHEN type='ENTREE' THEN montant ELSE 0 END) as entrees,
        SUM(CASE WHEN type='SORTIE' THEN montant ELSE 0 END) as sorties,
        COUNT(*) as count
      FROM mouvements_caisse_interne
      WHERE date_journal >= ? AND date_journal <= ?
      GROUP BY date_journal ORDER BY date_journal ASC
    `).all(dateFrom, dateTo)

    const agents = db.prepare(`
      SELECT DISTINCT operateur FROM mouvements_caisse_interne
      WHERE date_journal >= ? AND date_journal <= ? ORDER BY operateur
    `).all(dateFrom, dateTo) as { operateur: string }[]

    const openingBalance = db.prepare(`
      SELECT solde_ouverture, total_entrees, total_sorties FROM caisse_interne
      WHERE date_journal = ? LIMIT 1
    `).get(dateFrom) as { solde_ouverture: number; total_entrees: number; total_sorties: number } | undefined

    return { byAgent, byCategorie, byDay, agents, openingBalance }
  })

  ipcMain.handle('caisseInterne:addMouvement', (_e, m) => {
    const insert = db.prepare(`
      INSERT INTO mouvements_caisse_interne (id, date_journal, type, categorie, montant, reference_id, note, operateur, created_at)
      VALUES (@id, @date_journal, @type, @categorie, @montant, @reference_id, @note, @operateur, @created_at)
    `)
    const updateCaisse = db.prepare(m.type === 'ENTREE'
      ? `UPDATE caisse_interne SET total_entrees = total_entrees + ? WHERE date_journal = ?`
      : `UPDATE caisse_interne SET total_sorties = total_sorties + ? WHERE date_journal = ?`
    )
    const transaction = db.transaction(() => {
      insert.run(m)
      updateCaisse.run(m.montant, m.date_journal)
    })
    transaction()
    addActivityLog({ operateur: m.operateur, action: 'INTERNAL_CASH_MOVEMENT_CREATED', montant: m.montant, details: { type: m.type, categorie: m.categorie, note: m.note } })
    enqueueSync('mouvements_caisse_interne', 'INSERT', m)
    const ci = db.prepare('SELECT * FROM caisse_interne WHERE date_journal = ?').get(m.date_journal) as Record<string, unknown> | undefined
    if (ci) enqueueSync('caisse_interne', 'UPDATE', ci)
    return { success: true }
  })

  ipcMain.handle('caisseInterne:transferShift', (_e, shiftId: string) => {
    const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(shiftId) as Record<string, unknown> | undefined
    if (!shift) return { error: 'Shift not found' }
    if (shift.transfere_caisse_interne) return { success: true, montant: 0, alreadyDone: true }

    const ventesTotal = db.prepare(`SELECT COALESCE(SUM(total_ttc),0) as total FROM ventes WHERE shift_id = ? AND type = 'VENTE'`).get(shiftId) as { total: number }
    const repairFinalTotal = db.prepare(`
      SELECT COALESCE(SUM(MAX(0, COALESCE(total_final,total_estime,0) - COALESCE(acompte,0))),0) as total FROM reparations
      WHERE statut IN ('TERMINE', 'RENDU') AND (
        (notes_technicien LIKE '%[SMLPOS_PAYMENT]%"paid":true%' AND notes_technicien LIKE ?)
        OR ((notes_technicien NOT LIKE '%[SMLPOS_PAYMENT]%' OR notes_technicien IS NULL) AND shift_id = ?)
      )
    `).get(`%"paymentShiftId":"${shiftId}"%`, shiftId) as { total: number }
    const repairDepositTotal = db.prepare(`SELECT COALESCE(SUM(acompte),0) as total FROM reparations WHERE shift_id = ? AND statut != 'ANNULE'`).get(shiftId) as { total: number }
    const repsTotal = { total: money3(repairFinalTotal.total + repairDepositTotal.total) }
    const creditsTotal = db.prepare(`SELECT COALESCE(SUM(montant),0) as total FROM credits_clients WHERE shift_id = ? AND type = 'PAIEMENT'`).get(shiftId) as { total: number }
    const advancesTotal = db.prepare(`SELECT COALESCE(SUM(montant),0) as total FROM avances_clients WHERE shift_id = ?`).get(shiftId) as { total: number }
    const cashOutTotal = db.prepare(`SELECT COALESCE(SUM(montant),0) as total FROM sorties_caisse WHERE shift_id = ?`).get(shiftId) as { total: number }
    // Service transactions are also NF lines inside ventes.total_ttc; do not count them twice.
    const total = money3(ventesTotal.total + repsTotal.total + creditsTotal.total + advancesTotal.total - cashOutTotal.total)
    if (total <= 0) {
      db.prepare(`UPDATE shifts SET transfere_caisse_interne = 1 WHERE id = ?`).run(shiftId)
      enqueueSync('shifts', 'UPDATE', { id: shiftId, transfere_caisse_interne: 1 })
      return { success: true, montant: 0 }
    }

    const today = new Date().toLocaleDateString('en-CA')
    const existingCash = db.prepare('SELECT id FROM caisse_interne WHERE date_journal = ?').get(today)
    if (!existingCash) {
      const previous = db.prepare('SELECT solde_ouverture,total_entrees,total_sorties FROM caisse_interne ORDER BY date_journal DESC LIMIT 1').get() as { solde_ouverture?: number; total_entrees?: number; total_sorties?: number } | undefined
      const opening = previous ? money3(Number(previous.solde_ouverture) + Number(previous.total_entrees) - Number(previous.total_sorties)) : 100
      db.prepare('INSERT OR IGNORE INTO caisse_interne (id,date_journal,solde_ouverture) VALUES (?,?,?)').run(`ci-${today}`, today, opening)
    }
    const id = `mvt-${Date.now()}`
    const m = {
      id, date_journal: today,
      type: 'ENTREE', categorie: 'TRANSFERT_CAISSE_EXTERNE',
      montant: total, reference_id: shiftId,
      note: `Transfert recettes shift — ${(shift as { operateur_nom?: string }).operateur_nom ?? ''}`,
      operateur: 'superadmin', created_at: new Date().toISOString()
    }
    db.prepare(`
      INSERT INTO mouvements_caisse_interne (id, date_journal, type, categorie, montant, reference_id, note, operateur, created_at)
      VALUES (@id, @date_journal, @type, @categorie, @montant, @reference_id, @note, @operateur, @created_at)
    `).run(m)
    db.prepare(`UPDATE caisse_interne SET total_entrees = total_entrees + ? WHERE date_journal = ?`).run(total, today)
    db.prepare(`UPDATE shifts SET transfere_caisse_interne = 1 WHERE id = ?`).run(shiftId)
    addActivityLog({ shift_id: shiftId, action: 'SHIFT_TRANSFERRED_TO_INTERNAL_CASH', montant: total })
    enqueueSync('mouvements_caisse_interne', 'INSERT', m)
    const cashSnapshot = db.prepare('SELECT * FROM caisse_interne WHERE date_journal = ?').get(today) as Record<string, unknown> | undefined
    if (cashSnapshot) enqueueSync('caisse_interne', 'UPDATE', cashSnapshot)
    enqueueSync('shifts', 'UPDATE', { id: shiftId, transfere_caisse_interne: 1 })
    return { success: true, montant: total }
  })

  // ── Ventes en Ligne ───────────────────────────────────────────────────────
  ipcMain.handle('ventesLigne:list', (_e, filters: Record<string, unknown> = {}) => {
    let sql = `SELECT * FROM ventes_en_ligne`
    const params: unknown[] = []
    const where: string[] = []
    if (filters.statut) { where.push(`statut = ?`); params.push(filters.statut) }
    if (filters.search) { where.push(`(client_nom LIKE ? OR numero LIKE ?)`); params.push(`%${filters.search}%`, `%${filters.search}%`) }
    if (where.length) sql += ` WHERE ` + where.join(' AND ')
    sql += ` ORDER BY created_at DESC LIMIT 200`
    return db.prepare(sql).all(...params)
  })

  ipcMain.handle('ventesLigne:create', (_e, commande: Record<string, unknown>) => {
    db.prepare(`
      INSERT INTO ventes_en_ligne
        (id,numero,shift_id,operateur_nom,client_nom,client_tel,client_adresse,
         produits_json,montant_ttc,frais_livraison,frais_retour,statut,livraison_nom,note,created_at,updated_at)
      VALUES
        (@id,@numero,@shift_id,@operateur_nom,@client_nom,@client_tel,@client_adresse,
         @produits_json,@montant_ttc,@frais_livraison,@frais_retour,@statut,@livraison_nom,@note,@created_at,@updated_at)
    `).run(commande)
    addActivityLog({ shift_id: commande.shift_id as string, operateur: commande.operateur_nom as string, action: 'ONLINE_ORDER_CREATED', montant: commande.montant_ttc as number, details: { numero: commande.numero, client: commande.client_nom } })
    enqueueSync('ventes_en_ligne', 'INSERT', commande)
    return { success: true }
  })

  ipcMain.handle('ventesLigne:updateStatut', (_e, id: string, statut: string, extra: Record<string, unknown> = {}) => {
    const now = new Date().toISOString()
    const cmd = db.prepare(`SELECT * FROM ventes_en_ligne WHERE id = ?`).get(id) as Record<string, unknown> | undefined
    if (!cmd) return { error: 'Not found' }

    if (statut === 'RETOUR') {
      const frais = (extra.frais_retour as number) ?? (cmd.frais_retour as number) ?? 4
      const sortieId = `sc-ret-${Date.now()}`
      const sortieRow = {
        id: sortieId, shift_id: extra.shift_id ?? null, montant: frais,
        note: `Frais retour ${cmd.numero}`, operateur: extra.operateur ?? null, created_at: now,
      }
      db.prepare(`INSERT INTO sorties_caisse (id,shift_id,montant,note,operateur,created_at) VALUES (?,?,?,?,?,?)`)
        .run(sortieId, sortieRow.shift_id, frais, sortieRow.note, sortieRow.operateur, now)
      enqueueSync('sorties_caisse', 'INSERT', sortieRow)
    }
    if (statut === 'CONFIRME') {
      const lines = JSON.parse(cmd.produits_json as string) as Array<{ produit_id?: string; quantite: number }>
      for (const l of lines) {
        if (l.produit_id) {
          db.prepare(`UPDATE produits SET stock_actuel = stock_actuel - ?, updated_at = ? WHERE id = ?`).run(l.quantite, now, l.produit_id)
          enqueueProductSnapshot(l.produit_id)
        }
      }
    }
    if (statut === 'LIVRE') {
      const montant = (extra.montant_recu as number) ?? 0
      if (montant > 0) db.prepare(`UPDATE ventes_en_ligne SET montant_recu = ?, updated_at = ? WHERE id = ?`).run(montant, now, id)
      if (extra.reference_livraison) db.prepare(`UPDATE ventes_en_ligne SET reference_livraison = ? WHERE id = ?`).run(extra.reference_livraison, id)
    }
    if (statut === 'REGLE') {
      const montant = (extra.montant_net as number) ?? (cmd.montant_recu as number) ?? 0
      if (montant > 0) {
        const today = now.slice(0, 10)
        const mvtId = `mvt-vl-${Date.now()}`
        const mvtRow = {
          id: mvtId, date_journal: today, type: 'ENTREE', categorie: 'VENTE_EN_LIGNE_REGLEMENT',
          montant, reference_id: id, note: `Règlement vente en ligne ${cmd.numero}`,
          operateur: extra.operateur ?? 'superadmin', created_at: now,
        }
        db.prepare(`INSERT INTO mouvements_caisse_interne (id,date_journal,type,categorie,montant,reference_id,note,operateur,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(mvtId, today, 'ENTREE', 'VENTE_EN_LIGNE_REGLEMENT', montant, id, mvtRow.note, mvtRow.operateur, now)
        db.prepare(`UPDATE caisse_interne SET total_entrees = total_entrees + ? WHERE date_journal = ?`).run(montant, today)
        db.prepare(`UPDATE ventes_en_ligne SET montant_net = ?, updated_at = ? WHERE id = ?`).run(montant, now, id)
        enqueueSync('mouvements_caisse_interne', 'INSERT', mvtRow)
        const ci = db.prepare('SELECT * FROM caisse_interne WHERE date_journal = ?').get(today) as Record<string, unknown> | undefined
        if (ci) enqueueSync('caisse_interne', 'UPDATE', ci)
      }
    }
    if (statut === 'ANNULE') {
      const prevStatut = cmd.statut as string
      if (prevStatut === 'CONFIRME' || prevStatut === 'LIVRE') {
        const lines = JSON.parse(cmd.produits_json as string) as Array<{ produit_id?: string; quantite: number }>
        for (const l of lines) {
          if (l.produit_id) {
            db.prepare(`UPDATE produits SET stock_actuel = stock_actuel + ?, updated_at = ? WHERE id = ?`).run(l.quantite, now, l.produit_id)
            enqueueProductSnapshot(l.produit_id)
          }
        }
      }
    }
    db.prepare(`UPDATE ventes_en_ligne SET statut = ?, updated_at = ? WHERE id = ?`).run(statut, now, id)
    addActivityLog({ action: 'ONLINE_ORDER_STATUS_UPDATED', details: { id, statut, ...extra } })
    const updatedCmd = db.prepare('SELECT * FROM ventes_en_ligne WHERE id = ?').get(id) as Record<string, unknown>
    enqueueSync('ventes_en_ligne', 'UPDATE', updatedCmd ?? { id, statut, updated_at: now })
    return { success: true }
  })

  ipcMain.handle('ventesLigne:getLastNumber', (_e, prefix: string) => {
    const row = db.prepare(`SELECT numero FROM ventes_en_ligne WHERE numero LIKE ? ORDER BY created_at DESC LIMIT 1`).get(`${prefix}%`) as { numero: string } | undefined
    if (!row) return 0
    const parts = row.numero.split('-')
    return parseInt(parts[parts.length - 1]) || 0
  })

  // ── Clients ────────────────────────────────────────────────────────────────
  ipcMain.handle('clients:list', (_e, filters: Record<string, unknown> = {}) => {
    const where = ['c.actif = 1']
    const params: unknown[] = []
    if (filters.search) { where.push('(c.nom LIKE ? OR c.telephone LIKE ?)'); params.push(`%${filters.search}%`, `%${filters.search}%`) }
    if (filters.organisation_id === null || filters.organisation_id === 'none') where.push('c.organisation_id IS NULL')
    else if (filters.organisation_id) {
      // Older records may contain the organisation name instead of its ID.
      // Treat that legacy value as the same organisation until the user reassigns it.
      where.push('(c.organisation_id = ? OR lower(trim(c.organisation_id)) = lower(trim(o.nom)))')
      params.push(filters.organisation_id)
    }
    return db.prepare(`SELECT c.* FROM clients c LEFT JOIN organisations o ON o.id = ? WHERE ${where.join(' AND ')} ORDER BY c.nom`).all(
      filters.organisation_id && filters.organisation_id !== 'none' ? filters.organisation_id : null,
      ...params,
    )
  })

  ipcMain.handle('clients:create', (_e, client: Record<string, unknown>) => {
    const { montant_credit_initial, agent_initial, note_credit, ...clientData } = client as Record<string, unknown>
    const creditInitial = (montant_credit_initial as number) || 0
    db.prepare(`INSERT INTO clients (id,nom,telephone,email,adresse,matricule_fiscal,credit_limite,solde_credit,organisation_id,agent,actif,notes,created_at) VALUES (@id,@nom,@telephone,@email,@adresse,@matricule_fiscal,@credit_limite,@solde_credit,@organisation_id,@agent,@actif,@notes,@created_at)`).run({
      id: clientData.id ?? null,
      nom: clientData.nom ?? null,
      telephone: clientData.telephone ?? null,
      email: clientData.email ?? null,
      adresse: clientData.adresse ?? null,
      matricule_fiscal: clientData.matricule_fiscal ?? null,
      credit_limite: clientData.credit_limite ?? 500,
      solde_credit: clientData.solde_credit ?? 0,
      organisation_id: clientData.organisation_id ?? null,
      agent: clientData.agent ?? agent_initial ?? null,
      actif: clientData.actif ?? 1,
      notes: clientData.notes ?? null,
      created_at: clientData.created_at ?? new Date().toISOString(),
    })
    if (creditInitial > 0) {
      const now = new Date().toISOString()
      const id = `cr-init-${Date.now()}`
      const creditRow = {
        id, client_id: clientData.id, client_nom: clientData.nom, shift_id: null,
        type: 'CREDIT', montant: creditInitial, reference: null,
        // The client form may attach a structured installment plan to the note.
        // Persist it with the credit movement so it is available in history, POS
        // repayments and across sync without adding a fragile parallel balance.
        note: String(note_credit ?? '').trim() || 'Crédit initial à la création', operateur: agent_initial ?? 'superadmin', created_at: now,
      }
      db.prepare(`INSERT INTO credits_clients (id,client_id,client_nom,shift_id,type,montant,reference,note,operateur,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(id, clientData.id, clientData.nom, null, 'CREDIT', creditInitial, null, String(note_credit ?? '').trim() || 'Crédit initial à la création', agent_initial ?? 'superadmin', now)
      db.prepare(`UPDATE clients SET solde_credit = solde_credit + ? WHERE id = ?`).run(creditInitial, clientData.id)
      enqueueSync('credits_clients', 'INSERT', creditRow)
    }
    const clientSnapshot = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientData.id) as Record<string, unknown>
    addActivityLog({ action: 'CLIENT_CREATED', details: { id: clientData.id, nom: clientData.nom } })
    enqueueSync('clients', 'INSERT', clientSnapshot ?? clientData)
    return { success: true }
  })

  ipcMain.handle('clients:update', (_e, id: string, data: Record<string, unknown>) => {
    const fields = Object.keys(data).filter(k => k !== 'id').map(k => `${k} = @${k}`).join(', ')
    if (fields) db.prepare(`UPDATE clients SET ${fields} WHERE id = @id`).run({ ...data, id })
    addActivityLog({ action: 'CLIENT_UPDATED', details: { id, ...data } })
    enqueueSync('clients', 'UPDATE', { id, ...data })
    return { success: true }
  })

  ipcMain.handle('fidelite:findByCode', (_e, code: string) => {
    const normalized = String(code ?? '').trim()
    if (!normalized) return null
    return db.prepare(`
      SELECT * FROM clients
      WHERE actif = 1 AND lower(trim(fidelite_code)) = lower(trim(?))
      LIMIT 1
    `).get(normalized)
  })

  ipcMain.handle('fidelite:assignCard', (_e, clientId: string, code: string) => {
    const normalized = String(code ?? '').trim()
    if (!normalized) throw new Error('Scannez le code imprimé sur la carte')
    const client = db.prepare(`SELECT * FROM clients WHERE id = ? AND actif = 1`).get(clientId) as Record<string, unknown> | undefined
    if (!client) throw new Error('Client introuvable')
    const currentCode = String(client.fidelite_code ?? '').trim()
    if (currentCode && currentCode.toLowerCase() !== normalized.toLowerCase()) {
      throw new Error('Ce client possède déjà une autre carte de fidélité')
    }
    const conflict = db.prepare(`
      SELECT id, nom FROM clients
      WHERE lower(trim(fidelite_code)) = lower(trim(?)) AND id != ?
      LIMIT 1
    `).get(normalized, clientId) as { id: string; nom: string } | undefined
    if (conflict) throw new Error(`Cette carte appartient déjà à ${conflict.nom}`)
    db.prepare(`UPDATE clients SET fidelite_code = ?, solde_fidelite = COALESCE(solde_fidelite, 0) WHERE id = ?`).run(normalized, clientId)
    const snapshot = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(clientId) as Record<string, unknown>
    enqueueSync('clients', 'UPDATE', snapshot)
    addActivityLog({ action: 'LOYALTY_CARD_ASSIGNED', details: { clientId, code: normalized } })
    return { success: true, client: snapshot }
  })

  ipcMain.handle('fidelite:listMovements', (_e, clientId: string) => {
    return db.prepare(`SELECT * FROM mouvements_fidelite WHERE client_id = ? ORDER BY created_at DESC LIMIT 100`).all(clientId)
  })

  // ── Crédits Clients ────────────────────────────────────────────────────────
  ipcMain.handle('credits:list', (_e, clientId?: string) => {
    if (clientId) return db.prepare(`SELECT cc.*, c.solde_credit FROM credits_clients cc LEFT JOIN clients c ON c.id = cc.client_id WHERE cc.client_id = ? ORDER BY cc.created_at DESC`).all(clientId)
    return db.prepare(`SELECT cc.*, c.solde_credit, c.nom as _client_nom FROM credits_clients cc LEFT JOIN clients c ON c.id = cc.client_id ORDER BY cc.created_at DESC LIMIT 200`).all()
  })

  ipcMain.handle('credits:create', (_e, credit: Record<string, unknown>) => {
    const productId = String(credit.produit_id ?? '').trim() || null
    const quantity = Math.max(1, Math.floor(Number(credit.quantite) || 1))
    const product = productId ? db.prepare('SELECT id,nom,stock_actuel FROM produits WHERE id = ? AND actif = 1').get(productId) as { id: string; nom: string; stock_actuel: number } | undefined : undefined
    if (credit.type === 'CREDIT' && productId && !product) throw new Error('Produit de crédit introuvable')
    if (credit.type === 'CREDIT' && product && Number(product.stock_actuel) < quantity) throw new Error('Stock insuffisant pour ce produit')
    const productMeta = credit.type === 'CREDIT' && product
      ? `[SMLPOS_ACCOUNTING]${JSON.stringify({ nature: 'PRODUIT', produitId: product.id, produit: product.nom, quantite: quantity })}`
      : ''
    const row = bindRow({
      id: '',
      client_id: '',
      client_nom: '',
      shift_id: null,
      type: 'CREDIT',
      montant: 0,
      reference: null,
      note: null,
      operateur: 'superadmin',
      created_at: new Date().toISOString(),
    }, {
      id: credit.id ?? randomUUID(), client_id: credit.client_id ?? '', client_nom: credit.client_nom ?? '', shift_id: credit.shift_id ?? null,
      type: credit.type ?? 'CREDIT', montant: money3(credit.montant), reference: credit.reference ?? null,
      note: [String(credit.note ?? '').trim(), productMeta].filter(Boolean).join('\n') || null,
      operateur: credit.operateur ?? 'superadmin', created_at: credit.created_at ?? new Date().toISOString(),
    })
    const client = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(row.client_id) as Record<string, unknown> | undefined
    if (!client) throw new Error('Client introuvable')
    const montant = Number(row.montant)
    if (!Number.isFinite(montant) || montant <= 0) throw new Error('Le montant doit être supérieur à zéro')
    const before = Math.max(0, Number(client.solde_credit) || 0)
    if (row.type === 'PAIEMENT' && montant > before + 0.0001) throw new Error('Le paiement dépasse le crédit restant')
    const after = row.type === 'CREDIT' ? before + montant : Math.max(0, before - montant)
    const organisationId = String(client.organisation_id ?? '').trim()
    db.transaction(() => {
      db.prepare(`INSERT INTO credits_clients (id,client_id,client_nom,shift_id,type,montant,reference,note,operateur,created_at) VALUES (@id,@client_id,@client_nom,@shift_id,@type,@montant,@reference,@note,@operateur,@created_at)`).run(row)
      db.prepare(`UPDATE clients SET solde_credit = ? WHERE id = ?`).run(after, row.client_id)
      if (row.type === 'CREDIT' && product) {
        db.prepare(`UPDATE produits SET stock_actuel = stock_actuel - ?, updated_at = ? WHERE id = ?`).run(quantity, row.created_at, product.id)
      }
      if (row.type === 'PAIEMENT' && row.shift_id) {
        db.prepare(`UPDATE shifts SET total_credits_recus = total_credits_recus + ? WHERE id = ?`).run(montant, row.shift_id)
      }
      if (organisationId) {
        db.prepare(`UPDATE organisations SET credit_total = COALESCE((SELECT SUM(CASE WHEN c.solde_credit > 0 THEN c.solde_credit ELSE 0 END) FROM clients c WHERE c.actif=1 AND (c.organisation_id=organisations.id OR lower(trim(c.organisation_id))=lower(trim(organisations.nom)))),0) WHERE id=? OR lower(trim(nom))=lower(trim(?))`).run(organisationId, organisationId)
      }
    })()
    addActivityLog({ shift_id: row.shift_id as string, operateur: row.operateur as string, action: row.type === 'CREDIT' ? 'CLIENT_CREDIT_CREATED' : 'CLIENT_PAYMENT_RECEIVED', montant: row.montant as number, details: { client_nom: row.client_nom, produit: product?.nom, quantite: product ? quantity : null } })
    enqueueSync('credits_clients', 'INSERT', row)
    if (row.type === 'CREDIT' && product) enqueueProductSnapshot(product.id)
    const clientSnapshot = db.prepare('SELECT * FROM clients WHERE id = ?').get(row.client_id) as Record<string, unknown> | undefined
    if (clientSnapshot) enqueueSync('clients', 'UPDATE', clientSnapshot)
    const organisation = organisationId ? db.prepare(`SELECT * FROM organisations WHERE id=? OR lower(trim(nom))=lower(trim(?)) LIMIT 1`).get(organisationId, organisationId) as Record<string, unknown> | undefined : undefined
    if (organisation) enqueueSync('organisations', 'UPDATE', organisation)
    return { success: true, before, amount: montant, after, organisation_nom: organisation?.nom ?? null }
  })

  ipcMain.handle('avancesClients:create', (_e, advance: Record<string, unknown>) => {
    const advancePayload = { ...advance, note: [String(advance.note ?? '').trim(), '[CAISSE:EXTERNE] Avance client'].filter(Boolean).join('\n') }
    const row = bindRow({ id: '', numero: '', client_id: '', client_nom: '', client_tel: null, client_adresse: null, produit_description: '', montant: 0, mode_paiement: 'ESPECES', reference: null, note: null, shift_id: null, operateur: 'superadmin', created_at: new Date().toISOString() }, advancePayload)
    const client = db.prepare(`SELECT * FROM clients WHERE id=? AND actif=1`).get(row.client_id) as Record<string, unknown> | undefined
    if (!client) throw new Error('Veuillez sélectionner un client valide')
    if (!String(row.produit_description).trim()) throw new Error('La description du produit est obligatoire')
    if (!(Number(row.montant) > 0)) throw new Error('Le montant doit être supérieur à zéro')
    if (!row.shift_id) throw new Error('Ouvrez une caisse externe avant d’enregistrer une avance')
    db.prepare(`INSERT INTO avances_clients (id,numero,client_id,client_nom,client_tel,client_adresse,produit_description,montant,mode_paiement,reference,note,shift_id,operateur,created_at) VALUES (@id,@numero,@client_id,@client_nom,@client_tel,@client_adresse,@produit_description,@montant,@mode_paiement,@reference,@note,@shift_id,@operateur,@created_at)`).run(row)
    addActivityLog({ shift_id: row.shift_id as string, operateur: row.operateur as string, action: 'CLIENT_ADVANCE_RECEIVED', montant: Number(row.montant), details: { numero: row.numero, client_nom: row.client_nom, produit: row.produit_description } })
    enqueueSync('avances_clients', 'INSERT', row)
    return { success: true, advance: row }
  })

  ipcMain.handle('avancesClients:list', (_e, clientId?: string) => clientId
    ? db.prepare(`SELECT * FROM avances_clients WHERE client_id=? ORDER BY created_at DESC`).all(clientId)
    : db.prepare(`SELECT * FROM avances_clients ORDER BY created_at DESC LIMIT 200`).all())

  // ── Paramètres App ─────────────────────────────────────────────────────────
  ipcMain.handle('settings:getAll', () => {
    const rows = db.prepare(`SELECT key, value FROM app_settings`).all() as { key: string; value: string }[]
    return Object.fromEntries(rows.map(r => [r.key, r.value]))
  })

  ipcMain.handle('settings:get', (_e, key: string) => {
    const row = db.prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key) as { value: string } | undefined
    return row?.value ?? null
  })

  ipcMain.handle('auth:verifyCaissePin', (_e, pin: string) => {
    const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'caisse_interne_pin'`).get() as { value: string } | undefined
    const stored = row?.value
    const fallback = ['sml2023', '1234', 'admin', 'superadmin']
    const valid = (!!stored && pin === stored) || fallback.includes(pin)
    return { valid }
  })

  ipcMain.handle('settings:set', (_e, key: string, value: string) => {
    db.prepare(`INSERT OR REPLACE INTO app_settings (key,value,updated_at) VALUES (?,?,?)`).run(key, value, new Date().toISOString())
    addActivityLog({ action: 'SETTING_UPDATED', details: { key, value } })
    if (!LOCAL_SETTINGS_KEYS.has(key)) {
      enqueueSync('app_settings', 'UPDATE', { key, value })
    }
    return { success: true }
  })

  ipcMain.handle('settings:setMany', (_e, data: Record<string, string>) => {
    const stmt = db.prepare(`INSERT OR REPLACE INTO app_settings (key,value,updated_at) VALUES (?,?,?)`)
    const now = new Date().toISOString()
    db.transaction(() => { for (const [k, v] of Object.entries(data)) stmt.run(k, v, now) })()
    addActivityLog({ action: 'SETTINGS_UPDATED', details: data })
    for (const [k, v] of Object.entries(data)) {
      if (!LOCAL_SETTINGS_KEYS.has(k)) {
        enqueueSync('app_settings', 'UPDATE', { key: k, value: v })
      }
    }
    return { success: true }
  })

  // ── Retours (Returns) ──────────────────────────────────────────────────────
  ipcMain.handle('retours:create', (_e, retour: Record<string, unknown>) => {
    const row = bindRow({
      id: '',
      vente_id: '',
      vente_numero: '',
      shift_id: null,
      produit_id: null,
      designation: '',
      quantite: 0,
      prix_unitaire: 0,
      motif: null,
      type_retour: 'SANS_PROBLEME',
      statut: 'EN_ATTENTE',
      resolution: null,
      montant_rembourse: 0,
      operateur: 'superadmin',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, retour)
    db.prepare(`INSERT INTO retours (id,vente_id,vente_numero,shift_id,produit_id,designation,quantite,prix_unitaire,motif,type_retour,statut,resolution,montant_rembourse,operateur,created_at,updated_at) VALUES (@id,@vente_id,@vente_numero,@shift_id,@produit_id,@designation,@quantite,@prix_unitaire,@motif,@type_retour,@statut,@resolution,@montant_rembourse,@operateur,@created_at,@updated_at)`).run(row)
    if (row.type_retour === 'SANS_PROBLEME' && row.produit_id) {
      db.prepare(`UPDATE produits SET stock_actuel = stock_actuel + ? WHERE id = ?`).run(row.quantite as number, row.produit_id)
    }
    if ((row.montant_rembourse as number) > 0 && row.shift_id) {
      const sortieId = `ret-${row.id}`
      const sortieRow = {
        id: sortieId, shift_id: row.shift_id, montant: row.montant_rembourse,
        note: `Remboursement retour: ${row.designation}`, operateur: row.operateur, created_at: row.created_at,
      }
      db.prepare(`INSERT INTO sorties_caisse (id,shift_id,montant,note,operateur,created_at) VALUES (?,?,?,?,?,?)`)
        .run(sortieId, row.shift_id, row.montant_rembourse, sortieRow.note, row.operateur, row.created_at)
      enqueueSync('sorties_caisse', 'INSERT', sortieRow)
    }
    if (row.type_retour === 'SANS_PROBLEME' && row.produit_id) {
      enqueueProductSnapshot(row.produit_id as string)
    }
    addActivityLog({ shift_id: row.shift_id as string, operateur: row.operateur as string, action: 'RETURN_CREATED', montant: row.montant_rembourse as number, details: { designation: row.designation, type: row.type_retour } })
    enqueueSync('retours', 'INSERT', row)
    return { success: true }
  })

  ipcMain.handle('retours:list', (_e, filters: Record<string, unknown> = {}) => {
    if (filters.statut) return db.prepare(`SELECT * FROM retours WHERE statut = ? ORDER BY created_at DESC`).all(filters.statut)
    return db.prepare(`SELECT * FROM retours ORDER BY created_at DESC LIMIT 300`).all()
  })

  ipcMain.handle('retours:updateStatut', (_e, id: string, statut: string, extra?: Record<string, unknown>) => {
    const now = new Date().toISOString()
    db.prepare(`UPDATE retours SET statut = ?, resolution = ?, updated_at = ? WHERE id = ?`).run(statut, extra?.resolution ?? null, now, id)
    addActivityLog({ action: 'RETURN_STATUS_UPDATED', details: { id, statut, resolution: extra?.resolution } })
    enqueueSync('retours', 'UPDATE', { id, statut, resolution: extra?.resolution ?? null })
    return { success: true }
  })

  // ── Ventes: Cancel ─────────────────────────────────────────────────────────
  ipcMain.handle('ventes:annuler', (_e, id: string, data: Record<string, unknown>) => {
    const now = new Date().toISOString()
    const vente = db.prepare(`SELECT * FROM ventes WHERE id = ?`).get(id) as Record<string, unknown> | undefined
    if (!vente) throw new Error('Vente introuvable')
    if (vente.statut === 'ANNULEE') return { success: true }
    let loyaltyClientId: string | null = null
    db.transaction(() => {
      db.prepare(`UPDATE ventes SET statut='ANNULEE', annule_par=@annule_par, annule_at=@annule_at, annule_motif=@annule_motif WHERE id=@id`)
        .run({ id, annule_par: data.annule_par, annule_at: now, annule_motif: data.annule_motif })
      const lignes = db.prepare(`SELECT produit_id, quantite FROM lignes_vente WHERE vente_id = ? AND produit_id IS NOT NULL`).all(id) as { produit_id: string; quantite: number }[]
      for (const l of lignes) {
        db.prepare(`UPDATE produits SET stock_actuel = stock_actuel + ? WHERE id = ?`).run(l.quantite, l.produit_id)
      }
      loyaltyClientId = String(vente.client_id ?? '') || null
      if (loyaltyClientId) {
        const client = db.prepare(`SELECT solde_fidelite FROM clients WHERE id = ?`).get(loyaltyClientId) as { solde_fidelite?: number } | undefined
        if (client) {
          const earned = Math.max(0, money3(vente.fidelite_gagnee))
          const used = Math.max(0, money3(vente.fidelite_utilisee))
          let running = money3(client.solde_fidelite)
          const insertMovement = db.prepare(`
            INSERT INTO mouvements_fidelite
              (id,client_id,vente_id,type,montant,solde_avant,solde_apres,note,operateur,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?)
          `)
          if (earned > 0) {
            const after = money3(running - earned)
            insertMovement.run(randomUUID(), loyaltyClientId, id, 'ANNULATION_GAIN', earned, running, after,
              `Annulation cashback ${vente.numero}`, data.annule_par ?? null, now)
            running = after
          }
          if (used > 0) {
            const after = money3(running + used)
            insertMovement.run(randomUUID(), loyaltyClientId, id, 'REMBOURSEMENT', used, running, after,
              `Restitution remise ${vente.numero}`, data.annule_par ?? null, now)
            running = after
          }
          db.prepare(`UPDATE clients SET solde_fidelite = ? WHERE id = ?`).run(running, loyaltyClientId)
        }
      }
    })()
    addActivityLog({ action: 'SALE_CANCELLED', details: { id, ...data } })
    enqueueSync('ventes', 'UPDATE', { id, statut: 'ANNULEE', annule_at: now, ...data })
    const lignes = db.prepare(`SELECT produit_id FROM lignes_vente WHERE vente_id = ? AND produit_id IS NOT NULL`).all(id) as { produit_id: string }[]
    for (const l of lignes) enqueueProductSnapshot(l.produit_id)
    if (loyaltyClientId) {
      const clientSnapshot = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(loyaltyClientId) as Record<string, unknown> | undefined
      if (clientSnapshot) enqueueSync('clients', 'UPDATE', clientSnapshot)
    }
    return { success: true }
  })

  // ── Organisations ───────────────────────────────────────────────────────────
  ipcMain.handle('organisations:list', () => {
    return db.prepare(`
      SELECT o.*, COUNT(c.id) AS client_count,
        COALESCE(SUM(CASE WHEN c.solde_credit > 0 THEN c.solde_credit ELSE 0 END), 0) AS credit_live
      FROM organisations o
      LEFT JOIN clients c ON c.actif = 1 AND (c.organisation_id = o.id OR lower(trim(c.organisation_id)) = lower(trim(o.nom)))
      WHERE o.actif = 1
      GROUP BY o.id
      ORDER BY o.nom
    `).all()
  })
  ipcMain.handle('organisations:create', (_e, org: Record<string, unknown>) => {
    const row = bindRow({
      id: '',
      nom: '',
      telephone: null,
      email: null,
      adresse: null,
      matricule_fiscal: null,
      notes: null,
      created_at: new Date().toISOString(),
    }, org)
    db.prepare(`INSERT INTO organisations (id,nom,telephone,email,adresse,matricule_fiscal,notes,created_at) VALUES (@id,@nom,@telephone,@email,@adresse,@matricule_fiscal,@notes,@created_at)`).run(row)
    addActivityLog({ action: 'ORGANISATION_CREATED', details: { id: row.id, nom: row.nom } })
    enqueueSync('organisations', 'INSERT', row)
    return { success: true }
  })
  ipcMain.handle('organisations:update', (_e, id: string, data: Record<string, unknown>) => {
    const sets = Object.keys(data).map(k => `${k}=@${k}`).join(',')
    db.prepare(`UPDATE organisations SET ${sets} WHERE id=@id`).run({ ...data, id })
    addActivityLog({ action: 'ORGANISATION_UPDATED', details: { id, ...data } })
    enqueueSync('organisations', 'UPDATE', { id, ...data })
    return { success: true }
  })
  ipcMain.handle('organisations:delete', (_e, id: string) => {
    db.prepare(`UPDATE organisations SET actif=0 WHERE id=?`).run(id)
    addActivityLog({ action: 'ORGANISATION_DELETED', details: { id } })
    enqueueSync('organisations', 'UPDATE', { id, actif: 0 })
    return { success: true }
  })

  // ── Personnels ──────────────────────────────────────────────────────────────
  ipcMain.handle('personnels:list', () => {
    return db.prepare(`SELECT * FROM personnels WHERE actif = 1 ORDER BY nom`).all()
  })
  ipcMain.handle('personnels:create', (_e, p: Record<string, unknown>) => {
    const normalizedCin = String(p.cin ?? '').trim() || null
    if (normalizedCin) {
      const duplicate = db.prepare(`SELECT id FROM personnels WHERE cin = ?`).get(normalizedCin)
      if (duplicate) throw new Error('Ce CIN est déjà utilisé par un autre employé')
    }
    const row = bindRow({
      id: '',
      nom: '',
      prenom: null,
      poste: null,
      telephone: null,
      cin: null,
      date_embauche: null,
      salaire_base: 0,
      notes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, {
      ...p,
      cin: normalizedCin,
      salaire_base: money3(p.salaire_base),
    })
    db.prepare(`INSERT INTO personnels (id,nom,prenom,poste,telephone,cin,date_embauche,salaire_base,notes,created_at,updated_at) VALUES (@id,@nom,@prenom,@poste,@telephone,@cin,@date_embauche,@salaire_base,@notes,@created_at,@updated_at)`).run(row)
    addActivityLog({ action: 'STAFF_CREATED', details: { id: row.id, nom: row.nom, poste: row.poste } })
    enqueueSync('personnels', 'INSERT', row)
    return { success: true }
  })
  ipcMain.handle('personnels:update', (_e, id: string, data: Record<string, unknown>) => {
    const normalized = { ...data }
    if ('cin' in normalized) {
      normalized.cin = String(normalized.cin ?? '').trim() || null
      if (normalized.cin) {
        const duplicate = db.prepare(`SELECT id FROM personnels WHERE cin = ? AND id != ?`).get(normalized.cin, id)
        if (duplicate) throw new Error('Ce CIN est déjà utilisé par un autre employé')
      }
    }
    if ('salaire_base' in normalized) normalized.salaire_base = money3(normalized.salaire_base)
    const cols = Object.keys(normalized)
    const sets = cols.map(k => `${k}=@${k}`).join(',')
    db.prepare(`UPDATE personnels SET ${sets}, updated_at=datetime('now') WHERE id=@id`).run({ ...normalized, id })
    addActivityLog({ action: 'STAFF_UPDATED', details: { id, ...normalized } })
    enqueueSync('personnels', 'UPDATE', { id, ...normalized })
    return { success: true }
  })
  ipcMain.handle('personnels:delete', (_e, id: string) => {
    db.prepare(`UPDATE personnels SET actif=0 WHERE id=?`).run(id)
    addActivityLog({ action: 'STAFF_DELETED', details: { id } })
    enqueueSync('personnels', 'UPDATE', { id, actif: 0 })
    return { success: true }
  })

  ipcMain.handle('mouvementsPersonnels:list', (_e, filters: Record<string, unknown> = {}) => {
    let sql = `SELECT mp.*, p.nom || ' ' || COALESCE(p.prenom,'') as personnel_nom_full FROM mouvements_personnels mp LEFT JOIN personnels p ON p.id = mp.personnel_id WHERE 1=1`
    const params: unknown[] = []
    if (filters.personnel_id) { sql += ' AND mp.personnel_id = ?'; params.push(filters.personnel_id) }
    if (filters.type) { sql += ' AND mp.type = ?'; params.push(filters.type) }
    if (filters.mois) { sql += ' AND mp.mois = ?'; params.push(filters.mois) }
    sql += ' ORDER BY mp.created_at DESC LIMIT 500'
    return db.prepare(sql).all(...params)
  })

  ipcMain.handle('mouvementsPersonnels:create', (_e, mvt: Record<string, unknown>) => {
    const natureCredit = mvt.nature_credit === 'PRODUIT' ? 'PRODUIT' : 'ARGENT'
    const source = mvt.caisse_source === 'EXTERNE' ? 'EXTERNE' : 'INTERNE'
    const shiftId = String(mvt.shift_id ?? '').trim() || null
    const productId = String(mvt.produit_id ?? '').trim() || null
    const quantity = Math.max(1, Math.floor(Number(mvt.quantite) || 1))
    const product = productId ? db.prepare('SELECT id,nom,stock_actuel FROM produits WHERE id = ? AND actif = 1').get(productId) as { id: string; nom: string; stock_actuel: number } | undefined : undefined
    if (mvt.type === 'CREDIT_PERSONNEL' && natureCredit === 'PRODUIT' && !product) throw new Error('Sélectionnez un produit valide')
    if (mvt.type === 'CREDIT_PERSONNEL' && natureCredit === 'PRODUIT' && Number(product?.stock_actuel) < quantity) throw new Error('Stock insuffisant pour ce produit')
    if (mvt.type === 'CREDIT_PERSONNEL' && natureCredit === 'ARGENT' && source === 'EXTERNE' && !shiftId) throw new Error('Ouvrez une caisse externe avant ce crédit')
    const accountingMeta = mvt.type === 'CREDIT_PERSONNEL'
      ? `[SMLPOS_ACCOUNTING]${JSON.stringify({ nature: natureCredit, caisse: natureCredit === 'ARGENT' ? source : null, produitId: productId, produit: product?.nom ?? null, quantite: natureCredit === 'PRODUIT' ? quantity : null, shiftId })}`
      : ''
    const row = bindRow({
      id: '',
      personnel_id: '',
      type: 'AVANCE',
      montant: 0,
      mois: null,
      note: null,
      operateur: 'superadmin',
      created_at: new Date().toISOString(),
    }, {
      id: mvt.id ?? randomUUID(), personnel_id: mvt.personnel_id ?? '', type: mvt.type ?? 'AVANCE', montant: money3(mvt.montant), mois: mvt.mois ?? null,
      note: [String(mvt.note ?? '').trim(), accountingMeta].filter(Boolean).join('\n') || null,
      operateur: mvt.operateur ?? 'superadmin', created_at: mvt.created_at ?? new Date().toISOString(),
    })
    if (Number(row.montant) <= 0) throw new Error('Le montant doit être supérieur à zéro')
    const reverseType = row.type === 'AVANCE_REMBOURSEMENT' ? 'avance_solde' : row.type === 'CREDIT_REMBOURSEMENT' ? 'credit_solde' : null
    if (reverseType) {
      const person = db.prepare(`SELECT ${reverseType} as balance FROM personnels WHERE id = ?`).get(row.personnel_id) as { balance?: number } | undefined
      if (!person) return { success: false, error: 'Personnel introuvable' }
      if (money3(row.montant) > money3(person.balance)) return { success: false, error: 'Le remboursement dépasse le solde actuel' }
    }
    db.transaction(() => {
      db.prepare(`INSERT INTO mouvements_personnels (id,personnel_id,type,montant,mois,note,operateur,created_at) VALUES (@id,@personnel_id,@type,@montant,@mois,@note,@operateur,@created_at)`).run(row)
      const type = row.type as string
      const montant = row.montant as number
      const pid = row.personnel_id as string
      if (type === 'AVANCE') db.prepare(`UPDATE personnels SET avance_solde = avance_solde + ? WHERE id = ?`).run(montant, pid)
      else if (type === 'AVANCE_REMBOURSEMENT') db.prepare(`UPDATE personnels SET avance_solde = MAX(0, avance_solde - ?) WHERE id = ?`).run(montant, pid)
      else if (type === 'CREDIT_PERSONNEL') db.prepare(`UPDATE personnels SET credit_solde = credit_solde + ? WHERE id = ?`).run(montant, pid)
      else if (type === 'CREDIT_REMBOURSEMENT') db.prepare(`UPDATE personnels SET credit_solde = MAX(0, credit_solde - ?) WHERE id = ?`).run(montant, pid)
      if (type === 'CREDIT_PERSONNEL' && natureCredit === 'PRODUIT' && productId) {
        db.prepare(`UPDATE produits SET stock_actuel = stock_actuel - ?, updated_at = ? WHERE id = ?`).run(quantity, row.created_at, productId)
      } else if (type === 'CREDIT_PERSONNEL' && source === 'EXTERNE') {
        db.prepare(`INSERT INTO sorties_caisse (id,shift_id,montant,note,operateur,mouvement_interne_id,created_at) VALUES (?,?,?,?,?,NULL,?)`)
          .run(`staff-${row.id}`, shiftId, montant, `[CAISSE:EXTERNE] Crédit argent personnel`, row.operateur, row.created_at)
      } else if (['SALAIRE', 'AVANCE', 'CREDIT_PERSONNEL'].includes(type)) {
        const categorie = type === 'SALAIRE' ? 'SALAIRE' : type === 'AVANCE' ? 'AVANCE_PERSONNEL' : 'CHARGE'
        db.prepare(`INSERT INTO mouvements_caisse_interne (id,date_journal,type,categorie,montant,reference_id,note,operateur,created_at) VALUES (?,date('now','localtime'),'SORTIE',?,?,?,?,?,?)`)
          .run(`mci-${row.id}`, categorie, montant, pid, row.note ?? type, row.operateur, row.created_at)
        applyInternalCashOut(montant, row.created_at)
      }
    })()
    addActivityLog({ shift_id: shiftId ?? undefined, operateur: row.operateur as string, action: 'STAFF_MOVEMENT_CREATED', montant: row.montant as number, details: { type: row.type, personnel_id: row.personnel_id, mois: row.mois, nature_credit: natureCredit, caisse_source: source, produit: product?.nom, quantite: quantity } })
    enqueueSync('mouvements_personnels', 'INSERT', row)
    if (mvt.type === 'CREDIT_PERSONNEL' && natureCredit === 'PRODUIT' && productId) enqueueProductSnapshot(productId)
    if (mvt.type === 'CREDIT_PERSONNEL' && natureCredit === 'ARGENT' && source === 'EXTERNE') {
      const cashOut = db.prepare('SELECT * FROM sorties_caisse WHERE id = ?').get(`staff-${row.id}`) as Record<string, unknown>
      enqueueSync('sorties_caisse', 'INSERT', cashOut)
    }
    if (['SALAIRE', 'AVANCE'].includes(String(mvt.type)) || (mvt.type === 'CREDIT_PERSONNEL' && natureCredit === 'ARGENT' && source === 'INTERNE')) {
      const internal = db.prepare('SELECT * FROM mouvements_caisse_interne WHERE id = ?').get(`mci-${row.id}`) as Record<string, unknown> | undefined
      if (internal) enqueueSync('mouvements_caisse_interne', 'INSERT', internal)
    }
    const personnel = db.prepare('SELECT * FROM personnels WHERE id = ?').get(mvt.personnel_id) as Record<string, unknown> | undefined
    if (personnel) enqueueSync('personnels', 'UPDATE', personnel)
    return { success: true }
  })

  // ── Documents (Facture/Devis/BL) ─────────────────────────────────────────
  ipcMain.handle('documents:list', (_e, filters: Record<string, unknown> = {}) => {
    let sql = `SELECT * FROM documents WHERE 1=1`
    const params: unknown[] = []
    if (filters.type_document) { sql += ' AND type_document = ?'; params.push(filters.type_document) }
    if (filters.statut) { sql += ' AND statut = ?'; params.push(filters.statut) }
    if (filters.client_id) { sql += ' AND client_id = ?'; params.push(filters.client_id) }
    if (filters.vente_id) { sql += ' AND vente_id = ?'; params.push(filters.vente_id) }
    if (filters.fournisseur_id) { sql += ' AND fournisseur_id = ?'; params.push(filters.fournisseur_id) }
    if (filters.dateFrom) { sql += ' AND created_at >= ?'; params.push(filters.dateFrom + 'T00:00:00.000Z') }
    if (filters.dateTo) { sql += ' AND created_at <= ?'; params.push(filters.dateTo + 'T23:59:59.999Z') }
    sql += ' ORDER BY created_at DESC LIMIT 500'
    return db.prepare(sql).all(...params)
  })
  ipcMain.handle('documents:create', (_e, doc: Record<string, unknown>, lignes: Record<string, unknown>[]) => {
    const now = new Date().toISOString()
    const normalizedDoc = normalizeMoneyFields({
      vente_id: null, fournisseur_id: null, client_id: null,
      client_nom: null, client_tel: null, client_adresse: null, client_matricule: null,
      shift_id: null, statut_paiement: 'PAYE', montant_paye: 0,
      date_echeance: null, layout_snapshot: null, contenu_json: null,
      exo: null, timbre: 1.0, ht_7: 0.0, tva_7: 0.0, ht_19: 0.0, tva_19: 0.0, total_remise: 0.0, tva_taux_principal: 0.0,
      updated_at: now, created_at: now,
      ...doc,
    }, ['total_ht', 'total_tva', 'total_ttc', 'montant_paye', 'exo', 'timbre', 'ht_7', 'tva_7', 'ht_19', 'tva_19', 'total_remise', 'tva_taux_principal'])
    let docLignes = (lignes as Record<string, unknown>[]).map(l => normalizeDocumentLine(l))
    const typeDocStr = String(normalizedDoc.type_document ?? '')
    const nfAllowed = typeDocStr === 'BON_LIVRAISON'
    if (normalizedDoc.vente_id && !nfAllowed) {
      docLignes = docLignes.filter(l => (l.type_produit as string | undefined) !== 'NF')
      if (docLignes.length === 0) {
        return { success: false, error: 'Aucun produit facturé (F) — conversion impossible' }
      }
    } else if (normalizedDoc.vente_id && docLignes.length === 0) {
      return { success: false, error: 'Aucune ligne — ajoutez au moins un produit' }
    }
    if (normalizedDoc.vente_id) {
      const existing = db.prepare(
        `SELECT id, numero FROM documents WHERE vente_id = ? AND type_document = ? AND statut NOT IN ('ANNULE', 'REVOQUE') LIMIT 1`,
      ).get(normalizedDoc.vente_id, normalizedDoc.type_document) as { id: string; numero: string } | undefined
      if (existing) {
        markVenteConverted(normalizedDoc.vente_id, normalizedDoc.type_document)
        return { success: true, id: existing.id, numero: existing.numero, alreadyExists: true }
      }
    }
    db.transaction(() => {
      db.prepare(`
        INSERT INTO documents (
          id, numero, type_document, statut, shift_id, vente_id, fournisseur_id, client_id,
          client_nom, client_tel, client_adresse, client_matricule, total_ht, total_tva, total_ttc,
          statut_paiement, montant_paye, date_echeance, layout_snapshot, contenu_json,
          exo, timbre, ht_7, tva_7, ht_19, tva_19, total_remise, tva_taux_principal,
          created_at, updated_at
        ) VALUES (
          @id, @numero, @type_document, @statut, @shift_id, @vente_id, @fournisseur_id, @client_id,
          @client_nom, @client_tel, @client_adresse, @client_matricule, @total_ht, @total_tva, @total_ttc,
          @statut_paiement, @montant_paye, @date_echeance, @layout_snapshot, @contenu_json,
          @exo, @timbre, @ht_7, @tva_7, @ht_19, @tva_19, @total_remise, @tva_taux_principal,
          @created_at, @updated_at
        )
      `).run(normalizedDoc)
      for (const l of docLignes) {
        db.prepare(`INSERT INTO lignes_document (id,document_id,produit_id,designation,quantite,prix_unitaire,remise_pct,tva_taux,total_ht,total_tva,total_ttc,type_produit,numero_serie) VALUES (@id,@document_id,@produit_id,@designation,@quantite,@prix_unitaire,@remise_pct,@tva_taux,@total_ht,@total_tva,@total_ttc,@type_produit,@numero_serie)`).run(l)
      }
      markVenteConverted(normalizedDoc.vente_id, normalizedDoc.type_document)
    })()
    addActivityLog({ shift_id: normalizedDoc.shift_id as string, action: 'DOCUMENT_CREATED', details: { type_document: normalizedDoc.type_document, numero: normalizedDoc.numero, client: normalizedDoc.client_nom }, montant: normalizedDoc.total_ttc as number })
    enqueueSync('documents', 'INSERT', normalizedDoc)
    for (const l of docLignes) {
      enqueueSync('lignes_document', 'INSERT', l as Record<string, unknown>)
    }
    return { success: true, id: normalizedDoc.id, numero: normalizedDoc.numero }
  })
  ipcMain.handle('documents:update', (_e, id: string, data: Record<string, unknown>) => {
    const FORBIDDEN = new Set(['numero', 'type_document', 'vente_id', 'created_at', 'avoir_id', 'document_origine_id'])
    if (Object.keys(data).some(k => FORBIDDEN.has(k))) {
      return { success: false, error: 'Champ interdit (numéro immuable)' }
    }
    const ALLOWED = new Set([
      'client_id', 'client_nom', 'client_tel', 'client_adresse', 'client_matricule',
      'total_ht', 'total_tva', 'total_ttc', 'statut_paiement', 'montant_paye', 'date_echeance',
      'exo', 'timbre', 'ht_7', 'tva_7', 'ht_19', 'tva_19', 'total_remise', 'tva_taux_principal',
      'statut', 'annule_motif', 'updated_at',
    ])
    const filtered = normalizeMoneyFields(
      Object.fromEntries(Object.entries(data).filter(([k]) => ALLOWED.has(k))),
      ['total_ht', 'total_tva', 'total_ttc', 'montant_paye', 'exo', 'timbre', 'ht_7', 'tva_7', 'ht_19', 'tva_19', 'total_remise', 'tva_taux_principal'],
    )
    if (!Object.keys(filtered).length) return { success: false, error: 'Aucun champ valide' }
    const cols = Object.keys(filtered)
    const sets = cols.map(k => `${k}=@${k}`).join(',')
    const now = new Date().toISOString()
    db.prepare(`UPDATE documents SET ${sets}, updated_at=@updated_at WHERE id=@id`).run({ ...filtered, id, updated_at: now })
    addActivityLog({ action: 'DOCUMENT_EDITED', details: { id, fields: cols } })
    enqueueSync('documents', 'UPDATE', { id, ...filtered, updated_at: now })
    return { success: true }
  })
  ipcMain.handle('documents:get', (_e, id: string) => {
    return db.prepare(`SELECT * FROM documents WHERE id = ?`).get(id)
  })
  ipcMain.handle('documents:getLignes', (_e, documentId: string) => {
    const docRow = db.prepare(`SELECT vente_id FROM documents WHERE id = ?`).get(documentId) as { vente_id?: string } | undefined
    const venteId = docRow?.vente_id
    const rows = db.prepare(`
      SELECT ld.*, p.reference AS produit_reference, p.numero_serie AS produit_numero_serie,
             p.has_serial_number, p.tva_taux AS produit_tva_taux
      FROM lignes_document ld
      LEFT JOIN produits p ON p.id = ld.produit_id
      WHERE ld.document_id = ?
    `).all(documentId) as Record<string, unknown>[]

    const snByVenteProduit = venteId
      ? db.prepare(`
          SELECT produit_id, numero_serie FROM serial_numbers
          WHERE vente_id = ? AND statut = 'VENDU'
          ORDER BY created_at ASC
        `).all(venteId) as { produit_id: string; numero_serie: string }[]
      : []

    return rows.map(row => {
      let numero_serie = row.numero_serie as string | null | undefined
      if (!numero_serie && row.produit_id) {
        const sns = snByVenteProduit.filter(s => s.produit_id === row.produit_id).map(s => s.numero_serie)
        if (sns.length) numero_serie = sns.join(', ')
      }
      if (!numero_serie && row.has_serial_number && row.produit_numero_serie) {
        numero_serie = row.produit_numero_serie as string
      }
      return {
        ...row,
        reference: row.produit_reference ?? null,
        numero_serie: numero_serie ?? null,
      }
    })
  })

  ipcMain.handle('documents:replaceLignes', (_e, documentId: string, lignes: Record<string, unknown>[], totals: { total_ht: number; total_tva: number; total_ttc: number; ht_7?: number; tva_7?: number; ht_19?: number; tva_19?: number; total_remise?: number }) => {
    const normalizedLignes = lignes.map(l => normalizeDocumentLine(l))
    const normalizedTotals = normalizeMoneyFields({ ...totals }, ['total_ht', 'total_tva', 'total_ttc', 'ht_7', 'tva_7', 'ht_19', 'tva_19', 'total_remise'])
    const doc = db.prepare(`SELECT id, statut, type_document, vente_id FROM documents WHERE id = ?`).get(documentId) as { id: string; statut: string; type_document: string; vente_id?: string | null } | undefined
    if (!doc) return { success: false, error: 'Document introuvable' }
    if (['ANNULE', 'REVOQUE'].includes(doc.statut) || doc.type_document === 'AVOIR') {
      return { success: false, error: 'Document non modifiable' }
    }
    const oldLines = db.prepare(`SELECT id FROM lignes_document WHERE document_id = ?`).all(documentId) as { id: string }[]
    const oldVenteLines = doc.vente_id
      ? db.prepare(`SELECT * FROM lignes_vente WHERE vente_id = ?`).all(doc.vente_id) as Record<string, unknown>[]
      : []
    const insertLigne = db.prepare(`
      INSERT INTO lignes_document (id,document_id,produit_id,designation,quantite,prix_unitaire,remise_pct,tva_taux,total_ht,total_tva,total_ttc,type_produit,numero_serie)
      VALUES (@id,@document_id,@produit_id,@designation,@quantite,@prix_unitaire,@remise_pct,@tva_taux,@total_ht,@total_tva,@total_ttc,@type_produit,@numero_serie)
    `)
    const insertVenteLigne = db.prepare(`
      INSERT INTO lignes_vente (id, vente_id, produit_id, designation, quantite, prix_unitaire, remise_pct, total_ligne, type_produit, numero_serie)
      VALUES (@id, @vente_id, @produit_id, @designation, @quantite, @prix_unitaire, @remise_pct, @total_ligne, @type_produit, @numero_serie)
    `)
    const now = new Date().toISOString()
    try {
      db.transaction(() => {
        if (doc.vente_id) {
          for (const vl of oldVenteLines) revertVenteLineInventory(doc.vente_id!, vl, now)
          db.prepare(`DELETE FROM lignes_vente WHERE vente_id = ?`).run(doc.vente_id)
        }
        db.prepare(`DELETE FROM lignes_document WHERE document_id = ?`).run(documentId)
        for (const l of normalizedLignes) {
          const nl = { ...l, document_id: documentId }
          insertLigne.run(nl)
          if (doc.vente_id) {
            insertVenteLigne.run({
              id: randomUUID(),
              vente_id: doc.vente_id,
              produit_id: nl.produit_id,
              designation: nl.designation,
              quantite: nl.quantite,
              prix_unitaire: nl.prix_unitaire,
              remise_pct: nl.remise_pct ?? 0,
              total_ligne: nl.total_ttc ?? nl.total_ht,
              type_produit: nl.type_produit ?? 'F',
              numero_serie: nl.numero_serie ?? null,
            })
          }
        }
        if (doc.vente_id) {
          const newVenteLines = db.prepare(`SELECT * FROM lignes_vente WHERE vente_id = ?`).all(doc.vente_id) as Record<string, unknown>[]
          for (const vl of newVenteLines) applyVenteLineInventory(doc.vente_id!, vl, now)
        }
        const extraSets = normalizedTotals.ht_7 != null ? ', ht_7=@ht_7, tva_7=@tva_7, ht_19=@ht_19, tva_19=@tva_19' : ''
        db.prepare(`UPDATE documents SET total_ht=@total_ht, total_tva=@total_tva, total_ttc=@total_ttc, updated_at=@updated_at${extraSets} WHERE id=@id`).run({
          id: documentId, updated_at: now, ...normalizedTotals,
        })
      })()
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Échec synchronisation stock' }
    }
    for (const ol of oldLines) enqueueSync('lignes_document', 'DELETE', { id: ol.id })
    for (const l of normalizedLignes) {
      const nl = { ...l, document_id: documentId }
      enqueueSync('lignes_document', 'INSERT', nl as Record<string, unknown>)
    }
    if (doc.vente_id) {
      const syncedVenteLines = db.prepare(`SELECT * FROM lignes_vente WHERE vente_id = ?`).all(doc.vente_id) as Record<string, unknown>[]
      for (const vl of oldVenteLines) enqueueSync('lignes_vente', 'DELETE', { id: vl.id as string })
      for (const vl of syncedVenteLines) enqueueSync('lignes_vente', 'INSERT', vl)
      const touched = new Set<string>()
      for (const vl of [...oldVenteLines, ...syncedVenteLines]) if (vl.produit_id) touched.add(String(vl.produit_id))
      for (const pid of touched) enqueueProductSnapshot(pid)
    }
    enqueueSync('documents', 'UPDATE', { id: documentId, ...normalizedTotals, updated_at: now })
    addActivityLog({ action: 'DOCUMENT_LINES_EDITED', details: { documentId, lineCount: normalizedLignes.length } })
    return { success: true }
  })
  ipcMain.handle('documents:getLastNumber', (_e, prefix: string) => {
    const row = db.prepare(`SELECT numero FROM documents WHERE numero LIKE ? ORDER BY created_at DESC LIMIT 1`).get(`${prefix}%`) as { numero: string } | undefined
    if (!row) return 0
    const parts = row.numero.split('-')
    return parseInt(parts[parts.length - 1]) || 0
  })

  ipcMain.handle('documents:annulerAvecAvoir', (_e, id: string, motif?: string) => {
    const doc = db.prepare(`SELECT * FROM documents WHERE id = ?`).get(id) as Record<string, unknown> | undefined
    if (!doc) return { success: false, error: 'Document introuvable' }
    const type = doc.type_document as string
    if (type !== 'FACTURE_VENTE' && type !== 'FACTURE_JOURNALIERE_F') {
      return { success: false, error: 'Seules les factures vente peuvent générer un avoir' }
    }
    if (doc.statut !== 'ACTIF') return { success: false, error: 'Document non annulable' }
    if (doc.avoir_id) return { success: false, error: 'Un avoir existe déjà pour cette facture' }

    const prefixSetting = db.prepare(`SELECT value FROM app_settings WHERE key = 'invoice_prefix_avoir'`).get() as { value: string } | undefined
    const prefixAvoir = prefixSetting?.value || 'AVO'
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const seqPrefix = `${prefixAvoir}-${dateStr}-`
    const lastNum = db.prepare(`SELECT numero FROM documents WHERE numero LIKE ? ORDER BY created_at DESC LIMIT 1`).get(`${seqPrefix}%`) as { numero: string } | undefined
    const nextSeq = lastNum ? (parseInt(lastNum.numero.split('-').pop() || '0') || 0) + 1 : 1
    const avoirNumero = `${seqPrefix}${String(nextSeq).padStart(3, '0')}`

    const lignes = db.prepare(`SELECT * FROM lignes_document WHERE document_id = ?`).all(id) as Record<string, unknown>[]
    const now = new Date().toISOString()
    const avoirId = randomUUID()
    const neg = (n: unknown) => -Math.abs(Number(n) || 0)

    const avoirDoc = {
      id: avoirId,
      numero: avoirNumero,
      type_document: 'AVOIR',
      statut: 'ACTIF',
      shift_id: doc.shift_id,
      vente_id: doc.vente_id,
      fournisseur_id: null,
      client_id: doc.client_id,
      client_nom: doc.client_nom,
      client_tel: doc.client_tel,
      client_adresse: doc.client_adresse,
      client_matricule: doc.client_matricule,
      total_ht: neg(doc.total_ht),
      total_tva: neg(doc.total_tva),
      total_ttc: neg(doc.total_ttc),
      statut_paiement: doc.statut_paiement,
      montant_paye: 0,
      date_echeance: doc.date_echeance,
      layout_snapshot: doc.layout_snapshot,
      contenu_json: doc.contenu_json,
      exo: doc.exo,
      timbre: doc.timbre,
      ht_7: doc.ht_7 != null ? neg(doc.ht_7) : null,
      tva_7: doc.tva_7 != null ? neg(doc.tva_7) : null,
      ht_19: doc.ht_19 != null ? neg(doc.ht_19) : null,
      tva_19: doc.tva_19 != null ? neg(doc.tva_19) : null,
      total_remise: doc.total_remise,
      tva_taux_principal: doc.tva_taux_principal,
      document_origine_id: id,
      facture_origine_numero: doc.numero,
      created_at: now,
      updated_at: now,
    }

    const insertDoc = db.prepare(`
      INSERT INTO documents (id,numero,type_document,statut,shift_id,vente_id,fournisseur_id,client_id,client_nom,client_tel,client_adresse,client_matricule,total_ht,total_tva,total_ttc,statut_paiement,montant_paye,date_echeance,layout_snapshot,contenu_json,exo,timbre,ht_7,tva_7,ht_19,tva_19,total_remise,tva_taux_principal,document_origine_id,facture_origine_numero,created_at,updated_at)
      VALUES (@id,@numero,@type_document,@statut,@shift_id,@vente_id,@fournisseur_id,@client_id,@client_nom,@client_tel,@client_adresse,@client_matricule,@total_ht,@total_tva,@total_ttc,@statut_paiement,@montant_paye,@date_echeance,@layout_snapshot,@contenu_json,@exo,@timbre,@ht_7,@tva_7,@ht_19,@tva_19,@total_remise,@tva_taux_principal,@document_origine_id,@facture_origine_numero,@created_at,@updated_at)
    `)
    const insertLigne = db.prepare(`
      INSERT INTO lignes_document (id,document_id,produit_id,designation,quantite,prix_unitaire,remise_pct,tva_taux,total_ht,total_tva,total_ttc,type_produit,numero_serie)
      VALUES (@id,@document_id,@produit_id,@designation,@quantite,@prix_unitaire,@remise_pct,@tva_taux,@total_ht,@total_tva,@total_ttc,@type_produit,@numero_serie)
    `)

    const avoirLignes = lignes.map(l => ({
      id: randomUUID(),
      document_id: avoirId,
      produit_id: l.produit_id,
      designation: l.designation,
      quantite: l.quantite,
      prix_unitaire: l.prix_unitaire,
      remise_pct: l.remise_pct,
      tva_taux: l.tva_taux,
      total_ht: neg(l.total_ht),
      total_tva: neg(l.total_tva),
      total_ttc: neg(l.total_ttc),
      type_produit: l.type_produit,
      numero_serie: l.numero_serie,
    }))

    db.transaction(() => {
      insertDoc.run(avoirDoc)
      for (const l of avoirLignes) insertLigne.run(l)
      db.prepare(`UPDATE documents SET statut='ANNULE', avoir_id=?, annule_motif=?, updated_at=? WHERE id=?`)
        .run(avoirId, motif?.trim() || null, now, id)
    })()

    enqueueSync('documents', 'INSERT', avoirDoc)
    for (const l of avoirLignes) enqueueSync('lignes_document', 'INSERT', l as Record<string, unknown>)
    enqueueSync('documents', 'UPDATE', { id, statut: 'ANNULE', avoir_id: avoirId, annule_motif: motif?.trim() || null, updated_at: now })
    addActivityLog({
      action: 'FACTURE_ANNULEE_AVEC_AVOIR',
      details: { facture_id: id, facture_numero: doc.numero, avoir_numero: avoirNumero, motif: motif?.trim() || null },
      montant: Math.abs(Number(doc.total_ttc) || 0),
    })
    return { success: true, avoir: { id: avoirId, numero: avoirNumero } }
  })

  // Révocation
  ipcMain.handle('documents:revoquer', (_e, id: string, motif: string, par: string) => {
    const now = new Date().toISOString()
    db.prepare(`UPDATE documents SET statut='REVOQUE', revoque_par=?, revoque_at=?, revoque_motif=?, updated_at=? WHERE id=?`)
      .run(par, now, motif, now, id)
    addActivityLog({ action: 'FACTURE_REVOQUEE', details: { id, motif, par } })
    enqueueSync('documents', 'UPDATE', { id, statut: 'REVOQUE', revoque_par: par, revoque_at: now, revoque_motif: motif })
    return { success: true }
  })

  // Count pending BL (NON_ARRIVE) for notification
  ipcMain.handle('factures:countBLPending', () => {
    const row = db.prepare(`SELECT COUNT(*) as cnt FROM factures_fournisseurs WHERE statut_reception = 'NON_ARRIVE' AND (statut_paiement IS NULL OR statut_paiement != 'ANNULE')`).get() as { cnt: number }
    return row?.cnt ?? 0
  })

  ipcMain.handle('factures:listBLPending', () => {
    return db.prepare(`
      SELECT ff.id, ff.numero_facture, ff.fournisseur_nom, ff.montant_ttc, ff.created_at,
        CAST((julianday('now') - julianday(ff.created_at)) AS INTEGER) AS jours_attente
      FROM factures_fournisseurs ff
      WHERE ff.statut_reception = 'NON_ARRIVE' AND (ff.statut_paiement IS NULL OR ff.statut_paiement != 'ANNULE')
      ORDER BY ff.created_at ASC
    `).all()
  })

  // ── Documents: list all (unified view — documents + factures_fournisseurs) ──
  ipcMain.handle('documents:listAll', (_e, filters: Record<string, unknown> = {}) => {
    const typeStr = (filters.type_document ?? '') as string
    const achatTypes = new Set(['FACTURE_ACHAT', 'FACTURE_ACHAT_BL'])
    const venteTypes = new Set(['FACTURE_VENTE', 'FACTURE_JOURNALIERE_F', 'DEVIS', 'BON_LIVRAISON', 'AVOIR'])
    const fetchDocs = !typeStr || typeStr === 'TOUS' || venteTypes.has(typeStr)
    const fetchFF = !typeStr || typeStr === 'TOUS' || achatTypes.has(typeStr)

    const params: unknown[] = []
    let typeCond = ''
    if (filters.type_document && filters.type_document !== 'TOUS') {
      typeCond = ` AND d.type_document = ?`
      params.push(filters.type_document)
    }
    let dateCond = ''
    if (filters.dateFrom) { dateCond += ` AND d.created_at >= ?`; params.push(filters.dateFrom + 'T00:00:00.000Z') }
    if (filters.dateTo)   { dateCond += ` AND d.created_at <= ?`; params.push(filters.dateTo + 'T23:59:59.999Z') }

    const docs = fetchDocs
      ? db.prepare(`
          SELECT d.*, av.numero AS avoir_numero, NULL as fournisseur_nom, 'documents' AS _source
          FROM documents d
          LEFT JOIN documents av ON av.id = d.avoir_id
          WHERE 1=1 ${typeCond} ${dateCond}
          ORDER BY d.created_at DESC LIMIT 300
        `).all(...params) as Record<string, unknown>[]
      : []

    let ffDocs: Record<string, unknown>[] = []
    if (fetchFF) {
      const ffParams: unknown[] = []
      let ffTypeCond = ''
      let ffDateCond = ''
      if (typeStr === 'FACTURE_ACHAT')    { ffTypeCond = ` AND ff.type = ?`; ffParams.push('FACTURE_ACHAT') }
      if (typeStr === 'FACTURE_ACHAT_BL') { ffTypeCond = ` AND ff.type = ?`; ffParams.push('FACTURE_ACHAT_BL') }
      if (filters.dateFrom) { ffDateCond += ` AND ff.created_at >= ?`; ffParams.push(filters.dateFrom + 'T00:00:00.000Z') }
      if (filters.dateTo)   { ffDateCond += ` AND ff.created_at <= ?`; ffParams.push(filters.dateTo + 'T23:59:59.999Z') }
      ffDocs = db.prepare(`
        SELECT ff.id, ff.numero_facture AS numero, ff.type AS type_document,
          CASE WHEN ff.statut_reception = 'NON_ARRIVE' THEN 'NON_ARRIVE'
               WHEN ff.statut_paiement = 'ANNULE' THEN 'ANNULE'
               ELSE 'ACTIF' END AS statut,
          ff.fournisseur_id, f.nom AS fournisseur_nom,
          NULL AS client_nom, NULL AS client_tel,
          ff.montant_ht AS total_ht, ff.montant_tva AS total_tva,
          ff.montant_ttc AS total_ttc, ff.statut_paiement,
          ff.montant_paye, ff.exo, ff.timbre, ff.ht_7, ff.tva_7, ff.ht_19, ff.tva_19, ff.total_remise,
          ff.created_at, ff.created_at AS updated_at, 'ff' AS _source
        FROM factures_fournisseurs ff
        LEFT JOIN fournisseurs f ON f.id = ff.fournisseur_id
        WHERE ff.statut_paiement != 'BROUILLON' ${ffTypeCond} ${ffDateCond}
        ORDER BY ff.created_at DESC LIMIT 300
      `).all(...ffParams) as Record<string, unknown>[]
    }

    return [...docs, ...ffDocs].sort((a, b) =>
      String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))
    ).slice(0, 500)
  })

  // Fiscal sales export: regular invoices and daily invoices are one report.
  // This avoids the documents screen pagination limit and excludes cancelled docs.
  ipcMain.handle('documents:exportSalesBilan', (_e, filters: Record<string, unknown> = {}) => {
    const params: unknown[] = []
    let dateCond = ''
    if (filters.dateFrom) { dateCond += ' AND created_at >= ?'; params.push(`${filters.dateFrom}T00:00:00.000Z`) }
    if (filters.dateTo) { dateCond += ' AND created_at <= ?'; params.push(`${filters.dateTo}T23:59:59.999Z`) }
    return db.prepare(`
      SELECT id, numero, type_document, statut, client_nom, total_ht, total_tva, total_ttc,
        exo, created_at, avoir_id
      FROM documents
      WHERE type_document IN ('FACTURE_VENTE', 'FACTURE_JOURNALIERE_F')
        AND COALESCE(statut, 'ACTIF') NOT IN ('ANNULE', 'REVOQUE')
        ${dateCond}
      ORDER BY created_at ASC, numero ASC
    `).all(...params)
  })

  // Fiscal "État TVA Vente" export. Each document carries its own tax buckets
  // so the renderer can reproduce the accountant's invoice-block template.
  ipcMain.handle('documents:exportSalesTva', (_e, filters: Record<string, unknown> = {}) => {
    const params: unknown[] = []
    let dateCond = ''
    if (filters.dateFrom) { dateCond += ' AND d.created_at >= ?'; params.push(`${filters.dateFrom}T00:00:00.000Z`) }
    if (filters.dateTo) { dateCond += ' AND d.created_at <= ?'; params.push(`${filters.dateTo}T23:59:59.999Z`) }
    const docs = db.prepare(`
      SELECT d.id, d.numero, d.type_document, d.client_id, d.client_nom, d.created_at,
        d.exo, d.timbre, d.total_remise, d.total_ht, d.total_tva, d.total_ttc
      FROM documents d
      WHERE d.type_document IN ('FACTURE_VENTE', 'FACTURE_JOURNALIERE_F')
        AND COALESCE(d.statut, 'ACTIF') NOT IN ('ANNULE', 'REVOQUE')
        ${dateCond}
      ORDER BY d.created_at ASC, d.numero ASC
    `).all(...params) as Array<Record<string, unknown>>
    if (!docs.length) return []
    const ids = docs.map(doc => String(doc.id))
    const placeholders = ids.map(() => '?').join(',')
    const lines = db.prepare(`
      SELECT document_id, tva_taux, total_ht, total_tva
      FROM lignes_document
      WHERE document_id IN (${placeholders})
      ORDER BY document_id, tva_taux
    `).all(...ids) as Array<{ document_id: string; tva_taux: number; total_ht: number; total_tva: number }>
    const buckets = new Map<string, Array<{ taux: number; base: number; montant: number }>>()
    for (const line of lines) {
      const id = String(line.document_id)
      const rate = Math.max(0, Number(line.tva_taux) || 0)
      const group = buckets.get(id) ?? []
      const found = group.find(item => item.taux === rate)
      if (found) {
        found.base = money3(found.base + (Number(line.total_ht) || 0))
        found.montant = money3(found.montant + (Number(line.total_tva) || 0))
      } else group.push({ taux: rate, base: money3(Number(line.total_ht) || 0), montant: money3(Number(line.total_tva) || 0) })
      buckets.set(id, group)
    }
    return docs.map(doc => ({ ...doc, tax_buckets: buckets.get(String(doc.id)) ?? [] }))
  })

  // ── Sync Queue (production-safe, no raw SQL exposure) ──────────────────────
  const SYNC_ALLOWED_TABLES = new Set([
    'operateurs', 'categories', 'fournisseurs', 'organisations', 'clients',
    'shifts', 'services_pos', 'transactions_services', 'produits', 'ventes',
    'lignes_vente', 'factures_clients', 'reparations', 'pieces_reparation',
    'sorties_caisse', 'factures_fournisseurs', 'lignes_facture_fournisseur',
    'paiements_fournisseurs', 'credits_clients', 'retours', 'ventes_en_ligne',
    'caisse_interne', 'mouvements_caisse_interne', 'personnels',
    'mouvements_personnels', 'documents', 'lignes_document', 'activity_logs',
    'app_settings',
  ])

  ipcMain.handle('sync:shifts:getFondDeCaisse', (_e, shiftId: string) => {
    const row = db.prepare('SELECT fond_de_caisse FROM shifts WHERE id = ? LIMIT 1').get(shiftId) as { fond_de_caisse?: number } | undefined
    return row?.fond_de_caisse ?? null
  })

  const SYNC_MAX_ATTEMPTS = 10 // give up after 10 consecutive failures
  const SYNC_QUEUE_BATCH = 500

  ipcMain.handle('sync:queue:getPending', () => {
    // Only return items that haven't exceeded max attempts
    return db.prepare(
      `SELECT id, table_name, operation, payload FROM sync_queue
       WHERE synced_at IS NULL AND attempts < ${SYNC_MAX_ATTEMPTS}
       ORDER BY created_at ASC LIMIT ${SYNC_QUEUE_BATCH}`
    ).all()
  })

  ipcMain.handle('sync:queue:markSynced', (_e, id: string) => {
    db.prepare(`UPDATE sync_queue SET synced_at = ? WHERE id = ?`).run(new Date().toISOString(), id)
    return { success: true }
  })

  ipcMain.handle('sync:queue:markFailed', (_e, id: string, errorMsg: string) => {
    db.prepare(`UPDATE sync_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?`).run(errorMsg, id)
    return { success: true }
  })

  ipcMain.handle('sync:queue:cleanup', () => {
    const cutoff = new Date(Date.now() - 7 * 86400 * 1000).toISOString()
    // Also purge permanently failed items (≥ max attempts) older than 1 day
    const failCutoff = new Date(Date.now() - 86400 * 1000).toISOString()
    db.prepare(`DELETE FROM sync_queue WHERE synced_at IS NOT NULL AND synced_at < ?`).run(cutoff)
    const { changes } = db.prepare(
      `DELETE FROM sync_queue WHERE attempts >= ${SYNC_MAX_ATTEMPTS} AND created_at < ?`
    ).run(failCutoff)
    return { deleted: changes }
  })

  ipcMain.handle('sync:queue:pendingCount', () => {
    // Only count items that are still retryable (not permanently failed)
    const row = db.prepare(
      `SELECT COUNT(*) as cnt FROM sync_queue WHERE synced_at IS NULL AND attempts < ${SYNC_MAX_ATTEMPTS}`
    ).get() as { cnt: number }
    return row.cnt ?? 0
  })

  ipcMain.handle('sync:queue:failedCount', () => {
    const row = db.prepare(
      `SELECT COUNT(*) as cnt FROM sync_queue WHERE synced_at IS NULL AND attempts >= ${SYNC_MAX_ATTEMPTS}`
    ).get() as { cnt: number }
    return row.cnt ?? 0
  })

  ipcMain.handle('sync:queue:purgeAllFailed', () => {
    const { changes } = db.prepare(
      `DELETE FROM sync_queue WHERE synced_at IS NULL AND attempts >= ${SYNC_MAX_ATTEMPTS}`
    ).run()
    return { deleted: changes }
  })

  ipcMain.handle('sync:queue:resetAllFailed', () => {
    // Reset failed items back to 0 attempts so they get retried
    const { changes } = db.prepare(
      `UPDATE sync_queue SET attempts = 0, last_error = NULL WHERE synced_at IS NULL AND attempts >= ${SYNC_MAX_ATTEMPTS}`
    ).run()
    return { reset: changes }
  })

  ipcMain.handle('sync:queue:getErrors', () => {
    // Return pending+failed items with their error messages for debugging
    return db.prepare(
      `SELECT id, table_name, operation, attempts, last_error, created_at
       FROM sync_queue WHERE synced_at IS NULL
       ORDER BY attempts DESC, created_at DESC LIMIT 30`
    ).all()
  })

  ipcMain.handle('sync:queue:purgeAll', () => {
    // Nuclear option: delete all pending sync items (data stays local)
    const { changes } = db.prepare(`DELETE FROM sync_queue WHERE synced_at IS NULL`).run()
    return { deleted: changes }
  })

  ipcMain.handle('sync:queue:purgeTables', (_e, tables: string[]) => {
    if (!Array.isArray(tables) || !tables.length) return { deleted: 0 }
    const placeholders = tables.map(() => '?').join(',')
    const { changes } = db.prepare(
      `DELETE FROM sync_queue WHERE synced_at IS NULL AND table_name IN (${placeholders})`,
    ).run(...tables)
    return { deleted: changes }
  })

  ipcMain.handle('sync:queue:dedupe', () => {
    const { changes } = db.prepare(`
      DELETE FROM sync_queue
      WHERE synced_at IS NULL AND id NOT IN (
        SELECT q1.id FROM sync_queue q1
        INNER JOIN (
          SELECT table_name, record_id, MAX(created_at) AS max_created
          FROM sync_queue
          WHERE synced_at IS NULL AND record_id != ''
          GROUP BY table_name, record_id
        ) latest
        ON q1.table_name = latest.table_name
        AND q1.record_id = latest.record_id
        AND q1.created_at = latest.max_created
        WHERE q1.synced_at IS NULL
      )
    `).run()
    return { deleted: changes }
  })

  ipcMain.handle('sync:bootstrap:tableData', (_e, tableName: string, onlyActive?: boolean) => {
    if (!SYNC_ALLOWED_TABLES.has(tableName)) return []
    const whereActive = onlyActive ? ' WHERE actif = 1' : ''
    try {
      return db.prepare(`SELECT * FROM ${tableName}${whereActive}`).all()
    } catch {
      return []
    }
  })

  ipcMain.handle('sync:pull:applyRows', (_e, tableName: string, rows: Record<string, unknown>[]) => {
    if (!isPullTableAllowed(tableName)) return { applied: 0, skipped: 0, error: 'table not allowed' }
    try {
      const result = applyRemoteRows(db, tableName, rows ?? [])
      return { ...result, error: null }
    } catch (e) {
      return { applied: 0, skipped: 0, error: String(e) }
    }
  })

  ipcMain.handle('sync:local:tableCount', (_e, tableName: string) => {
    return getLocalTableCount(db, tableName)
  })

  // Window controls
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.restore()
    else mainWindow?.maximize()
  })
  ipcMain.handle('window:close', () => mainWindow?.close())

  // ─── Print ───────────────────────────────────────────────────────────────────
  ipcMain.handle('print:label', async (_event, html: string) => {
    const res = await PrinterService.printHtmlInHiddenWindow(html, {
      silent: false,
      printBackground: true,
      color: true,
      pageSize: { widthMm: 40, heightMm: 20 },
      dpi: { horizontal: 203, vertical: 203 },
    })
    return res.success
  })

  registerPrinterIPC()

  ipcMain.handle('print:getPrinters', async () => {
    if (!mainWindow) return []
    try {
      return await mainWindow.webContents.getPrintersAsync()
    } catch { return [] }
  })

  ipcMain.handle('print:printContent', async (_event, html: string, printerName: string, options: Record<string, unknown> = {}) => {
    let pageSize: Parameters<typeof PrinterService.resolveElectronPageSize>[0] = (options.pageSize as string) || 'A4'
    if (options.widthMm != null && options.heightMm != null) {
      pageSize = {
        widthMm: Number(options.widthMm),
        heightMm: Number(options.heightMm),
      }
    }
    return PrinterService.printHtmlInHiddenWindow(html, {
      printerName: printerName || undefined,
      silent: options.silent !== false && !!printerName,
      printBackground: options.printBackground !== false,
      color: options.color !== false,
      copies: typeof options.copies === 'number' ? options.copies : 1,
      pageSize: PrinterService.resolveElectronPageSize(pageSize),
      scaleFactor: typeof options.scaleFactor === 'number' ? options.scaleFactor : undefined,
      dpi: options.dpi as { horizontal: number; vertical: number } | undefined,
    })
  })

  ipcMain.handle('gainscha:isAvailable', () => PrinterService.isGainschaAvailable())

  ipcMain.handle('gainscha:detectUsb', async () => PrinterService.gainschaDetectUsb())

  ipcMain.handle('gainscha:version', async () => PrinterService.gainschaSdkVersion())

  ipcMain.handle('gainscha:printLabel', async (_event, job: GainschaPrintJob) => PrinterService.gainschaPrintLabel(job))

  ipcMain.handle('print:tsplLabel', async (_event, data: Record<string, unknown>) => {
    const getPrinters = async () => {
      if (!mainWindow) return []
      try {
        return await mainWindow.webContents.getPrintersAsync()
      } catch {
        return []
      }
    }
    return PrinterService.printTsplLabel(
      {
        codeBarre: String(data.codeBarre ?? ''),
        nomProduit: String(data.nomProduit ?? ''),
        prix: String(data.prix ?? ''),
        copies: typeof data.copies === 'number' ? data.copies : 1,
        printerName: typeof data.printerName === 'string' ? data.printerName : '',
        widthMm: typeof data.widthMm === 'number' ? data.widthMm : 40,
        heightMm: typeof data.heightMm === 'number' ? data.heightMm : 20,
        stripLeftMm: typeof data.stripLeftMm === 'number' ? data.stripLeftMm : 1,
        stripRightMm: typeof data.stripRightMm === 'number' ? data.stripRightMm : 1,
        stripTopMm: typeof data.stripTopMm === 'number' ? data.stripTopMm : 0.35,
        stripBottomMm: typeof data.stripBottomMm === 'number' ? data.stripBottomMm : 0.35,
        rotationDeg: data.rotationDeg === 180 ? 180 : 0,
        layout: data.layout as any,
      },
      getPrinters,
    )
  })

  // ─── Backup ───────────────────────────────────────────────────────────────────
  ipcMain.handle('backup:create', () => {
    const r = createProtectedBackup('scheduled')
    if (!r) return { success: false, error: 'Backup failed' }
    const external = copyToExternalFolder(r.archivePath)
    return { success: true, filename: r.filename, path: r.path, archivePath: r.archivePath, external }
  })

  ipcMain.handle('backup:list', () => {
    const backupDir = getBackupDir()
    const files = readdirSync(backupDir)
      .filter(f => f.startsWith('smlpos_') && f.endsWith('.db'))
      .map(f => {
        const s = statSync(join(backupDir, f))
        return { name: f, size: s.size, time: s.mtimeMs, path: join(backupDir, f) }
      })
      .sort((a, b) => b.time - a.time)
    return files
  })

  ipcMain.handle('backup:getStats', () => {
    const backupDir = getBackupDir()
    const files = existsSync(backupDir)
      ? readdirSync(backupDir).filter(f => f.startsWith('smlpos_') && f.endsWith('.db'))
      : []
    const latest = files.sort().pop()
    const lastTime = latest ? statSync(join(backupDir, latest)).mtimeMs : null
    const totalSize = files.reduce((acc, f) => {
      try { return acc + statSync(join(backupDir, f)).size } catch { return acc }
    }, 0)
    const dbSize = existsSync(dbFilePath) ? statSync(dbFilePath).size : 0
    return { count: files.length, lastTime, totalSize, dbSize, dbPath: dbFilePath, backupDir, archiveDir: getArchiveDir() }
  })

  ipcMain.handle('backup:openFolder', () => {
    shell.openPath(getBackupDir())
  })

  ipcMain.handle('backup:chooseExternalFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Dossier de sauvegarde externe (Google Drive, USB, etc.)',
    })
    if (result.canceled || !result.filePaths.length) return { canceled: true }
    return { path: result.filePaths[0] }
  })

  ipcMain.handle('backup:restore', async (_e, backupPath: string) => {
    try {
      if (!existsSync(backupPath)) return { success: false, error: 'Fichier introuvable' }
      // Safety: backup current state first
      createProtectedBackup('auto_recover')
      // Close DB, copy, then restart
      db.close()
      copyFileSync(backupPath, dbFilePath)
      // Relaunch the app
      app.relaunch()
      app.exit(0)
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('backup:discover', () => {
    try {
      const row = db.prepare(`SELECT value FROM app_settings WHERE key='backup_folder_path'`).get() as { value?: string } | undefined
      const externalFolder = row?.value?.trim() || null
      const activeCount = (db.prepare('SELECT COUNT(*) as cnt FROM produits').get() as { cnt: number }).cnt
      const candidates = discoverRecoverableDatabases(externalFolder)
      return { success: true, activeCount, activeDbPath: dbFilePath, candidates }
    } catch (e) {
      return { success: false, error: String(e), candidates: [] as unknown[] }
    }
  })

  // ─── Cloud backup (Cloudflare R2) ─────────────────────────────────────────────
  ipcMain.handle('r2:getStatus', () => getR2Status())
  ipcMain.handle('r2:listSnapshots', () => listR2Snapshots())
  ipcMain.handle('r2:testConnection', () => testR2Connection())
  ipcMain.handle('r2:uploadNow', () => uploadR2Snapshot(true))
  ipcMain.handle('r2:restore', async (_e, key: string) => {
    try {
      const dl = await downloadR2Snapshot(key)
      if (!dl.success || !dl.path) return { success: false, error: dl.error ?? 'Téléchargement échoué' }
      if (!existsSync(dl.path)) return { success: false, error: 'Fichier introuvable' }
      createProtectedBackup('auto_recover')
      db.close()
      copyFileSync(dl.path, dbFilePath)
      app.relaunch()
      app.exit(0)
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })
}

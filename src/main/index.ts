Warning: truncated output (original token count: 86932)
Total output lines: 6230

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
import { registerHetznerSyncIpc } from './hetznerSync'

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

/**
 * Versions before 1.9.1015 treated an active quote like a completed sale and
 * removed its stock/S/N. Record every inspected quote locally so the repair is
 * safe to run at every boot and can never increase stock twice.
 */
function repairLegacyQuoteInventory() {
  const repairKey = 'legacy_devis_inventory_v1'
  try {
    const quotes = db.prepare(`
      SELECT v.id, v.numero, COALESCE(v.statut, 'ACTIVE') AS statut
      FROM ventes v
      LEFT JOIN inventory_repair_ledger ledger
        ON ledger.repair_key = ? AND ledger.operation_id = v.id
      WHERE COALESCE(v.type_vente, 'TICKET') = 'DEVIS'
        AND ledger.operation_id IS NULL
      ORDER BY v.created_at ASC
    `).all(repairKey) as Array<{ id: string; numero: string; statut: string }>
    const now = new Date().toISOString()
    const insertLedger = db.prepare(`
      INSERT OR IGNORE INTO inventory_repair_ledger
        (repair_key, operation_id, repaired_at, details)
      VALUES (?, ?, ?, ?)
    `)
    const lines = db.prepare(`
      SELECT produit_id, quantite, numero_serie
      FROM lignes_vente
      WHERE vente_id = ? AND produit_id IS NOT NULL
    `)
    const restoreLinkedSerials = db.prepare(`
      UPDATE serial_numbers
      SET statut = 'EN_STOCK', vente_id = NULL, updated_at = ?
      WHERE vente_id = ? AND statut = 'VENDU'
    `)

    db.transaction(() => {
      for (const quote of quotes) {
        let restoredUnits = 0
        if (quote.statut !== 'ANNULEE') {
          const quoteLines = lines.all(quote.id) as Array<{ produit_id: string; quantite: number }>
          for (const line of quoteLines) {
            const qty = Math.max(0, Number(line.quantite) || 0)
            if (!qty) continue
            db.prepare(`UPDATE produits SET stock_actuel = stock_actuel + ? WHERE id = ?`).run(qty, line.produit_id)
            restoredUnits += qty
          }
          restoreLinkedSerials.run(now, quote.id)
        }
        insertLedger.run(repairKey, quote.id, now, JSON.stringify({
          numero: quote.numero,
          status: quote.statut,
          restored_units: restoredUnits,
        }))
      }

      // A serial marked sold must always be backed by an active, inventory-
      // affecting sale. This also fixes old edited/added S/N rows that became
      // orphaned or were attached to a quote/cancelled operation.
      db.prepare(`
        UPDATE serial_numbers
        SET statut = 'EN_STOCK', vente_id = NULL, updated_at = ?
        WHERE statut = 'VENDU'
          AND (
            vente_id IS NULL
            OR NOT EXISTS (
              SELECT 1 FROM ventes v
              WHERE v.id = serial_numbers.vente_id
                AND COALESCE(v.statut, 'ACTIVE') != 'ANNULEE'
                AND COALESCE(v.type_vente, 'TICKET') != 'DEVIS'
            )
          )
      `).run(now)
    })()
    if (quotes.length) console.log(`[inventory] Repaired/registered ${quotes.length} legacy quote(s)`)
  } catch (e) {
    console.warn('[inventory] Legacy quote repair skipped:', e)
  }
}

/**
 * v1.9.1036 briefly allowed external-shift exits to be accepted as additional
 * internal-treasury exits. They already reduce the net end-of-day transfer, so
 * accepting them separately deducted the same money twice. Remove only those
 * generated ledger rows, convert the matching gross daily transfer to net and
 * preserve intentional internal POS exits.
 */
function repairExternalTreasuryDoubleDeductions() {
  const externalCategories = [
    'SORTIE_CAISSE_EXTERNE',
    'FRAIS_RETOUR_COLIS',
    'PAIEMENT_FOURNISSEUR_EXTERNE',
    'AJUSTEMENT_FOURNISSEUR_EXTERNE',
    'CREDIT_PERSONNEL_EXTERNE',
    'REMBOURSEMENT_RETOUR',
  ]
  try {
    const placeholders = externalCategories.map(() => '?').join(',')
    const externalPending = db.prepare(`
      SELECT id, date(created_at,'localtime') AS date_journal, montant
      FROM mouvements_tresorerie_attente
      WHERE categorie IN (${placeholders})
        AND COALESCE(note,'') NOT LIKE '[HORS TRESORERIE]%'
    `).all(...externalCategories) as Array<{ id: string; date_journal: string; montant: number }>
    const acceptedExternalRows = db.prepare(`
      SELECT m.id, m.date_journal, m.montant
      FROM mouvements_caisse_interne m
      JOIN mouvements_tresorerie_attente p ON m.id = 'mci-' || p.id
      WHERE p.impact_applique = 0 AND p.categorie IN (${placeholders})
    `).all(...externalCategories) as Array<{ id: string; date_journal: string; montant: number }>
    const externalByDate = new Map<string, number>()
    for (const row of externalPending) externalByDate.set(row.date_journal, money3((externalByDate.get(row.date_journal) ?? 0) + Number(row.montant)))
    const acceptedByDate = new Map<string, number>()
    for (const row of acceptedExternalRows) acceptedByDate.set(row.date_journal, money3((acceptedByDate.get(row.date_journal) ?? 0) + Number(row.montant)))
    const now = new Date().toISOString()
    db.transaction(() => {
      for (const row of acceptedExternalRows) db.prepare(`DELETE FROM mouvements_caisse_interne WHERE id=?`).run(row.id)
      for (const [date, amount] of acceptedByDate) {
        db.prepare(`UPDATE caisse_interne SET total_sorties=MAX(0,total_sorties-?) WHERE date_journal=?`).run(amount, date)
      }
      for (const [date, amount] of externalByDate) {
        const dailyPending = db.prepare(`
          SELECT id,montant FROM mouvements_tresorerie_attente
          WHERE categorie='TOTAL_CAISSE_JOUR' AND reference_id=?
        `).get(`journee-${date}`) as { id: string; montant: number } | undefined
        if (!dailyPending) continue
        const reduction = Math.min(Number(dailyPending.montant) || 0, amount)
        if (reduction <= 0) continue
        db.prepare(`UPDATE mouvements_tresorerie_attente SET montant=MAX(0,montant-?) WHERE id=?`).run(reduction, dailyPending.id)
        const dailyLedgerId = `mci-${dailyPending.id}`
        const dailyLedger = db.prepare(`SELECT montant,date_journal FROM mouvements_caisse_interne WHERE id=?`).get(dailyLedgerId) as { montant: number; date_journal: string } | undefined
        if (dailyLedger) {
          const ledgerReduction = Math.min(Number(dailyLedger.montant) || 0, reduction)
          db.prepare(`UPDATE mouvements_caisse_interne SET montant=MAX(0,montant-?) WHERE id=?`).run(ledgerReduction, dailyLedgerId)
          db.prepare(`UPDATE caisse_interne SET total_entrees=MAX(0,total_entrees-?) WHERE date_journal=?`).run(ledgerReduction, dailyLedger.date_journal)
        }
      }
      db.prepare(`
        UPDATE mouvements_tresorerie_attente
        SET statut='ACCEPTE', accepted_at=COALESCE(accepted_at,?),
            note=CASE WHEN note LIKE '[HORS TRESORERIE]%' THEN note ELSE '[HORS TRESORERIE] ' || COALESCE(note,'') END
        WHERE categorie IN (${placeholders})
      `).run(now, ...externalCategories)
    })()
    for (const row of acceptedExternalRows) enqueueSync('mouvements_caisse_interne', 'DELETE', { id: row.id })
    for (const date of externalByDate.keys()) {
      const cash = db.prepare(`SELECT * FROM caisse_interne WHERE date_journal=?`).get(date) as Record<string, unknown> | undefined
      if (cash) enqueueSync('caisse_interne', 'UPDATE', cash)
      const dailyPending = db.prepare(`SELECT * FROM mouvements_tresorerie_attente WHERE categorie='TOTAL_CAISSE_JOUR' AND reference_id=?`).get(`journee-${date}`) as Record<string, unknown> | undefined
      if (dailyPending) {
        enqueueSync('mouvements_tresorerie_attente', 'UPDATE', dailyPending)
        const dailyLedger = db.prepare(`SELECT * FROM mouvements_caisse_interne WHERE id=?`).get(`mci-${dailyPending.id}`) as Record<string, unknown> | undefined
        if (dailyLedger) enqueueSync('mouvements_caisse_interne', 'UPDATE', dailyLedger)
      }
    }
    if (externalPending.length) {
      addActivityLog({ action: 'TREASURY_EXTERNAL_DOUBLE_DEDUCTION_REPAIRED', details: { movements: acceptedExternalRows.length, dates: [...externalByDate.keys()] } })
      console.log(`[treasury] Repaired ${externalPending.length} external cash-out review item(s)`)
    }
  } catch (error) {
    console.warn('[treasury] External double-deduction repair skipped:', error)
  }
}

/**
 * Keep already-created daily treasury reviews aligned with the authoritative
 * Matin + Soir cash reports. Older builds recomputed the amount from source
 * tables and could omit report-only values such as fiscal stamps.
 */
function repairDailyTreasuryTotalsFromReports() {
  try {
    const dailyRows = db.prepare(`
      SELECT p.id,p.montant,p.statut,
             SUM(r.total_entrees-r.total_sorties) AS expected_amount
      FROM mouvements_tresorerie_attente p
      JOIN rapports_caisse r
        ON p.reference_id='journee-' || r.date_journal
       AND r.session_type IN ('MATIN','SOIR')
      WHERE p.categorie='TOTAL_CAISSE_JOUR'
      GROUP BY p.id,p.montant,p.statut
    `).all() as Array<{ id: string; montant: number; statut: string; expected_amount: number }>
    const changed: Array<{ id: string; previous: number; expected: number }> = []
    db.transaction(() => {
      for (const row of dailyRows) {
        const previous = money3(row.montant)
        const expected = Math.max(0, money3(row.expected_amount))
        const delta = money3(expected - previous)
        if (Math.abs(delta) < 0.0001) continue
        db.prepare(`UPDATE mouvements_tresorerie_attente SET montant=? WHERE id=?`).run(expected, row.id)
        const ledgerId = `mci-${row.id}`
        const ledger = db.prepare(`SELECT date_journal FROM mouvements_caisse_interne WHERE id=?`).get(ledgerId) as { date_journal: string } | undefined
        if (ledger) {
          db.prepare(`UPDATE mouvements_caisse_interne SET montant=? WHERE id=?`).run(expected, ledgerId)
          db.prepare(`UPDATE caisse_interne SET total_entrees=MAX(0,total_entrees+?) WHERE date_journal=?`).run(delta, ledger.date_journal)
        }
        changed.push({ id: row.id, previous, expected })
      }
    })()
    for (const item of changed) {
      const pending = db.prepare(`SELECT * FROM mouvements_tresorerie_attente WHERE id=?`).get(item.id) as Record<string, unknown>
      enqueueSync('mouvements_tresorerie_attente', 'UPDATE', pending)
      const ledger = db.prepare(`SELECT * FROM mouvements_caisse_interne WHERE id=?`).get(`mci-${item.id}`) as Record<string, unknown> | undefined
      if (ledger) {
        enqueueSync('mouvements_caisse_interne', 'UPDATE', ledger)
        const cash = db.prepare(`SELECT * FROM caisse_interne WHERE date_journal=?`).get(ledger.date_journal) as Record<string, unknown> | undefined
        if (cash) enqueueSync('caisse_interne', 'UPDATE', cash)
      }
    }
    if (changed.length) {
      addActivityLog({ action: 'TREASURY_DAILY_TOTALS_REALIGNED', details: { days: changed } })
      console.log(`[treasury] Realigned ${changed.length} daily total(s) with final cash reports`)
    }
  } catch (error) {
    console.warn('[treasury] Daily total realignment skipped:', error)
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
    repairLegacyQuoteInventory()
    repairExternalTreasuryDoubleDeductions()
    repairDailyTreasuryTotalsFromReports()
  } catch (err) {
    console.error('DB init error:', err)
  }

  startAutoBackup()
  startR2BackupScheduler()
  startSupabaseKeepAlive()
  startBossApiServer()
  setupIpcHandlers()
  registerHetznerSyncIpc()
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
  const ensureInternalCashJournal = (createdAt?: unknown) => {
    const parsed = new Date(String(createdAt ?? new Date().toISOString()))
    const date = Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString('en-CA') : new Date().toLocaleDateString('en-CA')
    let cash = db.prepare('SELECT * FROM caisse_interne WHERE date_journal = ?').get(date) as Record<string, unknown> | undefined
    if (!cash) {
      const previous = db.prepare('SELECT solde_ouverture,total_entrees,total_sorties FROM caisse_interne WHERE date_journal < ? ORDER BY date_journal DESC LIMIT 1').get(date) as { solde_ouverture?: number; total_entrees?: number; total_sorties?: number } | undefined
      const opening = previous ? money3(Number(previous.solde_ouverture) + Number(previous.total_entrees) - Number(previous.total_sorties)) : 100
      db.prepare('INSERT OR IGNORE INTO caisse_interne (id,date_journal,solde_ouverture) VALUES (?,?,?)').run(`ci-${date}`, date, opening)
      cash = db.prepare('SELECT * FROM caisse_interne WHERE date_journal = ?').get(date) as Record<string, unknown>
    }
    return { date, cash }
  }

  const applyInternalCashMovement = (direction: 'ENTREE' | 'SORTIE', amountInput: unknown, createdAt?: unknown) => {
    const amount = money3(amountInput)
    const { date } = ensureInternalCashJournal(createdAt)
    const column = direction === 'ENTREE' ? 'total_entrees' : 'total_sorties'
    db.prepare(`UPDATE caisse_interne SET ${column} = ${column} + ? WHERE date_journal = ?`).run(amount, date)
    const cash = db.prepare('SELECT * FROM caisse_interne WHERE date_journal = ?').get(date) as Record<string, unknown>
    enqueueSync('caisse_interne', 'UPDATE', cash)
    return { date, cash }
  }

  const applyInternalCashOut = (amountInput: unknown, createdAt?: unknown) => {
    return applyInternalCashMovement('SORTIE', amountInput, createdAt)
  }

  const queueTreasuryMovement = (input: {
    direction: 'ENTREE' | 'SORTIE'
    categorie: string
    montant: unknown
    referenceId: unknown
    note?: unknown
    operateur?: unknown
    createdAt?: unknown
    impactApplied?: boolean
  }) => {
    const montant = money3(input.montant)
    const referenceId = String(input.referenceId ?? '').trim()
    if (montant <= 0 || !referenceId) return null
    const existing = db.prepare(`SELECT id FROM mouvements_tresorerie_attente WHERE reference_id=? LIMIT 1`).get(referenceId) as { id: string } | undefined
    if (existing) return existing.id
    const id = `treasury-${input.categorie.toLowerCase()}-${referenceId}`
    db.prepare(`
      INSERT OR IGNORE INTO mouvements_tresorerie_attente
        (id,direction,categorie,montant,reference_id,note,operateur,impact_applique,statut,created_at)
      VALUES (?,?,?,?,?,?,?,?, 'EN_ATTENTE', ?)
    `).run(
      id, input.direction, input.categorie, montant, referenceId,
      input.note == null ? null : String(input.note),
      input.operateur == null ? 'superadmin' : String(input.operateur),
      input.impactApplied ? 1 : 0,
      input.createdAt == null ? new Date().toISOString() : String(input.createdAt),
    )
    return id
  }

  const acceptTreasuryPending = (id: string) => {
    const pending = db.prepare(`SELECT * FROM mouvements_tresorerie_attente WHERE id=?`).get(id) as Record<string, unknown> | undefined
    if (!pending) throw new Error('Mouvement de trésorerie introuvable')
    if (pending.statut === 'ACCEPTE') return { success: true, alreadyAccepted: true }
    const now = new Date().toISOString()
    let insertedMovement: Record<string, unknown> | null = null
    db.transaction(() => {
      if (!Number(pending.impact_applique)) {
        const movementId = `mci-${id}`
        const parsed = new Date(String(pending.created_at ?? now))
        const date = Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString('en-CA') : new Date().toLocaleDateString('en-CA')
        insertedMovement = {
          id: movementId,
          date_journal: date,
          type: String(pending.direction),
          categorie: String(pending.categorie),
          montant: money3(pending.montant),
          reference_id: String(pending.reference_id),
          note: pending.note == null ? null : String(pending.note),
          operateur: String(pending.operateur ?? 'superadmin'),
          created_at: String(pending.created_at ?? now),
        }
        db.prepare(`INSERT OR IGNORE INTO mouvements_caisse_interne (id,date_journal,type,categorie,montant,reference_id,note,operateur,created_at) VALUES (@id,@date_journal,@type,@categorie,@montant,@reference_id,@note,@operateur,@created_at)`).run(insertedMovement)
        applyInternalCashMovement(String(pending.direction) === 'ENTREE' ? 'ENTREE' : 'SORTIE', pending.montant, pending.created_at)
      }
      db.prepare(`UPDATE mouvements_tresorerie_attente SET statut='ACCEPTE', accepted_at=? WHERE id=? AND statut='EN_ATTENTE'`).run(now, id)
    })()
    if (insertedMovement) enqueueSync('mouvements_caisse_interne', 'INSERT', insertedMovement)
    addActivityLog({
      operateur: String(pending.operateur ?? 'superadmin'),
      action: 'TREASURY_MOVEMENT_ACCEPTED',
      montant: Number(pending.montant),
      details: { pending_id: id, direction: pending.direction, categorie: pending.categorie, reference_id: pending.reference_id },
    })
    return { success: true }
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
      savedAt: ne…68932 tokens truncated…_19', 'tva_19', 'total_remise'])
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
    const affectsInventory = doc.type_document !== 'DEVIS'
    try {
      db.transaction(() => {
        if (doc.vente_id) {
          if (affectsInventory) {
            for (const vl of oldVenteLines) revertVenteLineInventory(doc.vente_id!, vl, now)
          }
          db.prepare(`DELETE FROM lignes_vente WHERE vente_id = ?`).run(doc.vente_id)
        }
        const claimedSerials = new Set<string>()
        for (const line of normalizedLignes) validateLineSerials(line, claimedSerials)
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
        if (doc.vente_id && affectsInventory) {
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
      if (affectsInventory) {
        for (const pid of touched) enqueueProductSnapshot(pid)
      }
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

  ipcMain.handle('documents:annulerAvecAvoir', (_e, id: string, motif?: string, refundData: Record<string, unknown> = {}) => {
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
    const linkedVenteId = String(doc.vente_id ?? '').trim()
    const refundAmount = Math.max(0, money3(refundData.montant_rembourse))
    const refundShiftId = String(refundData.shift_id ?? '').trim()
    if (refundAmount > 0 && !refundShiftId) return { success: false, error: 'Ouvrez une caisse pour enregistrer le remboursement client' }
    let cancelledLinkedSale = false
    const restoredProductIds = new Set<string>()

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
      // A sales invoice generated from a POS sale represents the same inventory
      // movement. Cancelling it with an avoir returns those items, including the
      // exact serial numbers, and prevents the original sale from keeping them sold.
      if (linkedVenteId) {
        const vente = db.prepare(`SELECT * FROM ventes WHERE id = ?`).get(linkedVenteId) as Record<string, unknown> | undefined
        if (vente && vente.statut !== 'ANNULEE') {
          const venteLignes = db.prepare(`SELECT produit_id, quantite, numero_serie FROM lignes_vente WHERE vente_id = ? AND produit_id IS NOT NULL`).all(linkedVenteId) as Record<string, unknown>[]
          for (const ligne of venteLignes) {
            revertVenteLineInventory(linkedVenteId, ligne, now)
            if (ligne.produit_id) restoredProductIds.add(String(ligne.produit_id))
          }
          db.prepare(`UPDATE ventes SET statut='ANNULEE', annule_par='FACTURE_AVOIR', annule_at=?, annule_motif=? WHERE id=?`)
            .run(now, motif?.trim() || `Facture ${doc.numero} annulée avec avoir`, linkedVenteId)
          db.prepare(`INSERT OR IGNORE INTO remboursements_ventes (id,vente_id,shift_id,montant,mode_paiement,operateur,motif,created_at) VALUES (?,?,?,?,?,?,?,?)`)
            .run(randomUUID(), linkedVenteId, refundShiftId || null, refundAmount, String(refundData.mode_remboursement ?? 'ESPECES'), refundData.operateur ?? 'superadmin', motif?.trim() || null, now)
          const advanceDossierId = String(vente.avance_dossier_id ?? '').trim()
          if (advanceDossierId) {
            const advanceRows = db.prepare(`SELECT * FROM avances_clients WHERE dossier_id=? ORDER BY created_at`).all(advanceDossierId) as Record<string, unknown>[]
            const root = advanceRows[0]
            if (root) {
              const paid = money3(advanceRows.reduce((sum, row) => sum + Number(row.montant || 0), 0))
              const status = paid >= Number(root.prix_produit || 0) - 0.0001 ? 'SOLDE' : 'EN_COURS'
              db.prepare(`UPDATE avances_clients SET statut=?, vente_id=NULL WHERE dossier_id=?`).run(status, advanceDossierId)
              const serial = String(root.numero_serie ?? '').trim()
              if (serial) db.prepare(`UPDATE serial_numbers SET statut='RESERVE_AVANCE', vente_id=?, updated_at=? WHERE produit_id=? AND lower(trim(numero_serie))=lower(trim(?)) AND statut='EN_STOCK'`)
                .run(advanceDossierId, now, root.produit_id, serial)
            }
          }
          cancelledLinkedSale = true
        }
      }
    })()

    enqueueSync('documents', 'INSERT', avoirDoc)
    for (const l of avoirLignes) enqueueSync('lignes_document', 'INSERT', l as Record<string, unknown>)
    enqueueSync('documents', 'UPDATE', { id, statut: 'ANNULE', avoir_id: avoirId, annule_motif: motif?.trim() || null, updated_at: now })
    if (cancelledLinkedSale) enqueueSync('ventes', 'UPDATE', { id: linkedVenteId, statut: 'ANNULEE', annule_at: now, annule_par: 'FACTURE_AVOIR' })
    for (const productId of restoredProductIds) enqueueProductSnapshot(productId)
    addActivityLog({
      shift_id: refundShiftId || undefined,
      operateur: String(refundData.operateur ?? ''),
      action: 'FACTURE_ANNULEE_AVEC_AVOIR',
      details: { facture_id: id, facture_numero: doc.numero, avoir_numero: avoirNumero, motif: motif?.trim() || null, montant_rembourse: refundAmount },
      montant: refundAmount,
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
      landscape: options.landscape === true,
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


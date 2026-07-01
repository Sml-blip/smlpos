import * as XLSX from 'xlsx'
import { generateId, generateReference } from './utils'

export type ProductImportSettings = {
  defaultType: 'F' | 'NF'
  defaultTvaPct: number
  stockMinimum: number
  onDuplicate: 'update' | 'skip'
  matchBy: 'reference' | 'code_barre'
}

export type ProductImportRow = {
  id: string
  code_barre: string | null
  reference: string
  nom: string
  description: string | null
  categorie: string
  type: 'F' | 'NF'
  prix_achat: number | null
  prix_vente: number
  tva_taux: number
  stock_actuel: number
  stock_minimum: number
  fournisseur: string | null
  actif: number
  created_at: string
  updated_at: string
}

export type ProductImportPreview = {
  format: string
  sheetName: string
  headerRowIndex: number
  headers: string[]
  totalRows: number
  validRows: number
  sampleRows: Array<{
    reference: string
    nom: string
    code_barre: string | null
    categorie: string
    prix_vente: number
    stock: number
  }>
  warnings: string[]
}

const FIELD_ALIASES: Record<string, string[]> = {
  reference: ['reference', 'ref', 'reffab', 'reffabricant'],
  nom: ['designation', 'nom', 'name', 'libelle', 'produit', 'intitule'],
  code_barre: ['codebarre', 'codebar', 'barcode', 'ean', 'gtin'],
  sous_famille: ['sousfamille', 'souscat', 'subcategory'],
  categorie: ['famille', 'categorie', 'category', 'rayon'],
  fournisseur: ['fournisseur', 'supplier', 'vendor'],
  prix_achat: ['pvht', 'prixachat', 'prixachatht', 'paht', 'pahorsTaxe'],
  prix_vente: ['pvttc', 'prixvente', 'prixventettc', 'pv', 'prix'],
  stock: ['stock', 'stockactuel', 'qte', 'quantite', 'quantity'],
  type: ['type', 'typefacturation', 'facturation'],
  tva: ['tva', 'tvataux', 'tauxtva'],
  description: ['description', 'desc'],
  stock_minimum: ['stockmin', 'stockminimum', 'minstock'],
}

function normHeader(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function parseNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const cleaned = String(value).replace(/\s/g, '').replace(',', '.')
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : null
}

function parseIntSafe(value: unknown, fallback = 0): number {
  const n = parseNumber(value)
  if (n == null) return fallback
  return Math.round(n)
}

function cellText(value: unknown): string {
  return String(value ?? '').trim()
}

function detectHeaderRow(rows: unknown[][]): number {
  let bestIndex = 0
  let bestScore = 0

  for (let i = 0; i < Math.min(25, rows.length); i++) {
    const row = rows[i] ?? []
    const normalized = row.map(normHeader)
    let score = 0
    for (const aliases of Object.values(FIELD_ALIASES)) {
      if (normalized.some((cell) => aliases.includes(cell))) score++
    }
    if (score > bestScore) {
      bestScore = score
      bestIndex = i
    }
  }

  return bestScore >= 2 ? bestIndex : 0
}

function buildColumnMap(headers: unknown[]): Map<string, number> {
  const map = new Map<string, number>()
  const normalized = headers.map(normHeader)

  for (let col = 0; col < normalized.length; col++) {
    const key = normalized[col]
    if (!key) continue
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.includes(key) && !map.has(field)) {
        map.set(field, col)
      }
    }
  }

  return map
}

function getCell(row: unknown[], colMap: Map<string, number>, field: string): unknown {
  const idx = colMap.get(field)
  if (idx == null) return undefined
  return row[idx]
}

function detectFormat(headers: string[]): string {
  const normalized = headers.map(normHeader)
  if (normalized.some((h) => h === 'pvttc') && normalized.some((h) => h === 'pvht')) {
    return 'ETAT Produit (Excel)'
  }
  if (normalized.some((h) => h === 'prixvente') || normalized.some((h) => h === 'nom')) {
    return 'Export SMLPOS'
  }
  return 'Excel générique'
}

export function parseProductImportBuffer(
  buffer: ArrayBuffer,
  settings: ProductImportSettings
): { produits: ProductImportRow[]; preview: ProductImportPreview } {
  const wb = XLSX.read(buffer, { type: 'array' })
  const sheetName = wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' }) as unknown[][]

  if (matrix.length === 0) {
    throw new Error('Fichier vide')
  }

  const headerRowIndex = detectHeaderRow(matrix)
  const headerRow = matrix[headerRowIndex] ?? []
  const headers = headerRow.map((cell) => cellText(cell))
  const colMap = buildColumnMap(headerRow)
  const format = detectFormat(headers)
  const warnings: string[] = []

  if (headerRowIndex > 0) {
    warnings.push(`Ligne d'en-tête détectée à la ligne ${headerRowIndex + 1} (format ${format})`)
  }
  if (!colMap.has('nom') && !colMap.has('reference')) {
    throw new Error('Colonnes produit introuvables (attendu : Désignation, Référence, Nom…)')
  }

  const now = new Date().toISOString()
  const dataRows = matrix.slice(headerRowIndex + 1)
  const produits: ProductImportRow[] = []

  for (const row of dataRows) {
    if (!row || row.every((cell) => cellText(cell) === '')) continue

    const referenceRaw = cellText(getCell(row, colMap, 'reference'))
    const nomRaw =
      cellText(getCell(row, colMap, 'nom')) ||
      referenceRaw ||
      cellText(getCell(row, colMap, 'description'))
    if (!nomRaw) continue

    const codeBarreRaw = cellText(getCell(row, colMap, 'code_barre'))
    const sousFamille = cellText(getCell(row, colMap, 'sous_famille'))
    const famille = cellText(getCell(row, colMap, 'categorie'))
    const categorie = famille || sousFamille || 'Général'

    const pvht = parseNumber(getCell(row, colMap, 'prix_achat'))
    const pvttc = parseNumber(getCell(row, colMap, 'prix_vente'))
    const prixVente = pvttc ?? pvht ?? 0

    let tvaTaux = parseNumber(getCell(row, colMap, 'tva'))
    if (tvaTaux == null && pvht != null && pvttc != null && pvht > 0 && pvttc >= pvht) {
      tvaTaux = Math.round(((pvttc / pvht) - 1) * 10000) / 100
    }
    if (tvaTaux == null) tvaTaux = settings.defaultTvaPct

    const typeRaw = cellText(getCell(row, colMap, 'type')).toUpperCase()
    const type: 'F' | 'NF' = typeRaw === 'NF' ? 'NF' : settings.defaultType

    const reference = referenceRaw || (codeBarreRaw ? `REF-${codeBarreRaw}` : generateReference())

    produits.push({
      id: generateId(),
      code_barre: codeBarreRaw || null,
      reference,
      nom: nomRaw,
      description: cellText(getCell(row, colMap, 'description')) || null,
      categorie,
      type,
      prix_achat: pvht,
      prix_vente: prixVente,
      tva_taux: tvaTaux,
      stock_actuel: parseIntSafe(getCell(row, colMap, 'stock'), 0),
      stock_minimum: parseIntSafe(getCell(row, colMap, 'stock_minimum'), settings.stockMinimum),
      fournisseur: cellText(getCell(row, colMap, 'fournisseur')) || null,
      actif: 1,
      created_at: now,
      updated_at: now,
    })
  }

  if (produits.length === 0) {
    throw new Error('Aucun produit trouvé — vérifiez le format (ETAT Produit, export SMLPOS, etc.)')
  }

  return {
    produits,
    preview: {
      format,
      sheetName,
      headerRowIndex,
      headers: headers.filter(Boolean),
      totalRows: dataRows.length,
      validRows: produits.length,
      sampleRows: produits.slice(0, 8).map((p) => ({
        reference: p.reference,
        nom: p.nom,
        code_barre: p.code_barre,
        categorie: p.categorie,
        prix_vente: p.prix_vente,
        stock: p.stock_actuel,
      })),
      warnings,
    },
  }
}

export const DEFAULT_IMPORT_SETTINGS: ProductImportSettings = {
  defaultType: 'F',
  defaultTvaPct: 7,
  stockMinimum: 5,
  onDuplicate: 'update',
  matchBy: 'reference',
}

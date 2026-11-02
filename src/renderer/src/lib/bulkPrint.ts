export interface BulkPrintDocument {
  id: string
  numero: string
  type_document: string
  statut: string
  created_at: string
  client_nom?: string
  fournisseur_nom?: string
  _source?: 'documents' | 'ff'
}

const INVOICE_TYPES = new Set(['FACTURE_VENTE', 'FACTURE_JOURNALIERE_F', 'FACTURE_ACHAT'])
const DOCUMENT_TYPES = new Set([...INVOICE_TYPES, 'DEVIS', 'BON_LIVRAISON', 'FACTURE_ACHAT_BL', 'AVOIR'])

/** SQLite datetime('now') values are UTC, even when no Z suffix is stored. */
export function bulkPrintDate(value: string): Date {
  const utc = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value
  return new Date(utc)
}

export function selectBulkPrintDocuments<T extends BulkPrintDocument>(rows: T[], type: string): T[] {
  const seen = new Set<string>()
  return rows.filter(row => {
    if (['ANNULE', 'ANNULEE', 'REVOQUE', 'BROUILLON'].includes(row.statut)) return false
    if (type === 'TOUS' ? !INVOICE_TYPES.has(row.type_document) : row.type_document !== type || !DOCUMENT_TYPES.has(type)) return false
    const key = `${row._source ?? 'documents'}:${row.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).sort((a, b) => (bulkPrintDate(a.created_at).getTime() || 0) - (bulkPrintDate(b.created_at).getTime() || 0) || a.numero.localeCompare(b.numero))
}

export type BulkPrintStatus = 'pending' | 'preparing' | 'sending' | 'queued' | 'failed' | 'uncertain' | 'cancelled'
export interface BulkPrintResult { success: boolean; error?: string; uncertain?: boolean }

/** Submit one full invoice at a time. Never retry an ambiguous spooler result. */
export async function runBulkPrintQueue<T>(options: {
  items: T[]
  prepare: (item: T) => Promise<string>
  submit: (html: string, item: T) => Promise<BulkPrintResult>
  shouldStop: () => boolean
  onStatus: (item: T, status: BulkPrintStatus, error?: string) => void
}): Promise<void> {
  const { items, prepare, submit, shouldStop, onStatus } = options
  for (let index = 0; index < items.length; index++) {
    const item = items[index]
    if (shouldStop()) {
      for (const remaining of items.slice(index)) onStatus(remaining, 'cancelled')
      return
    }
    let html: string
    onStatus(item, 'preparing')
    try {
      html = await prepare(item)
      if (!html.trim()) throw new Error('Contenu de facture vide')
    } catch (error) {
      onStatus(item, 'failed', error instanceof Error ? error.message : String(error))
      continue
    }
    if (shouldStop()) {
      for (const remaining of items.slice(index)) onStatus(remaining, 'cancelled')
      return
    }
    onStatus(item, 'sending')
    let result: BulkPrintResult
    try {
      result = await submit(html, item)
    } catch (error) {
      // Lost IPC reply may occur after the driver accepted the invoice.
      result = { success: false, uncertain: true, error: error instanceof Error ? error.message : String(error) }
    }
    if (result.success) onStatus(item, 'queued')
    else if (result.uncertain) {
      onStatus(item, 'uncertain', result.error || 'Envoi non confirmé : vérifiez la file Windows avant de réimprimer.')
      for (const remaining of items.slice(index + 1)) onStatus(remaining, 'cancelled')
      return
    } else onStatus(item, 'failed', result.error || 'Échec de l’envoi')
  }
}

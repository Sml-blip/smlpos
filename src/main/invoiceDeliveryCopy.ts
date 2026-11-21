/** Documentary copy only: never inserts a sale or changes inventory/payment. */
export function createInvoiceDeliveryCopy(db: any, invoiceId: string, now: string, uuid: () => string) {
  return db.transaction(() => {
    const source = db.prepare('SELECT * FROM documents WHERE id=?').get(invoiceId)
    if (!source || !['FACTURE_VENTE', 'FACTURE_JOURNALIERE_F'].includes(source.type_document)) {
      throw new Error('Choisissez une facture de vente ou une facture journalière')
    }
    if (['ANNULE', 'REVOQUE', 'BROUILLON'].includes(source.statut)) throw new Error('Facture annulée, révoquée ou brouillon')
    const id = `bl-copy-${invoiceId}`
    const existing = db.prepare('SELECT * FROM documents WHERE id=?').get(id)
    if (existing) {
      if (['ANNULE', 'REVOQUE'].includes(existing.statut)) throw new Error('Le BL associé a été annulé. Consultez-le dans BL Vente.')
      return { document: existing, lines: [], alreadyExists: true }
    }
    const lines = db.prepare('SELECT * FROM lignes_document WHERE document_id=? ORDER BY rowid').all(invoiceId)
    if (!lines.length) throw new Error('La facture ne contient aucune ligne : aucun BL créé')
    const copy = {
      ...source, id, numero: `BL-${source.numero}`, type_document: 'BON_LIVRAISON', statut: 'ACTIF',
      vente_id: null, shift_id: null, avoir_id: null, document_origine_id: null,
      facture_origine_numero: null, annule_par: null, annule_at: null, annule_motif: null,
      timbre: 0, montant_paye: 0, net_a_payer: null, imprimee: 0,
      contenu_json: JSON.stringify({ copy_only: true, source_invoice_id: invoiceId, source_invoice_numero: source.numero }),
      created_at: now, updated_at: now,
    }
    const insert = (table: string, row: Record<string, unknown>) => {
      const allowed = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column: { name: string }) => column.name))
      const keys = Object.keys(row).filter(key => allowed.has(key))
      db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(key => row[key]))
    }
    insert('documents', copy)
    const copiedLines = lines.map((line: Record<string, unknown>) => ({ ...line, id: uuid(), document_id: id }))
    for (const line of copiedLines) insert('lignes_document', line)
    return { document: db.prepare('SELECT * FROM documents WHERE id=?').get(id), lines: copiedLines, alreadyExists: false }
  })()
}

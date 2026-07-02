import type { InvoiceDocData, InvoiceLineData } from '../components/InvoicePrintTemplate'

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

/** Shelf/cart prices are TTC — extract HT + TVA without double-counting tax. */
export function calcInvoiceLineFromTtcUnit(input: {
  quantite: number
  prix_unitaire_ttc: number
  remise_pct: number
  tva_taux: number
}): Pick<InvoiceLineData, 'prix_unitaire' | 'total_ht' | 'total_tva' | 'total_ttc' | 'tva_taux'> {
  const qty = input.quantite || 0
  const puTtc = input.prix_unitaire_ttc || 0
  const remise = input.remise_pct || 0
  const rate = input.tva_taux || 0
  const total_ttc = round3(qty * puTtc * (1 - remise / 100))

  if (rate <= 0) {
    return {
      prix_unitaire: round3(puTtc),
      total_ht: total_ttc,
      total_tva: 0,
      total_ttc,
      tva_taux: 0,
    }
  }

  const total_ht = round3(total_ttc / (1 + rate / 100))
  const total_tva = round3(total_ttc - total_ht)
  const prix_unitaire = round3(puTtc / (1 + rate / 100))

  return { prix_unitaire, total_ht, total_tva, total_ttc, tva_taux: rate }
}

export function buildInvoiceLineFromCart(input: {
  id: string
  designation: string
  quantite: number
  prix_unitaire_ttc: number
  remise_pct: number
  tva_taux: number
  reference?: string | null
  numero_serie?: string | null
}): InvoiceLineData {
  const calc = calcInvoiceLineFromTtcUnit({
    quantite: input.quantite,
    prix_unitaire_ttc: input.prix_unitaire_ttc,
    remise_pct: input.remise_pct,
    tva_taux: input.tva_taux,
  })
  return {
    id: input.id,
    designation: input.designation,
    quantite: input.quantite,
    remise_pct: input.remise_pct,
    reference: input.reference ?? null,
    numero_serie: input.numero_serie ?? null,
    ...calc,
  }
}

export function recalcEditableInvoiceLine(line: InvoiceLineData): InvoiceLineData {
  const calc = calcInvoiceLineFromTtcUnit({
    quantite: line.quantite,
    prix_unitaire_ttc: line.prix_unitaire * (1 + (line.tva_taux || 0) / 100),
    remise_pct: line.remise_pct,
    tva_taux: line.tva_taux,
  })
  return { ...line, ...calc }
}

/** Recompute line when user edits HT unit price in document editor. */
export function recalcInvoiceLineFromHtUnit(line: InvoiceLineData): InvoiceLineData {
  const rate = line.tva_taux || 0
  const total_ht = round3(line.quantite * line.prix_unitaire * (1 - (line.remise_pct || 0) / 100))
  const total_tva = rate > 0 ? round3(total_ht * (rate / 100)) : 0
  const total_ttc = round3(total_ht + total_tva)
  return { ...line, total_ht, total_tva, total_ttc }
}

export function sumInvoiceLines(lignes: InvoiceLineData[]): {
  total_ht: number
  total_tva: number
  total_ttc: number
} {
  return {
    total_ht: round3(lignes.reduce((s, l) => s + l.total_ht, 0)),
    total_tva: round3(lignes.reduce((s, l) => s + l.total_tva, 0)),
    total_ttc: round3(lignes.reduce((s, l) => s + l.total_ttc, 0)),
  }
}

export function applyTotalsToDoc(
  doc: InvoiceDocData,
  lignes: InvoiceLineData[],
  opts?: { timbre?: number; total_remise?: number },
): InvoiceDocData {
  const sums = sumInvoiceLines(lignes)
  const timbre = opts?.timbre ?? doc.timbre ?? 0
  const remise = opts?.total_remise ?? doc.total_remise ?? 0
  const isVente = doc.type_document === 'FACTURE_VENTE' || doc.type_document === 'FACTURE_JOURNALIERE_F'
  return {
    ...doc,
    total_ht: sums.total_ht,
    total_tva: sums.total_tva,
    total_ttc: sums.total_ttc,
    timbre: isVente ? timbre : doc.timbre,
    total_remise: remise,
    net_a_payer: round3(sums.total_ttc + (isVente ? timbre : 0) - remise),
  }
}

/** Fix legacy documents saved with TTC stored as HT. */
export function normalizeInvoiceLine(l: InvoiceLineData): InvoiceLineData {
  if (l.total_tva > 0 && l.total_ht > 0) return l
  if (!l.tva_taux || l.tva_taux <= 0) {
    const ttc = l.total_ttc || l.total_ht
    return { ...l, total_ht: ttc, total_tva: 0, total_ttc: ttc }
  }
  const ttc = l.total_ttc || l.total_ht
  return {
    ...l,
    ...calcInvoiceLineFromTtcUnit({
      quantite: l.quantite,
      prix_unitaire_ttc: ttc / Math.max(1, l.quantite) / Math.max(0.0001, 1 - (l.remise_pct || 0) / 100),
      remise_pct: l.remise_pct,
      tva_taux: l.tva_taux,
    }),
  }
}

import type { InvoiceDocData, InvoiceLineData } from '../components/InvoicePrintTemplate'

type AchatLigneInput = {
  id: string
  designation: string
  quantite: number
  nouveau_prix_achat: number
  tva_taux: number
  produit_id?: string
}

type ProduitRef = { id: string; reference: string; numero_serie?: string | null }

export function mapFactureAchatLignes(
  lignes: AchatLigneInput[],
  produits: ProduitRef[],
  exoFlag: boolean,
): InvoiceLineData[] {
  return lignes
    .filter(l => l.designation.trim())
    .map(l => {
      const prod = l.produit_id ? produits.find(p => p.id === l.produit_id) : undefined
      const ht = l.quantite * l.nouveau_prix_achat
      const tva = exoFlag ? 0 : ht * (l.tva_taux / 100)
      return {
        id: l.id,
        designation: l.designation,
        quantite: l.quantite,
        prix_unitaire: l.nouveau_prix_achat,
        remise_pct: 0,
        tva_taux: exoFlag ? 0 : l.tva_taux,
        total_ht: ht,
        total_tva: tva,
        total_ttc: ht + tva,
        reference: prod?.reference ?? null,
        numero_serie: prod?.numero_serie ?? null,
      }
    })
}

export function buildAchatInvoiceDoc(opts: {
  numero: string
  type: 'FACTURE_ACHAT' | 'FACTURE_ACHAT_BL'
  fournisseurNom: string
  fournisseurTel?: string | null
  fournisseurAdresse?: string | null
  fournisseurMatricule?: string | null
  dateFacture: string
  montantHT: number
  montantTVA: number
  montantTTC: number
  exoFlag: boolean
  exoText?: string
  remiseGlobale: number
  timbre: number
  statutPaiement?: string
}): InvoiceDocData {
  const netTTC = (opts.exoFlag ? opts.montantHT : opts.montantTTC) - opts.remiseGlobale + opts.timbre
  return {
    numero: opts.numero,
    type_document: opts.type,
    client_nom: opts.fournisseurNom,
    client_tel: opts.fournisseurTel ?? null,
    client_adresse: opts.fournisseurAdresse ?? null,
    client_matricule: opts.fournisseurMatricule ?? null,
    total_ht: opts.montantHT,
    total_tva: opts.exoFlag ? 0 : opts.montantTVA,
    total_ttc: opts.exoFlag ? opts.montantHT : opts.montantTTC,
    statut_paiement: opts.statutPaiement ?? 'EN_ATTENTE',
    created_at: opts.dateFacture.includes('T') ? opts.dateFacture : `${opts.dateFacture}T12:00:00.000Z`,
    timbre: opts.timbre,
    total_remise: opts.remiseGlobale,
    exo: opts.exoFlag ? (opts.exoText || 'Exonéré TVA') : null,
    net_a_payer: netTTC,
  }
}

export function mapDbFactureAchatToInvoice(
  facture: Record<string, unknown>,
  lignes: Record<string, unknown>[],
): { doc: InvoiceDocData; lignes: InvoiceLineData[] } {
  const exo = facture.exo as string | null | undefined
  const remise = (facture.total_remise as number) ?? 0
  const timbre = (facture.timbre as number) ?? 0
  const ht = (facture.montant_ht as number) ?? 0
  const tva = (facture.montant_tva as number) ?? 0
  const ttc = (facture.montant_ttc as number) ?? 0
  const type = (facture.type as string) || 'FACTURE_ACHAT'

  const doc = buildAchatInvoiceDoc({
    numero: String(facture.numero_facture ?? facture.numero ?? ''),
    type: type as 'FACTURE_ACHAT' | 'FACTURE_ACHAT_BL',
    fournisseurNom: String(facture.fournisseur_nom ?? 'Fournisseur'),
    fournisseurTel: facture.telephone as string | null,
    fournisseurAdresse: facture.adresse as string | null,
    fournisseurMatricule: facture.matricule_fiscal as string | null,
    dateFacture: String(facture.date_facture ?? facture.created_at ?? new Date().toISOString()),
    montantHT: ht,
    montantTVA: tva,
    montantTTC: ttc,
    exoFlag: !!exo,
    exoText: exo ?? undefined,
    remiseGlobale: remise,
    timbre,
    statutPaiement: String(facture.statut_paiement ?? 'EN_ATTENTE'),
  })
  doc.net_a_payer = ttc

  const mappedLignes: InvoiceLineData[] = lignes.map(l => {
    const q = (l.quantite as number) ?? 1
    const pu = (l.nouveau_prix_achat as number) ?? 0
    const taux = (l.tva_taux as number) ?? 0
    const lineHT = q * pu
    const lineTVA = exo ? 0 : lineHT * (taux / 100)
    return {
      id: String(l.id),
      designation: String(l.designation ?? ''),
      quantite: q,
      prix_unitaire: pu,
      remise_pct: 0,
      tva_taux: exo ? 0 : taux,
      total_ht: lineHT,
      total_tva: lineTVA,
      total_ttc: lineHT + lineTVA,
      reference: (l.reference as string) ?? null,
      numero_serie: null,
    }
  })

  return { doc, lignes: mappedLignes }
}

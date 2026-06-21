import { forwardRef } from 'react'
import { amountToWordsDT } from '../lib/amountToWords'
import { INVOICE_COMPANY } from '../lib/invoiceCompany'

export interface InvoiceCompanySettings {
  company_name?: string
  company_subtitle?: string
  company_address?: string
  company_phone?: string
  company_matricule?: string
  company_rib?: string
  company_logo?: string
  invoice_footer?: string
  invoice_show_tva?: string
  invoice_primary_color?: string
  invoice_timbre_fiscal?: string
  boutique_rib?: string
  boutique_banque?: string
  [key: string]: string | undefined
}

export interface InvoiceDocData {
  numero: string
  type_document: string
  client_nom?: string | null
  client_tel?: string | null
  client_adresse?: string | null
  client_matricule?: string | null
  total_ht: number
  total_tva: number
  total_ttc: number
  statut_paiement: string
  date_echeance?: string | null
  created_at: string
}

export interface InvoiceLineData {
  id: string
  designation: string
  quantite: number
  prix_unitaire: number
  remise_pct: number
  tva_taux: number
  total_ht: number
  total_tva: number
  total_ttc: number
  reference?: string | null
}

interface Props {
  doc: InvoiceDocData
  lignes: InvoiceLineData[]
  settings: InvoiceCompanySettings
}

const DOC_LABELS: Record<string, string> = {
  FACTURE_VENTE: 'Facture',
  DEVIS: 'Devis',
  BON_LIVRAISON: 'Bon de Livraison',
  FACTURE_JOURNALIERE_F: 'Facture Journalière',
  FACTURE_ACHAT: 'Facture Achat',
  FACTURE_ACHAT_BL: 'Bon de Livraison Achat',
  TICKET: 'Ticket',
}

type DocPalette = { primary: string; primarySoft: string; secondarySoft: string; titleColor: string }

const DOC_PALETTES: Record<string, DocPalette> = {
  FACTURE_VENTE: { primary: '#D6B05E', primarySoft: '#FBF7EE', secondarySoft: '#F8FAFC', titleColor: '#1E293B' },
  DEVIS: { primary: '#7DD3FC', primarySoft: '#E0F2FE', secondarySoft: '#F0F9FF', titleColor: '#0369A1' },
  BON_LIVRAISON: { primary: '#86EFAC', primarySoft: '#DCFCE7', secondarySoft: '#F0FDF4', titleColor: '#166534' },
  FACTURE_JOURNALIERE_F: { primary: '#D6B05E', primarySoft: '#FBF7EE', secondarySoft: '#F8FAFC', titleColor: '#1E293B' },
  FACTURE_ACHAT: { primary: '#FB923C', primarySoft: '#FFEDD5', secondarySoft: '#FFF7ED', titleColor: '#9A3412' },
  FACTURE_ACHAT_BL: { primary: '#FB923C', primarySoft: '#FFEDD5', secondarySoft: '#FFF7ED', titleColor: '#9A3412' },
}

const STATUT_PAYMENT_LABELS: Record<string, string> = {
  PAYE: 'Payé',
  EN_ATTENTE: 'En attente',
  PARTIEL: 'Partiel',
  EN_RETARD: 'En retard',
}

const fmt3 = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })

const InvoicePrintTemplate = forwardRef<HTMLDivElement, Props>(({ doc, lignes, settings }, ref) => {
  const palette = DOC_PALETTES[doc.type_document] ?? DOC_PALETTES.FACTURE_VENTE
  const showTva = settings.invoice_show_tva !== 'false'
  const isFacture = doc.type_document === 'FACTURE_VENTE' || doc.type_document === 'FACTURE_JOURNALIERE_F'
  const timbre = isFacture ? 1.0 : 0

  const companyName = INVOICE_COMPANY.name
  const companySubtitle = INVOICE_COMPANY.subtitle
  const companyAddress = `${INVOICE_COMPANY.address} — ${INVOICE_COMPANY.city}`
  const companyPhone = INVOICE_COMPANY.phone
  const companyMatricule = INVOICE_COMPANY.matricule
  const companyLogo = INVOICE_COMPANY.logo
  const companyRib = INVOICE_COMPANY.rib
  const footer = settings.invoice_footer || INVOICE_COMPANY.footer

  const tvaMap = new Map<number, { base: number; montant: number }>()
  lignes.forEach(l => {
    const e = tvaMap.get(l.tva_taux) || { base: 0, montant: 0 }
    tvaMap.set(l.tva_taux, { base: e.base + l.total_ht, montant: e.montant + l.total_tva })
  })
  const tvaRows = Array.from(tvaMap.entries()).sort((a, b) => a[0] - b[0])

  const totalBrutHT = lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire, 0)
  const totalRemises = Math.max(0, totalBrutHT - doc.total_ht)
  const displayedTotal = doc.total_ttc + timbre

  const dateFormatted = new Date(doc.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const docLabel = DOC_LABELS[doc.type_document] || doc.type_document
  const amountWords = amountToWordsDT(displayedTotal)
  const statutLabel = STATUT_PAYMENT_LABELS[doc.statut_paiement] || doc.statut_paiement

  const density = lignes.length >= 12 ? 'ultra' : lignes.length >= 8 ? 'dense' : lignes.length >= 5 ? 'compact' : 'normal'
  const isCompact = density !== 'normal'
  const isUltra = density === 'ultra'
  const fillerCount = isUltra ? 0 : Math.max(0, 12 - lignes.length)
  const totalQty = lignes.reduce((s, l) => s + l.quantite, 0)

  const C = {
    text: '#1E293B',
    textLight: '#64748B',
    border: '#E2E8F0',
    borderLight: '#F1F5F9',
    white: '#FFFFFF',
    surface: '#FAFBFC',
    ...palette,
  }

  return (
    <div
      ref={ref}
      style={{
        fontFamily: "'Montserrat', 'Inter', system-ui, sans-serif",
        fontSize: isUltra ? '8px' : isCompact ? '9px' : '11px',
        color: C.text,
        background: C.white,
        width: '100%',
        maxWidth: '780px',
        minHeight: isUltra ? 'auto' : '980px',
        margin: '0 auto',
        padding: isUltra ? '8px' : '24px',
        boxSizing: 'border-box',
        border: `1px solid ${C.border}`,
        borderRadius: '12px',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: isUltra ? 8 : 20 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', maxWidth: '42%' }}>
          {companyLogo ? (
            <img src={companyLogo} alt="" style={{ width: isUltra ? 48 : 72, height: 'auto', objectFit: 'contain' }} />
          ) : (
            <div style={{ width: 48, height: 48, background: C.primary, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 18 }}>
              {companyName.charAt(0)}
            </div>
          )}
          {!isUltra && (
            <div style={{ fontSize: 11, fontWeight: 600, lineHeight: 1.4, color: C.textLight }}>{companySubtitle || companyName}</div>
          )}
        </div>
        <div style={{ fontSize: isUltra ? 22 : 36, fontWeight: 700, color: C.titleColor, letterSpacing: '-0.5px' }}>{docLabel}</div>
        <div style={{ textAlign: 'right', fontSize: 11, color: C.textLight, lineHeight: 1.5 }}>
          <div style={{ fontWeight: 700, color: C.text }}>N° {doc.numero}</div>
          <div>Créée le : {dateFormatted}</div>
          <div>{statutLabel}</div>
        </div>
      </div>

      {/* Seller / Client */}
      <div style={{ display: 'flex', gap: isUltra ? 6 : 14, marginBottom: isUltra ? 6 : 18 }}>
        <div style={{ flex: 1, border: `1px solid ${C.border}`, borderRadius: 14, padding: isUltra ? 6 : 14, background: C.secondarySoft, lineHeight: 1.6 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{companyName}</div>
          {companyAddress && <div><span style={{ color: C.textLight }}>Siège :</span> {companyAddress}</div>}
          {companyMatricule && <div><span style={{ color: C.textLight }}>MF :</span> {companyMatricule}</div>}
          {companyPhone && <div><span style={{ color: C.textLight }}>Tél :</span> {companyPhone}</div>}
        </div>
        <div style={{ flex: 1, border: `1px solid ${C.border}`, borderRadius: 14, padding: isUltra ? 6 : 14, background: C.primarySoft, lineHeight: 1.6 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{doc.client_nom || 'Client Passager'}</div>
          {doc.client_adresse && <div><span style={{ color: C.textLight }}>Adresse :</span> {doc.client_adresse}</div>}
          {doc.client_tel && <div><span style={{ color: C.textLight }}>Tél :</span> {doc.client_tel}</div>}
          {doc.client_matricule && <div><span style={{ color: C.textLight }}>MF :</span> {doc.client_matricule}</div>}
        </div>
      </div>

      {/* Lines table */}
      <div style={{ flex: 1 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', border: `1px solid ${C.border}`, borderRadius: '12px 12px 0 0', overflow: 'hidden' }}>
          <thead>
            <tr style={{ background: C.primary, color: '#fff' }}>
              {['Code', 'Désignation', 'Qté', 'PU HT', 'Rem.', showTva ? 'TVA' : null, 'HT', 'TTC'].filter(Boolean).map((h, i) => (
                <th key={h!} style={{
                  padding: isUltra ? '3px 4px' : '7px 8px',
                  textAlign: i >= 2 ? (i === 2 || (showTva && i === 5) ? 'center' : 'right') : 'left',
                  fontWeight: 600,
                  fontSize: isUltra ? 7 : 9,
                  borderRight: i < 7 ? '1px solid rgba(255,255,255,0.15)' : undefined,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lignes.map((l, idx) => (
              <tr key={l.id} style={{ background: idx % 2 === 0 ? C.white : C.surface }}>
                <td style={{ padding: isUltra ? '2px 4px' : '6px 8px', borderBottom: `1px solid ${C.borderLight}`, borderRight: `1px solid ${C.borderLight}` }}>{l.reference || '—'}</td>
                <td style={{ padding: isUltra ? '2px 4px' : '6px 8px', borderBottom: `1px solid ${C.borderLight}`, borderRight: `1px solid ${C.borderLight}` }}>{l.designation}</td>
                <td style={{ padding: isUltra ? '2px 4px' : '6px 8px', textAlign: 'center', borderBottom: `1px solid ${C.borderLight}`, borderRight: `1px solid ${C.borderLight}` }}>{l.quantite}</td>
                <td style={{ padding: isUltra ? '2px 4px' : '6px 8px', textAlign: 'right', borderBottom: `1px solid ${C.borderLight}`, borderRight: `1px solid ${C.borderLight}` }}>{fmt3(l.prix_unitaire)}</td>
                <td style={{ padding: isUltra ? '2px 4px' : '6px 8px', textAlign: 'right', borderBottom: `1px solid ${C.borderLight}`, borderRight: `1px solid ${C.borderLight}` }}>{l.remise_pct ? `${l.remise_pct}%` : '0%'}</td>
                {showTva && (
                  <td style={{ padding: isUltra ? '2px 4px' : '6px 8px', textAlign: 'center', borderBottom: `1px solid ${C.borderLight}`, borderRight: `1px solid ${C.borderLight}` }}>{l.tva_taux}%</td>
                )}
                <td style={{ padding: isUltra ? '2px 4px' : '6px 8px', textAlign: 'right', borderBottom: `1px solid ${C.borderLight}`, borderRight: `1px solid ${C.borderLight}` }}>{fmt3(l.total_ht)}</td>
                <td style={{ padding: isUltra ? '2px 4px' : '6px 8px', textAlign: 'right', borderBottom: `1px solid ${C.borderLight}`, background: C.primarySoft, fontWeight: 600 }}>{fmt3(l.total_ttc)}</td>
              </tr>
            ))}
            {!isUltra && Array.from({ length: fillerCount }).map((_, i) => (
              <tr key={`f-${i}`} style={{ background: (lignes.length + i) % 2 === 0 ? C.white : C.surface }}>
                <td colSpan={showTva ? 8 : 7} style={{ height: 22, borderBottom: `1px solid ${C.borderLight}` }} />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: C.secondarySoft, fontWeight: 600 }}>
              <td colSpan={2} style={{ padding: '6px 8px', borderTop: `1px solid ${C.border}` }}>{lignes.length} article(s)</td>
              <td style={{ textAlign: 'center', borderTop: `1px solid ${C.border}` }}>{totalQty}</td>
              <td colSpan={showTva ? 4 : 3} style={{ borderTop: `1px solid ${C.border}` }} />
              <td style={{ textAlign: 'right', padding: '6px 8px', borderTop: `1px solid ${C.border}`, background: C.primarySoft, fontWeight: 700 }}>{fmt3(displayedTotal)} DT</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Footer blocks */}
      <div style={{ display: 'grid', gridTemplateColumns: showTva && !isUltra ? '1fr 1fr' : '1fr', border: `1px solid ${C.border}`, borderRadius: '0 0 12px 12px', overflow: 'hidden', marginTop: -1 }}>
        {showTva && !isUltra && (
          <div style={{ borderRight: `1px solid ${C.border}` }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
              <thead>
                <tr style={{ background: C.surface }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>Base HT</th>
                  <th style={{ textAlign: 'center', padding: '6px 4px' }}>Taux</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }}>Montant TVA</th>
                </tr>
              </thead>
              <tbody>
                {(tvaRows.length ? tvaRows : [[0, { base: 0, montant: 0 }]]).map(([taux, { base, montant }]) => (
                  <tr key={taux}>
                    <td style={{ padding: '6px 8px' }}>{fmt3(base)}</td>
                    <td style={{ textAlign: 'center' }}>{taux}%</td>
                    <td style={{ textAlign: 'right', padding: '6px 8px' }}>{fmt3(montant)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ borderTop: `1px solid ${C.border}`, padding: 8, background: C.surface }}>
              <div style={{ fontSize: 9, color: C.textLight, marginBottom: 4 }}>Arrêtée la présente {docLabel.toLowerCase()} à la somme de :</div>
              <div style={{ fontStyle: 'italic', fontWeight: 700 }}>{amountWords}</div>
            </div>
          </div>
        )}
        <div>
          {[
            ['Total Remise', totalRemises > 0 ? fmt3(totalRemises) : fmt3(0)],
            ...(showTva ? [['Total TVA', fmt3(doc.total_tva)]] : []),
            ['Total HT', fmt3(doc.total_ht)],
            ...(timbre > 0 ? [['Timbre Fiscal', fmt3(timbre)]] : []),
          ].map(([label, value], i) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 10px', background: i % 2 ? C.surface : C.white, borderBottom: `1px solid ${C.borderLight}`, fontSize: 10 }}>
              <span style={{ color: C.textLight }}>{label}</span>
              <span style={{ fontWeight: 500 }}>{value} DT</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: C.primarySoft }}>
            <span style={{ fontWeight: 700 }}>Net à payer</span>
            <span style={{ fontWeight: 800, fontSize: isCompact ? 14 : 16 }}>{fmt3(displayedTotal)} DT</span>
          </div>
        </div>
      </div>

      {(isUltra || !showTva) && (
        <div style={{ marginTop: 8, padding: 8, background: C.primarySoft, borderRadius: 8, fontSize: isUltra ? 8 : 10 }}>
          <span style={{ color: C.textLight }}>Arrêtée à : </span>
          <span style={{ fontStyle: 'italic', fontWeight: 600 }}>{amountWords}</span>
        </div>
      )}

      <div style={{ marginTop: 10, fontSize: 9, color: C.textLight, textAlign: 'center' }}>
        {companyRib ? `RIB : ${companyRib}` : footer}
      </div>
    </div>
  )
})

InvoicePrintTemplate.displayName = 'InvoicePrintTemplate'

export default InvoicePrintTemplate

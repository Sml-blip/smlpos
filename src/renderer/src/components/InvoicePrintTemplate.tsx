import { forwardRef, type CSSProperties } from 'react'
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
  timbre?: number
  total_remise?: number
  exo?: string | null
  net_a_payer?: number
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
  numero_serie?: string | null
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

const FIRST_PAGE_LINES = 10
const FIRST_PAGE_MULTI_LINES = 14
const NEXT_PAGE_LINES = 18
const LAST_PAGE_LINES = 11

const fmt3 = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })

function paginateLines(lines: InvoiceLineData[]): InvoiceLineData[][] {
  if (!lines.length) return [[]]
  if (lines.length <= FIRST_PAGE_LINES) return [lines]

  const pages: InvoiceLineData[][] = []
  pages.push(lines.slice(0, FIRST_PAGE_MULTI_LINES))
  let i = FIRST_PAGE_MULTI_LINES

  while (i < lines.length) {
    const remaining = lines.length - i
    if (remaining <= LAST_PAGE_LINES) {
      pages.push(lines.slice(i))
      break
    }
    const take = Math.min(NEXT_PAGE_LINES, remaining - LAST_PAGE_LINES)
    if (take <= 0) {
      pages.push(lines.slice(i))
      break
    }
    pages.push(lines.slice(i, i + take))
    i += take
  }
  return pages
}

const InvoicePrintTemplate = forwardRef<HTMLDivElement, Props>(({ doc, lignes, settings }, ref) => {
  const palette = DOC_PALETTES[doc.type_document] ?? DOC_PALETTES.FACTURE_VENTE
  const showTva = settings.invoice_show_tva !== 'false'
  const isVenteFacture = doc.type_document === 'FACTURE_VENTE' || doc.type_document === 'FACTURE_JOURNALIERE_F'
  const isAchat = doc.type_document === 'FACTURE_ACHAT' || doc.type_document === 'FACTURE_ACHAT_BL'
  const timbre = doc.timbre ?? (isVenteFacture ? 1.0 : isAchat ? 0 : 0)

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

  const lineTotals = lignes.reduce(
    (acc, l) => ({
      ht: acc.ht + l.total_ht,
      tva: acc.tva + l.total_tva,
      ttc: acc.ttc + l.total_ttc,
    }),
    { ht: 0, tva: 0, ttc: 0 },
  )
  const totalHT = lineTotals.ht || doc.total_ht
  const totalTVA = lineTotals.tva || doc.total_tva
  const totalTTC = lineTotals.ttc || doc.total_ttc

  const totalBrutHT = lignes.reduce((s, l) => {
    const puTtc = l.prix_unitaire * (1 + (l.tva_taux || 0) / 100)
    return s + l.quantite * puTtc
  }, 0)
  const computedRemise = Math.max(0, totalBrutHT - totalTTC)
  const totalRemises = doc.total_remise ?? computedRemise
  const displayedTotal = doc.net_a_payer ?? (totalTTC + (isVenteFacture ? timbre : 0) - totalRemises)

  const dateFormatted = new Date(doc.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const docLabel = DOC_LABELS[doc.type_document] || doc.type_document
  const amountWords = amountToWordsDT(displayedTotal)
  const statutLabel = STATUT_PAYMENT_LABELS[doc.statut_paiement] || doc.statut_paiement
  const totalQty = lignes.reduce((s, l) => s + l.quantite, 0)
  const pages = paginateLines(lignes)
  const pageCount = pages.length

  const colWidths = showTva
    ? ['6%', '42%', '4%', '10%', '4%', '4%', '14%', '16%']
    : ['7%', '46%', '5%', '11%', '5%', '13%', '13%']

  const cellPad = '5px 4px'
  const numCell: CSSProperties = { padding: cellPad, textAlign: 'right', whiteSpace: 'nowrap', fontSize: 9 }
  const centerCell: CSSProperties = { ...numCell, textAlign: 'center' }

  const C = {
    text: '#1E293B',
    textLight: '#64748B',
    border: '#E2E8F0',
    borderLight: '#F1F5F9',
    white: '#FFFFFF',
    surface: '#FAFBFC',
    ...palette,
  }

  const tierLabel = isAchat ? 'Fournisseur' : 'Client'

  const renderLineRow = (l: InvoiceLineData, idx: number) => (
    <tr key={l.id} style={{ background: idx % 2 === 0 ? C.white : C.surface }}>
      <td style={{ padding: cellPad, borderBottom: `1px solid ${C.borderLight}`, borderRight: `1px solid ${C.borderLight}`, fontSize: 9, verticalAlign: 'top' }}>
        {l.reference || '—'}
      </td>
      <td style={{ padding: cellPad, borderBottom: `1px solid ${C.borderLight}`, borderRight: `1px solid ${C.borderLight}`, verticalAlign: 'top' }}>
        <div style={{ fontSize: 10, lineHeight: 1.3 }}>{l.designation}</div>
        {l.numero_serie ? (
          <div style={{ fontSize: 8, color: C.textLight, marginTop: 2, fontStyle: 'italic' }}>
            S/N : {l.numero_serie}
          </div>
        ) : null}
      </td>
      <td style={{ ...centerCell, borderBottom: `1px solid ${C.borderLight}`, borderRight: `1px solid ${C.borderLight}`, verticalAlign: 'top' }}>{l.quantite}</td>
      <td style={{ ...numCell, borderBottom: `1px solid ${C.borderLight}`, borderRight: `1px solid ${C.borderLight}`, verticalAlign: 'top' }}>{fmt3(l.prix_unitaire)}</td>
      <td style={{ ...numCell, borderBottom: `1px solid ${C.borderLight}`, borderRight: `1px solid ${C.borderLight}`, verticalAlign: 'top' }}>{l.remise_pct ? `${l.remise_pct}%` : '0%'}</td>
      {showTva && (
        <td style={{ ...centerCell, borderBottom: `1px solid ${C.borderLight}`, borderRight: `1px solid ${C.borderLight}`, verticalAlign: 'top' }}>{l.tva_taux}%</td>
      )}
      <td style={{ ...numCell, borderBottom: `1px solid ${C.borderLight}`, borderRight: `1px solid ${C.borderLight}`, verticalAlign: 'top' }}>{fmt3(l.total_ht)}</td>
      <td style={{ ...numCell, borderBottom: `1px solid ${C.borderLight}`, background: C.primarySoft, fontWeight: 600, verticalAlign: 'top' }}>{fmt3(l.total_ttc)}</td>
    </tr>
  )

  const renderTableHead = () => (
    <thead>
      <tr style={{ background: C.primary, color: '#fff' }}>
        {['Code', 'Désignation', 'Qté', 'PU HT', 'Rem.', showTva ? 'TVA' : null, 'HT', 'TTC'].filter(Boolean).map((h, i) => (
          <th key={h!} style={{
            padding: '6px 4px',
            textAlign: i >= 2 ? (i === 2 || (showTva && i === 5) ? 'center' : 'right') : 'left',
            fontWeight: 600,
            fontSize: 8,
            whiteSpace: 'nowrap',
            borderRight: i < 7 ? '1px solid rgba(255,255,255,0.15)' : undefined,
          }}>{h}</th>
        ))}
      </tr>
    </thead>
  )

  const renderSummaryFoot = () => (
    <tfoot>
      <tr style={{ background: C.secondarySoft, fontWeight: 600 }}>
        <td colSpan={2} style={{ padding: '6px 8px', borderTop: `1px solid ${C.border}` }}>{lignes.length} article(s)</td>
        <td style={{ textAlign: 'center', borderTop: `1px solid ${C.border}` }}>{totalQty}</td>
        <td colSpan={showTva ? 4 : 3} style={{ borderTop: `1px solid ${C.border}` }} />
        <td style={{ textAlign: 'right', padding: '6px 8px', borderTop: `1px solid ${C.border}`, background: C.primarySoft, fontWeight: 700 }}>{fmt3(displayedTotal)} DT</td>
      </tr>
    </tfoot>
  )

  const renderTotalsBlock = () => (
    <>
      <div className="invoice-totals" style={{ display: 'grid', gridTemplateColumns: showTva ? '1fr 1fr' : '1fr', border: `1px solid ${C.border}`, borderRadius: '0 0 12px 12px', overflow: 'hidden', marginTop: -1 }}>
        {showTva && (
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
          {doc.exo ? (
            <div style={{ padding: '6px 10px', background: '#FEF3C7', borderBottom: `1px solid ${C.borderLight}`, fontSize: 10 }}>
              EXO : {doc.exo}
            </div>
          ) : null}
          {[
            ['Total Remise', totalRemises > 0 ? fmt3(totalRemises) : fmt3(0)],
            ...(showTva ? [['Total TVA', fmt3(totalTVA)]] : []),
            ['Total HT', fmt3(totalHT)],
            ...(timbre > 0 ? [['Timbre Fiscal', fmt3(timbre)]] : []),
          ].map(([label, value], i) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 10px', background: i % 2 ? C.surface : C.white, borderBottom: `1px solid ${C.borderLight}`, fontSize: 10 }}>
              <span style={{ color: C.textLight }}>{label}</span>
              <span style={{ fontWeight: 500 }}>{value} DT</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: C.primarySoft }}>
            <span style={{ fontWeight: 700 }}>Net à payer</span>
            <span style={{ fontWeight: 800, fontSize: 16 }}>{fmt3(displayedTotal)} DT</span>
          </div>
        </div>
      </div>

      {!showTva && (
        <div style={{ marginTop: 8, padding: 8, background: C.primarySoft, borderRadius: 8, fontSize: 10 }}>
          <span style={{ color: C.textLight }}>Arrêtée à : </span>
          <span style={{ fontStyle: 'italic', fontWeight: 600 }}>{amountWords}</span>
        </div>
      )}

      <div style={{ marginTop: 10, fontSize: 9, color: C.textLight, textAlign: 'center' }}>
        {companyRib ? `RIB : ${companyRib}` : footer}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, minHeight: 72, padding: '8px 10px', background: C.white }}>
          <div style={{ fontSize: 8, fontWeight: 700, color: C.textLight, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Signature</div>
        </div>
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, minHeight: 72, padding: '8px 10px', background: C.white }}>
          <div style={{ fontSize: 8, fontWeight: 700, color: C.textLight, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Cachet</div>
        </div>
      </div>
    </>
  )

  return (
    <div
      ref={ref}
      style={{
        fontFamily: "'Montserrat', 'Inter', system-ui, sans-serif",
        fontSize: '11px',
        color: C.text,
        background: C.white,
        width: '100%',
        maxWidth: '780px',
        margin: '0 auto',
        boxSizing: 'border-box',
      }}
    >
      {pages.map((pageLines, pageIdx) => {
        const isFirst = pageIdx === 0
        const isLast = pageIdx === pageCount - 1

        return (
          <div
            key={pageIdx}
            className="invoice-page"
            style={{
              minHeight: isLast ? '980px' : 'auto',
              margin: '0 auto 12px',
              padding: '20px 16px',
              border: `1px solid ${C.border}`,
              borderRadius: '12px',
              display: 'flex',
              flexDirection: 'column',
              boxSizing: 'border-box',
              width: '100%',
              maxWidth: '780px',
              pageBreakAfter: isLast ? 'auto' : 'always',
              breakAfter: isLast ? 'auto' : 'page',
            }}
          >
            {isFirst ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', maxWidth: '42%' }}>
                    {companyLogo ? (
                      <img src={companyLogo} alt="" style={{ width: 72, height: 'auto', objectFit: 'contain' }} />
                    ) : (
                      <div style={{ width: 48, height: 48, background: C.primary, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 18 }}>
                        {companyName.charAt(0)}
                      </div>
                    )}
                    <div style={{ fontSize: 11, fontWeight: 600, lineHeight: 1.4, color: C.textLight }}>{companySubtitle || companyName}</div>
                  </div>
                  <div style={{ fontSize: 36, fontWeight: 700, color: C.titleColor, letterSpacing: '-0.5px' }}>{docLabel}</div>
                  <div style={{ textAlign: 'right', fontSize: 11, color: C.textLight, lineHeight: 1.5 }}>
                    <div style={{ fontWeight: 700, color: C.text }}>N° {doc.numero}</div>
                    <div>Créée le : {dateFormatted}</div>
                    <div>{statutLabel}</div>
                    <div>Page : {pageIdx + 1}/{pageCount}</div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 14, marginBottom: 18 }}>
                  <div style={{ flex: 1, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, background: C.secondarySoft, lineHeight: 1.6 }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>{companyName}</div>
                    {companyAddress && <div><span style={{ color: C.textLight }}>Siège :</span> {companyAddress}</div>}
                    {companyMatricule && <div><span style={{ color: C.textLight }}>MF :</span> {companyMatricule}</div>}
                    {companyPhone && <div><span style={{ color: C.textLight }}>Tél :</span> {companyPhone}</div>}
                    {companyRib && <div><span style={{ color: C.textLight }}>RIB :</span> {companyRib}</div>}
                  </div>
                  <div style={{ flex: 1, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, background: C.primarySoft, lineHeight: 1.6 }}>
                    <div style={{ fontSize: 9, color: C.textLight, marginBottom: 2 }}>{tierLabel}</div>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>{doc.client_nom || (isAchat ? 'Fournisseur' : 'Client Passager')}</div>
                    {doc.client_adresse && <div><span style={{ color: C.textLight }}>Adresse :</span> {doc.client_adresse}</div>}
                    {doc.client_tel && <div><span style={{ color: C.textLight }}>Tél :</span> {doc.client_tel}</div>}
                    {doc.client_matricule && <div><span style={{ color: C.textLight }}>MF :</span> {doc.client_matricule}</div>}
                  </div>
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingBottom: 8, borderBottom: `1px solid ${C.border}` }}>
                <div style={{ fontWeight: 700, color: C.titleColor }}>{docLabel} — N° {doc.numero}</div>
                <div style={{ fontSize: 10, color: C.textLight }}>Suite · Page {pageIdx + 1}/{pageCount}</div>
              </div>
            )}

            <div style={{ flex: isLast ? '1 1 auto' : undefined, display: 'flex', flexDirection: 'column', minHeight: isLast ? 0 : undefined }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', border: `1px solid ${C.border}`, borderRadius: isLast ? '12px 12px 0 0' : '12px', overflow: 'hidden' }}>
                <colgroup>
                  {colWidths.map((w, i) => (
                    <col key={i} style={{ width: w }} />
                  ))}
                </colgroup>
                {renderTableHead()}
                <tbody>
                  {pageLines.map((l, idx) => renderLineRow(l, idx))}
                </tbody>
                {isLast ? renderSummaryFoot() : null}
              </table>
              {isLast ? (
                <div className="invoice-footer-block" style={{ marginTop: 'auto', paddingTop: 8 }}>
                  {renderTotalsBlock()}
                </div>
              ) : null}
            </div>

            {!isLast && (
              <div style={{ marginTop: 'auto', paddingTop: 12, fontSize: 9, color: C.textLight, textAlign: 'right' }}>
                Suite page suivante…
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
})

InvoicePrintTemplate.displayName = 'InvoicePrintTemplate'

export default InvoicePrintTemplate

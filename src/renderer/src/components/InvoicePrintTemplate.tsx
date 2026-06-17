import { forwardRef } from 'react'
import { amountToWordsDT } from '../lib/amountToWords'

export interface InvoiceCompanySettings {
  company_name?: string
  company_subtitle?: string
  company_address?: string
  company_phone?: string
  company_matricule?: string
  company_rib?: string
  company_logo?: string        // base64 data URL or URL
  invoice_footer?: string
  invoice_show_tva?: string
  invoice_primary_color?: string
  invoice_timbre_fiscal?: string  // 'true' | 'false'
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

const DOCUMENT_THEME: Record<string, { headerBg: string; accent: string; badge: string }> = {
  FACTURE_VENTE:       { headerBg: '#FFFDE7', accent: '#F59E0B', badge: '#F9A825' },
  DEVIS:               { headerBg: '#E8F4FD', accent: '#1E88E5', badge: '#1565C0' },
  BON_LIVRAISON:       { headerBg: '#E8F5E9', accent: '#43A047', badge: '#2E7D32' },
  FACTURE_JOURNALIERE_F: { headerBg: '#FFFDE7', accent: '#F59E0B', badge: '#F9A825' },
  FACTURE_ACHAT:       { headerBg: '#FBE9E7', accent: '#EF6C00', badge: '#E64A19' },
  FACTURE_ACHAT_BL:    { headerBg: '#FFF3E0', accent: '#FB8C00', badge: '#E65100' },
}

const STATUT_PAYMENT_LABELS: Record<string, string> = {
  PAYE: 'Payé',
  EN_ATTENTE: 'En attente',
  PARTIEL: 'Partiel',
  EN_RETARD: 'En retard',
}

const InvoicePrintTemplate = forwardRef<HTMLDivElement, Props>(({ doc, lignes, settings }, ref) => {
  const theme = DOCUMENT_THEME[doc.type_document]
  const primary = theme?.accent || settings.invoice_primary_color || '#F59E0B'
  const headerBg = theme?.headerBg || '#FFFDE7'
  const showTva = settings.invoice_show_tva !== 'false'
  const showTimbre = settings.invoice_timbre_fiscal === 'true' && doc.type_document === 'FACTURE_VENTE'
  const timbre = showTimbre ? 1.0 : 0

  const companyName = settings.company_name || 'SML Store'
  const companySubtitle = settings.company_subtitle || ''
  const companyAddress = settings.company_address || ''
  const companyPhone = settings.company_phone || ''
  const companyMatricule = settings.company_matricule || ''
  const companyRib = settings.boutique_rib || settings.company_rib || ''
  const boutiqueBank = settings.boutique_banque || ''
  const companyLogo = settings.company_logo || ''
  const footer = settings.invoice_footer || 'Merci pour votre confiance !'
  const companyInitial = companyName.trim().charAt(0).toUpperCase()

  // TVA breakdown by rate (sorted ascending)
  const tvaMap = new Map<number, { base: number; montant: number }>()
  lignes.forEach(l => {
    const e = tvaMap.get(l.tva_taux) || { base: 0, montant: 0 }
    tvaMap.set(l.tva_taux, { base: e.base + l.total_ht, montant: e.montant + l.total_tva })
  })
  const tvaRows = Array.from(tvaMap.entries()).sort((a, b) => a[0] - b[0])

  // Computed totals
  const totalBrutHT = lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire, 0)
  const totalRemises = Math.max(0, totalBrutHT - doc.total_ht)
  const displayedTotal = doc.total_ttc + timbre

  const dateFormatted = new Date(doc.created_at).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
  const docLabel = DOC_LABELS[doc.type_document] || doc.type_document
  const amountWords = amountToWordsDT(displayedTotal)
  const statutLabel = STATUT_PAYMENT_LABELS[doc.statut_paiement] || doc.statut_paiement

  const density: 'normal' | 'compact' | 'dense' | 'ultra' =
    lignes.length >= 12 ? 'ultra'
      : lignes.length >= 8 ? 'dense'
        : lignes.length >= 5 ? 'compact'
          : 'normal'
  const isCompact = density !== 'normal'
  const isDense = density === 'dense' || density === 'ultra'
  const isUltra = density === 'ultra'

  // Shared style helpers
  const lbl: React.CSSProperties = {
    fontSize: isUltra ? '7px' : isDense ? '8px' : isCompact ? '9px' : '10px', fontWeight: '600', textTransform: 'uppercase',
    letterSpacing: '0.07em', color: '#9ca3af', marginBottom: isUltra ? '1px' : isDense ? '2px' : isCompact ? '3px' : '5px',
  }
  const sec: React.CSSProperties = {
    background: '#f9f9f8', borderRadius: isUltra ? '6px' : isDense ? '8px' : '12px',
    padding: isUltra ? '4px 8px' : isDense ? '6px 10px' : isCompact ? '8px 12px' : '14px 16px',
  }
  const tag: React.CSSProperties = {
    background: '#FEF3C7', color: '#92400E', fontSize: '10px', fontWeight: '600',
    letterSpacing: '0.05em', padding: isCompact ? '1px 6px' : '3px 9px', borderRadius: '999px',
    textTransform: 'uppercase', display: 'inline-block',
  }
  const recapRow: React.CSSProperties = {
    display: 'flex', justifyContent: 'space-between', padding: isCompact ? '3px 0' : '5px 0',
    borderBottom: '0.5px solid #f0f0ee',
  }

  return (
    <div
      ref={ref}
      style={{ fontFamily: "'Inter', system-ui, -apple-system, sans-serif", color: '#111', background: isUltra ? '#fff' : '#f4f4f2', padding: isUltra ? '0' : isDense ? '4px' : isCompact ? '10px' : '24px' }}
    >
      <div style={{ background: '#fff', border: '0.5px solid #e5e5e3', borderRadius: isUltra ? '8px' : '20px', overflow: 'hidden', maxWidth: isUltra ? '100%' : '680px', margin: '0 auto' }}>

        {/* ── Header ───────────────────────────────── */}
        <div style={{ padding: isUltra ? '6px 10px 4px' : isDense ? '10px 16px 8px' : isCompact ? '16px 24px 12px' : '28px 32px 24px', background: headerBg, borderBottom: `2px solid ${primary}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: isUltra ? '8px' : '14px' }}>
            {companyLogo ? (
              <img
                src={companyLogo}
                alt={companyName}
                style={{ width: isUltra ? '32px' : '48px', height: isUltra ? '32px' : '48px', objectFit: 'contain', borderRadius: '10px' }}
              />
            ) : (
              <div style={{
                width: isUltra ? '28px' : '42px', height: isUltra ? '28px' : '42px', background: primary, borderRadius: isUltra ? '8px' : '12px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, fontSize: isUltra ? '14px' : '22px', fontWeight: '700', color: '#fff',
              }}>
                {companyInitial}
              </div>
            )}
            <div>
              <div style={{ fontSize: isUltra ? '11px' : '15px', fontWeight: '600', color: '#111' }}>{companyName}</div>
              {companySubtitle && !isUltra && (
                <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px', letterSpacing: '0.02em' }}>{companySubtitle}</div>
              )}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: isUltra ? '14px' : '22px', fontWeight: '600', color: '#111', letterSpacing: '-0.5px' }}>{docLabel}</div>
            <div style={{ fontSize: isUltra ? '9px' : '11px', color: '#9ca3af', marginTop: '3px', fontWeight: '500' }}>{doc.numero}</div>
          </div>
        </div>

        {/* ── Body ─────────────────────────────────── */}
        <div style={{ padding: isUltra ? '4px 8px' : isDense ? '8px 14px' : isCompact ? '12px 20px' : '24px 32px' }}>

          {/* Emetteur / Client */}
          <div style={{ display: 'grid', gridTemplateColumns: isUltra ? '1fr 1fr' : '1fr 1fr', gap: isUltra ? '4px' : isDense ? '6px' : '10px', marginBottom: isUltra ? '4px' : isDense ? '6px' : isCompact ? '10px' : '20px' }}>
            <div style={sec}>
              <div style={lbl}>Émetteur</div>
              <div style={{ fontSize: isUltra ? '8px' : '13px', fontWeight: '500', color: '#111', marginBottom: isUltra ? '1px' : '4px' }}>{companyName}</div>
              <div style={{ fontSize: isUltra ? '7px' : '12px', color: '#6b7280', lineHeight: isUltra ? '1.3' : '1.7' }}>
                {!isUltra && companyAddress}
                {(companyMatricule || companyPhone) && (isUltra ? ' · ' : <br />)}
                {companyMatricule && <>MF: {companyMatricule}</>}
                {companyMatricule && companyPhone && !isUltra && <>&nbsp;·&nbsp;</>}
                {companyPhone && <>Tél: {companyPhone}</>}
              </div>
            </div>
            <div style={sec}>
              <div style={lbl}>Client</div>
              {doc.client_nom ? (
                <>
                  <div style={{ fontSize: isUltra ? '8px' : '13px', fontWeight: '500', color: '#111', marginBottom: isUltra ? '1px' : '4px' }}>{doc.client_nom}</div>
                  <div style={{ fontSize: isUltra ? '7px' : '12px', color: '#6b7280', lineHeight: isUltra ? '1.3' : '1.7' }}>
                    {doc.client_adresse && (isUltra ? `${doc.client_adresse} · ` : <>{doc.client_adresse}<br /></>)}
                    {doc.client_tel && <>{doc.client_tel}</>}
                    {doc.client_matricule && (isUltra ? ` · MF: ${doc.client_matricule}` : <><br />MF: {doc.client_matricule}</>)}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: isUltra ? '7px' : '12px', color: '#9ca3af', fontStyle: 'italic' }}>Client non spécifié</div>
              )}
            </div>
          </div>

          {/* Date / Échéance / Règlement */}
          <div style={{ display: 'flex', gap: isUltra ? '4px' : '10px', marginBottom: isUltra ? '4px' : isCompact ? '10px' : '24px' }}>
            <div style={{ ...sec, flex: 1 }}>
              <div style={lbl}>Date</div>
              <div style={{ fontSize: isUltra ? '8px' : '13px', fontWeight: '500', color: '#111' }}>{dateFormatted}</div>
            </div>
            {doc.date_echeance && (
              <div style={{ ...sec, flex: 1 }}>
                <div style={lbl}>Échéance</div>
                <div style={{ fontSize: '13px', fontWeight: '500', color: '#111' }}>
                  {new Date(doc.date_echeance).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                </div>
              </div>
            )}
            <div style={{ flex: 1, background: '#FFFBEB', border: '0.5px solid #FDE68A', borderRadius: isUltra ? '6px' : '12px', padding: isUltra ? '4px 6px' : isCompact ? '8px 12px' : '14px 16px' }}>
              <div style={{ ...lbl, color: '#D97706' }}>Règlement</div>
              <div style={{ fontSize: isUltra ? '8px' : '13px', fontWeight: '500', color: '#92400E' }}>{statutLabel}</div>
            </div>
          </div>

          {/* Items table */}
          <div style={{ border: '0.5px solid #e5e5e3', borderRadius: isUltra ? '6px' : '14px', overflow: 'hidden', marginBottom: isUltra ? '4px' : isCompact ? '10px' : '20px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: isUltra ? '7px' : isDense ? '8px' : isCompact ? '11px' : '12px', tableLayout: 'fixed' }}>
              <thead>
                <tr style={{ background: '#f9f9f8' }}>
                  <th style={{ padding: isUltra ? '2px 4px' : isCompact ? '6px 12px' : '10px 14px', textAlign: 'left', fontWeight: '600', fontSize: isUltra ? '7px' : '10px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#9ca3af', width: showTva ? '42%' : '52%' }}>Désignation</th>
                  <th style={{ padding: isUltra ? '2px 3px' : isCompact ? '6px 6px' : '10px 8px', textAlign: 'center', fontWeight: '600', fontSize: isUltra ? '7px' : '10px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#9ca3af', width: '7%' }}>Qté</th>
                  <th style={{ padding: isUltra ? '2px 3px' : isCompact ? '6px 6px' : '10px 8px', textAlign: 'right', fontWeight: '600', fontSize: isUltra ? '7px' : '10px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#9ca3af', width: '14%' }}>PU HT</th>
                  {showTva && (
                    <th style={{ padding: isUltra ? '2px 3px' : isCompact ? '6px 6px' : '10px 8px', textAlign: 'center', fontWeight: '600', fontSize: isUltra ? '7px' : '10px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#9ca3af', width: '9%' }}>TVA</th>
                  )}
                  <th style={{ padding: isUltra ? '2px 3px' : isCompact ? '6px 6px' : '10px 8px', textAlign: 'right', fontWeight: '600', fontSize: isUltra ? '7px' : '10px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#9ca3af', width: '14%' }}>HT</th>
                  <th style={{ padding: isUltra ? '2px 4px' : isCompact ? '6px 12px' : '10px 14px', textAlign: 'right', fontWeight: '600', fontSize: isUltra ? '7px' : '10px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#9ca3af', width: '14%' }}>TTC</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map(l => (
                  <tr key={l.id} style={{ borderTop: '0.5px solid #e5e5e3' }}>
                    <td style={{ padding: isUltra ? '2px 4px' : isDense ? '4px 8px' : isCompact ? '6px 12px' : '13px 14px', color: '#111', fontWeight: '500', fontSize: isUltra ? '7px' : isDense ? '8px' : isCompact ? '11px' : '12px', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: isUltra ? '1.15' : undefined, maxHeight: isUltra ? '2.2em' : isDense ? '2.4em' : undefined }}>
                      {l.designation}
                      {l.remise_pct > 0 && !isUltra && (
                        <span style={{ fontSize: '10px', color: '#9ca3af', marginLeft: '6px' }}>(-{l.remise_pct}%)</span>
                      )}
                    </td>
                    <td style={{ padding: isUltra ? '2px 3px' : isCompact ? '6px 6px' : '13px 8px', textAlign: 'center', color: '#111', fontSize: isUltra ? '7px' : undefined }}>{l.quantite}</td>
                    <td style={{ padding: isUltra ? '2px 3px' : isCompact ? '6px 6px' : '13px 8px', textAlign: 'right', color: '#6b7280', fontSize: isUltra ? '7px' : undefined }}>{l.prix_unitaire.toFixed(3)}</td>
                    {showTva && (
                      <td style={{ padding: isCompact ? '6px 6px' : '13px 8px', textAlign: 'center' }}>
                        <span style={tag}>{l.tva_taux}%</span>
                      </td>
                    )}
                    <td style={{ padding: isCompact ? '6px 6px' : '13px 8px', textAlign: 'right', color: '#6b7280' }}>{l.total_ht.toFixed(3)}</td>
                    <td style={{ padding: isCompact ? '6px 12px' : '13px 14px', textAlign: 'right', fontWeight: '600', color: '#111' }}>{l.total_ttc.toFixed(3)}</td>
                  </tr>
                ))}
                {lignes.length === 0 && (
                  <tr style={{ borderTop: '0.5px solid #e5e5e3' }}>
                    <td colSpan={showTva ? 6 : 5} style={{ padding: '20px', textAlign: 'center', color: '#9ca3af', fontSize: '12px' }}>
                      Aucune ligne
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* TVA detail + Récapitulatif side by side */}
          <div style={{ display: 'grid', gridTemplateColumns: showTva && !isUltra ? '1fr 1fr' : '1fr', gap: isUltra ? '4px' : '10px', marginBottom: isUltra ? '4px' : isCompact ? '10px' : '20px' }}>

            {/* TVA detail */}
            {showTva && !isUltra && (
              <div style={{ border: '0.5px solid #e5e5e3', borderRadius: '14px', overflow: 'hidden' }}>
                <div style={{ padding: '10px 14px', background: '#f9f9f8', fontSize: '10px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.07em', color: '#9ca3af' }}>
                  Détail TVA
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ borderTop: '0.5px solid #e5e5e3' }}>
                      <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: '500', color: '#9ca3af', fontSize: '11px' }}>Taux</th>
                      <th style={{ padding: '8px 8px', textAlign: 'right', fontWeight: '500', color: '#9ca3af', fontSize: '11px' }}>Base</th>
                      <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: '500', color: '#9ca3af', fontSize: '11px' }}>Montant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tvaRows.length === 0 ? (
                      <tr style={{ borderTop: '0.5px solid #e5e5e3' }}>
                        <td style={{ padding: '8px 14px' }}><span style={tag}>0%</span></td>
                        <td style={{ padding: '8px 8px', textAlign: 'right', color: '#6b7280' }}>0.000</td>
                        <td style={{ padding: '8px 14px', textAlign: 'right', color: '#6b7280' }}>0.000</td>
                      </tr>
                    ) : tvaRows.map(([taux, { base, montant }]) => (
                      <tr key={taux} style={{ borderTop: '0.5px solid #e5e5e3' }}>
                        <td style={{ padding: '8px 14px' }}><span style={tag}>{taux}%</span></td>
                        <td style={{ padding: '8px 8px', textAlign: 'right', color: '#6b7280' }}>{base.toFixed(3)}</td>
                        <td style={{ padding: '8px 14px', textAlign: 'right', color: '#6b7280' }}>{montant.toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Récapitulatif */}
            <div style={{ border: '0.5px solid #e5e5e3', borderRadius: '14px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '10px 14px', background: '#f9f9f8', fontSize: '10px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.07em', color: '#9ca3af' }}>
                Récapitulatif
              </div>
              <div style={{ padding: '10px 14px', flex: 1 }}>
                <div style={recapRow}>
                  <span style={{ fontSize: '12px', color: '#6b7280' }}>Total brut HT</span>
                  <span style={{ fontSize: '12px', color: '#111' }}>{totalBrutHT.toFixed(3)}</span>
                </div>
                {totalRemises > 0.0005 && (
                  <div style={recapRow}>
                    <span style={{ fontSize: '12px', color: '#6b7280' }}>Remises</span>
                    <span style={{ fontSize: '12px', color: '#111' }}>− {totalRemises.toFixed(3)}</span>
                  </div>
                )}
                {showTva && (
                  <div style={recapRow}>
                    <span style={{ fontSize: '12px', color: '#6b7280' }}>TVA</span>
                    <span style={{ fontSize: '12px', color: '#111' }}>{doc.total_tva.toFixed(3)}</span>
                  </div>
                )}
                {showTimbre && (
                  <div style={{ ...recapRow, borderBottom: 'none' }}>
                    <span style={{ fontSize: '12px', color: '#6b7280' }}>Timbre fiscal</span>
                    <span style={{ fontSize: '12px', color: '#111' }}>1.000</span>
                  </div>
                )}
              </div>
              <div style={{ background: primary, padding: isCompact ? '8px 14px' : '13px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', fontWeight: '600', color: '#fff' }}>Total net TTC</span>
                <span style={{ fontSize: isCompact ? '18px' : '20px', fontWeight: '600', color: '#fff', letterSpacing: '-0.5px' }}>{displayedTotal.toFixed(3)}</span>
              </div>
            </div>
          </div>

          {/* Arrêté à — hidden on ultra to save space */}
          {!isUltra && (
          <div style={{ background: '#FFFBEB', border: '0.5px solid #FDE68A', borderRadius: '12px', padding: isCompact ? '8px 12px' : '13px 16px', marginBottom: isCompact ? '10px' : '20px' }}>
            <div style={{ ...lbl, color: '#D97706' }}>Arrêté à</div>
            <div style={{ fontSize: isCompact ? '12px' : '13px', fontWeight: '500', color: '#92400E', fontStyle: 'italic' }}>{amountWords}</div>
          </div>
          )}

          {/* Signature boxes */}
          <div style={{ display: 'flex', gap: isUltra ? '0.5rem' : isDense ? '1rem' : isCompact ? '1rem' : '2rem', marginTop: isUltra ? '0.25rem' : isDense ? '0.5rem' : isCompact ? '1rem' : '2rem', marginBottom: isUltra ? '0.25rem' : isCompact ? '1rem' : '1.5rem' }}>
            <div style={{ flex: 1, border: '1px solid #e5e5e3', borderRadius: '8px', padding: isUltra ? '0.2rem' : isDense ? '0.35rem' : isCompact ? '0.5rem' : '1rem', minHeight: isUltra ? '28px' : isDense ? '50px' : isCompact ? '70px' : '120px' }}>
              <p style={{ fontWeight: '600', marginBottom: '0.25rem', fontSize: isUltra ? '7px' : '11px', color: '#6b7280' }}>
                {isUltra ? 'Cachet' : 'Signature & Cachet (Fournisseur / Émetteur)'}
              </p>
              <div style={{ height: isUltra ? '16px' : isDense ? '28px' : isCompact ? '40px' : '80px' }} />
            </div>
            <div style={{ flex: 1, border: '1px solid #e5e5e3', borderRadius: '8px', padding: isUltra ? '0.2rem' : isDense ? '0.35rem' : isCompact ? '0.5rem' : '1rem', minHeight: isUltra ? '28px' : isDense ? '50px' : isCompact ? '70px' : '120px' }}>
              <p style={{ fontWeight: '600', marginBottom: '0.25rem', fontSize: isUltra ? '7px' : '11px', color: '#6b7280' }}>
                Signature Client
              </p>
              <div style={{ height: isUltra ? '16px' : isDense ? '28px' : isCompact ? '40px' : '80px' }} />
            </div>
          </div>

          {/* Footer: RIB + Cachet */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '12px', borderTop: '0.5px solid #e5e5e3' }}>
            <div style={{ fontSize: '11px', color: '#9ca3af' }}>
              {companyRib
                ? <><strong style={{ color: '#6b7280' }}>Coordonnées Bancaires :</strong> {boutiqueBank ? `${boutiqueBank} — ` : ''}RIB : {companyRib}</>
                : footer}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ fontSize: '14px', color: primary }}>✓</span>
              <span style={{ fontSize: '11px', fontWeight: '500', color: '#9ca3af' }}>Cachet &amp; Signature</span>
            </div>
          </div>
          {companyRib && footer && (
            <div style={{ marginTop: '5px', textAlign: 'center', fontSize: '11px', color: '#9ca3af' }}>{footer}</div>
          )}

        </div>
      </div>
    </div>
  )
})

InvoicePrintTemplate.displayName = 'InvoicePrintTemplate'

export default InvoicePrintTemplate

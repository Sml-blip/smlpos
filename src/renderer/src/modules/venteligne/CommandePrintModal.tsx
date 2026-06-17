import { useEffect, useState } from 'react'
import { usePrint } from '../../lib/usePrint'
import { Printer, X } from 'lucide-react'

const api = window.api

interface CommandeLigne {
  id: string; numero: string; client_nom: string; client_tel?: string
  client_adresse?: string; produits_json: string; montant_ttc: number
  frais_livraison: number; frais_retour: number
  statut: 'EN_ATTENTE' | 'CONFIRME' | 'LIVRE' | 'RETOUR'
  livraison_nom?: string; montant_recu: number; note?: string
  operateur_nom?: string; created_at: string
}
interface LigneProduit { designation: string; quantite: number; prix_unitaire: number }

const STATUT_FR: Record<string, string> = {
  EN_ATTENTE: 'En attente', CONFIRME: 'Confirmé', LIVRE: 'Livré', RETOUR: 'Retour',
}

interface Props {
  commande: CommandeLigne
  onClose: () => void
}

export default function CommandePrintModal({ commande, onClose }: Props) {
  const { printRef, handlePrint } = usePrint(`Commande-${commande.numero}`)
  const [settings, setSettings] = useState<Record<string, string>>({})

  useEffect(() => {
    api.settingsGetAll().then(s => setSettings(s as Record<string, string>))
  }, [])

  const lignes = JSON.parse(commande.produits_json) as LigneProduit[]
  const sousTotal = lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire, 0)
  const date = new Date(commande.created_at)
  const dateStr = date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const timeStr = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

  const companyName = settings['entreprise.nom'] || 'SML Store'
  const companyAddress = settings['entreprise.adresse'] || ''
  const companyPhone = settings['entreprise.telephone'] || ''
  const companyEmail = settings['entreprise.email'] || ''
  const footerText = settings['facture.footer_text'] || 'Merci pour votre confiance.'

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl animate-slide-in flex flex-col max-h-[95vh]">
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border flex-shrink-0">
          <h2 className="font-bold text-sm flex items-center gap-2">
            <Printer size={15} /> Impression commande — {commande.numero}
          </h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        {/* Scrollable preview */}
        <div className="flex-1 overflow-y-auto p-5 bg-gray-100">
          {/* A5 landscape preview — 210mm × 148mm */}
          <div
            ref={printRef}
            style={{
              width: '210mm',
              minHeight: '148mm',
              margin: '0 auto',
              background: 'white',
              fontFamily: 'Arial, Helvetica, sans-serif',
              fontSize: '10pt',
              color: '#1A1A1A',
              padding: '10mm',
              boxSizing: 'border-box',
              position: 'relative',
            }}
          >
            {/* @page rule for print */}
            <style>{`
              @media print {
                @page { size: A5 landscape; margin: 0; }
                body { margin: 0; }
              }
            `}</style>

            {/* ── Header ── */}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '6mm' }}>
              <tbody>
                <tr>
                  {/* Company info */}
                  <td style={{ verticalAlign: 'top', width: '55%' }}>
                    <div style={{ fontWeight: '800', fontSize: '14pt', letterSpacing: '0.5px', marginBottom: '2mm' }}>
                      {companyName}
                    </div>
                    {companyAddress && <div style={{ fontSize: '8.5pt', color: '#555', lineHeight: '1.4' }}>{companyAddress}</div>}
                    {companyPhone && <div style={{ fontSize: '8.5pt', color: '#555' }}>Tél: {companyPhone}</div>}
                    {companyEmail && <div style={{ fontSize: '8.5pt', color: '#555' }}>{companyEmail}</div>}
                  </td>
                  {/* Order info */}
                  <td style={{ verticalAlign: 'top', textAlign: 'right', width: '45%' }}>
                    <div style={{ fontWeight: '700', fontSize: '12pt', marginBottom: '1mm' }}>BON DE COMMANDE</div>
                    <div style={{ fontSize: '9pt', color: '#444', marginBottom: '1mm' }}>N° <strong>{commande.numero}</strong></div>
                    <div style={{ fontSize: '8.5pt', color: '#666' }}>{dateStr} à {timeStr}</div>
                    {commande.operateur_nom && <div style={{ fontSize: '8.5pt', color: '#666' }}>Traité par: {commande.operateur_nom}</div>}
                    {/* Status badge */}
                    <div style={{
                      display: 'inline-block',
                      marginTop: '2mm',
                      padding: '1.5mm 4mm',
                      borderRadius: '4px',
                      fontSize: '8pt',
                      fontWeight: '700',
                      backgroundColor:
                        commande.statut === 'CONFIRME' ? '#dcfce7' :
                        commande.statut === 'LIVRE' ? '#ede9fe' :
                        commande.statut === 'RETOUR' ? '#fee2e2' : '#dbeafe',
                      color:
                        commande.statut === 'CONFIRME' ? '#166534' :
                        commande.statut === 'LIVRE' ? '#5b21b6' :
                        commande.statut === 'RETOUR' ? '#991b1b' : '#1e40af',
                      border: '1px solid',
                      borderColor:
                        commande.statut === 'CONFIRME' ? '#bbf7d0' :
                        commande.statut === 'LIVRE' ? '#c4b5fd' :
                        commande.statut === 'RETOUR' ? '#fecaca' : '#bfdbfe',
                    }}>
                      {STATUT_FR[commande.statut]}
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>

            {/* Separator */}
            <div style={{ borderTop: '2px solid #FFD600', marginBottom: '5mm' }} />

            {/* ── Client + Livraison ── */}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '5mm' }}>
              <tbody>
                <tr>
                  <td style={{ width: '55%', verticalAlign: 'top', paddingRight: '5mm' }}>
                    <div style={{ fontSize: '7pt', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#888', marginBottom: '1.5mm' }}>Client</div>
                    <div style={{ fontWeight: '700', fontSize: '11pt' }}>{commande.client_nom}</div>
                    {commande.client_tel && <div style={{ fontSize: '9pt', color: '#444' }}>Tél: {commande.client_tel}</div>}
                    {commande.client_adresse && <div style={{ fontSize: '9pt', color: '#444' }}>{commande.client_adresse}</div>}
                  </td>
                  <td style={{ width: '45%', verticalAlign: 'top', paddingLeft: '5mm', borderLeft: '1px solid #e5e7eb' }}>
                    <div style={{ fontSize: '7pt', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#888', marginBottom: '1.5mm' }}>Livraison</div>
                    {commande.livraison_nom
                      ? <div style={{ fontWeight: '700', fontSize: '10pt' }}>{commande.livraison_nom}</div>
                      : <div style={{ fontSize: '9pt', color: '#aaa' }}>—</div>
                    }
                    {commande.statut === 'LIVRE' && commande.montant_recu > 0 && (
                      <div style={{ fontSize: '8.5pt', color: '#166534', marginTop: '1mm' }}>
                        Montant reçu: <strong>{formatPrice(commande.montant_recu)}</strong>
                      </div>
                    )}
                    {commande.frais_retour > 0 && commande.statut !== 'RETOUR' && (
                      <div style={{ fontSize: '8pt', color: '#888', marginTop: '1mm' }}>
                        Frais retour: {formatPrice(commande.frais_retour)}
                      </div>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>

            {/* ── Products Table ── */}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '3mm' }}>
              <thead>
                <tr style={{ backgroundColor: '#1A1A1A', color: 'white' }}>
                  <th style={{ textAlign: 'left', padding: '2mm 3mm', fontSize: '8pt', fontWeight: '700', width: '50%' }}>Désignation</th>
                  <th style={{ textAlign: 'center', padding: '2mm 3mm', fontSize: '8pt', fontWeight: '700', width: '12%' }}>Qté</th>
                  <th style={{ textAlign: 'right', padding: '2mm 3mm', fontSize: '8pt', fontWeight: '700', width: '18%' }}>Prix unit.</th>
                  <th style={{ textAlign: 'right', padding: '2mm 3mm', fontSize: '8pt', fontWeight: '700', width: '20%' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l, i) => (
                  <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#fafafa' : 'white' }}>
                    <td style={{ padding: '2mm 3mm', fontSize: '9pt', borderBottom: '1px solid #f0f0f0' }}>{l.designation}</td>
                    <td style={{ padding: '2mm 3mm', fontSize: '9pt', textAlign: 'center', borderBottom: '1px solid #f0f0f0' }}>{l.quantite}</td>
                    <td style={{ padding: '2mm 3mm', fontSize: '9pt', textAlign: 'right', fontFamily: 'monospace', borderBottom: '1px solid #f0f0f0' }}>{formatPrice(l.prix_unitaire)}</td>
                    <td style={{ padding: '2mm 3mm', fontSize: '9pt', textAlign: 'right', fontFamily: 'monospace', borderBottom: '1px solid #f0f0f0' }}>{formatPrice(l.quantite * l.prix_unitaire)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* ── Totals ── */}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '4mm' }}>
              <tbody>
                {commande.frais_livraison > 0 && (
                  <tr>
                    <td style={{ textAlign: 'right', padding: '1mm 3mm', fontSize: '9pt', color: '#555' }} colSpan={3}>Sous-total articles</td>
                    <td style={{ textAlign: 'right', padding: '1mm 3mm', fontSize: '9pt', fontFamily: 'monospace', width: '20%' }}>{formatPrice(sousTotal)}</td>
                  </tr>
                )}
                {commande.frais_livraison > 0 && (
                  <tr>
                    <td style={{ textAlign: 'right', padding: '1mm 3mm', fontSize: '9pt', color: '#555' }} colSpan={3}>Frais de livraison</td>
                    <td style={{ textAlign: 'right', padding: '1mm 3mm', fontSize: '9pt', fontFamily: 'monospace', width: '20%' }}>{formatPrice(commande.frais_livraison)}</td>
                  </tr>
                )}
                <tr style={{ backgroundColor: '#FFD600' }}>
                  <td style={{ textAlign: 'right', padding: '2.5mm 3mm', fontWeight: '800', fontSize: '10.5pt' }} colSpan={3}>TOTAL TTC</td>
                  <td style={{ textAlign: 'right', padding: '2.5mm 3mm', fontWeight: '800', fontSize: '10.5pt', fontFamily: 'monospace', width: '20%' }}>{formatPrice(commande.montant_ttc)}</td>
                </tr>
              </tbody>
            </table>

            {/* ── Note ── */}
            {commande.note && (
              <div style={{ fontSize: '8.5pt', color: '#555', borderTop: '1px solid #eee', paddingTop: '2mm', marginBottom: '3mm', fontStyle: 'italic' }}>
                Note: {commande.note}
              </div>
            )}

            {/* ── Footer ── */}
            <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '2mm', textAlign: 'center', fontSize: '7.5pt', color: '#888' }}>
              {footerText}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 px-5 py-4 border-t border-border flex-shrink-0">
          <button onClick={onClose}
            className="flex-1 bg-muted hover:bg-border font-semibold py-2.5 rounded-xl text-sm transition-colors">
            Fermer
          </button>
          <button onClick={() => handlePrint()}
            className="flex-1 bg-accent-500 hover:bg-accent-600 font-bold py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 transition-colors">
            <Printer size={15} /> Imprimer A5 Paysage
          </button>
        </div>
      </div>
    </div>
  )
}

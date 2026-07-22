import { printFullHtmlDocument } from './nativePrint'

const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const money = (value: number) => `${Number(value || 0).toFixed(3)} DT`

type Common = { numero: string; clientNom: string; telephone?: string; adresse?: string; operateur?: string; date: string; note?: string }

async function printReceipt(title: string, common: Common, rows: Array<{ label: string; value: string; strong?: boolean }>) {
  const settings = await window.api.settingsGetAll()
  const company = settings.company_name || settings.nom_entreprise || 'SML POS'
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:A4;margin:16mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#172033;margin:0;font-size:13px}.page{min-height:260mm;border:1px solid #d9e0ea;border-radius:14px;padding:26px}.head{display:flex;justify-content:space-between;border-bottom:3px solid #6750a4;padding-bottom:18px}.brand{font-size:25px;font-weight:800;color:#4f378b}.title{text-align:right;font-size:21px;font-weight:800}.muted{color:#667085;font-size:11px;margin-top:5px}.card{background:#f7f5ff;border:1px solid #ded5ff;border-radius:12px;padding:16px;margin-top:22px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 30px}.label{color:#667085;font-size:11px}.value{font-weight:700;margin-top:3px}.amounts{margin-top:22px;border:1px solid #d9e0ea;border-radius:12px;overflow:hidden}.row{display:flex;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #e6eaf0}.row:last-child{border:0}.row.strong{background:#ecfdf3;color:#067647;font-size:17px;font-weight:800}.note{margin-top:20px;padding:14px;border-left:4px solid #6750a4;background:#faf9ff}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:70px;margin-top:65px;text-align:center}.line{border-top:1px solid #98a2b3;padding-top:8px;color:#667085}.footer{text-align:center;color:#98a2b3;font-size:10px;margin-top:55px}</style></head><body><div class="page">
    <div class="head"><div><div class="brand">${esc(company)}</div><div class="muted">${esc(settings.company_address || settings.adresse_entreprise || '')}<br>${esc(settings.company_phone || settings.telephone_entreprise || '')}</div></div><div><div class="title">${esc(title)}</div><div class="muted">N° ${esc(common.numero)}<br>${esc(new Date(common.date).toLocaleString('fr-TN'))}</div></div></div>
    <div class="card"><div class="grid"><div><div class="label">Client</div><div class="value">${esc(common.clientNom)}</div></div><div><div class="label">Téléphone</div><div class="value">${esc(common.telephone || '—')}</div></div><div><div class="label">Adresse</div><div class="value">${esc(common.adresse || '—')}</div></div><div><div class="label">Reçu par</div><div class="value">${esc(common.operateur || '—')}</div></div></div></div>
    <div class="amounts">${rows.map(r => `<div class="row${r.strong ? ' strong' : ''}"><span>${esc(r.label)}</span><span>${esc(r.value)}</span></div>`).join('')}</div>
    ${common.note ? `<div class="note"><div class="label">Note</div>${esc(common.note)}</div>` : ''}
    <div class="signatures"><div class="line">Signature client</div><div class="line">Cachet et signature</div></div><div class="footer">Document généré par ${esc(company)} — Conservez ce reçu comme justificatif de paiement.</div>
  </div></body></html>`
  return printFullHtmlDocument(html, { pageSize: 'A4', settingsKey: 'impression_printer_a4', printKind: 'document' })
}

export const printAdvanceReceipt = (d: Common & { produit: string; montant: number; modePaiement: string; reference?: string }) => printReceipt('REÇU D’AVANCE CLIENT', d, [
  { label: 'Produit / commande', value: d.produit },
  { label: 'Mode de paiement', value: d.modePaiement },
  { label: 'Référence', value: d.reference || '—' },
  { label: 'Montant de l’avance', value: money(d.montant), strong: true },
])

export const printCreditReceipt = (d: Common & { before: number; paid: number; after: number; organisation?: string }) => printReceipt('REÇU DE PAIEMENT CRÉDIT', d, [
  { label: 'Organisation', value: d.organisation || 'Client particulier' },
  { label: 'Crédit avant paiement', value: money(d.before) },
  { label: 'Montant payé', value: money(d.paid) },
  { label: 'Crédit restant après paiement', value: money(d.after), strong: true },
])

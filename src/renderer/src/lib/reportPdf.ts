import { formatPrice, formatDate } from './utils'

export interface ReportRow {
  date?: string
  type?: string
  amount?: number
  operator?: string
  note?: string
}

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c))
}

export function buildBalanceReport(title: string, subject: string, summary: Array<[string, string]>, rows: ReportRow[]): string {
  const body = rows.map(row => `<tr><td>${esc(row.date ? formatDate(row.date) : '')}</td><td>${esc(row.type)}</td><td class="amount">${esc(formatPrice(row.amount ?? 0))} DT</td><td>${esc(row.operator)}</td><td>${esc(row.note)}</td></tr>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:A4;margin:16mm}body{font-family:Arial,sans-serif;color:#18212f;font-size:11px}h1{font-size:22px;margin:0 0 3px}h2{font-size:14px;margin:0 0 16px;color:#64748b}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:16px 0 20px}.box{border:1px solid #dbe2ea;border-radius:8px;padding:10px}.label{color:#64748b;font-size:10px}.value{font-size:15px;font-weight:700;margin-top:4px}table{width:100%;border-collapse:collapse}th{background:#f1f5f9;text-align:left;font-size:10px}th,td{padding:7px;border-bottom:1px solid #e2e8f0}.amount{text-align:right;font-weight:700}footer{margin-top:20px;color:#64748b;font-size:9px}
  </style></head><body><h1>${esc(title)}</h1><h2>${esc(subject)}</h2><div class="summary">${summary.map(([label, value]) => `<div class="box"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div></div>`).join('')}</div><table><thead><tr><th>Date</th><th>Type</th><th>Montant</th><th>Opérateur</th><th>Note</th></tr></thead><tbody>${body}</tbody></table><footer>Rapport généré le ${esc(new Date().toLocaleString('fr-TN'))}</footer></body></html>`
}

export async function saveBalanceReport(title: string, subject: string, summary: Array<[string, string]>, rows: ReportRow[], filename: string): Promise<boolean> {
  const result = await window.api.reportsSavePdf(buildBalanceReport(title, subject, summary, rows), filename)
  return result?.success === true
}

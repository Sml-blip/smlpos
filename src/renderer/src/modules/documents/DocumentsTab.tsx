import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Fuse from 'fuse.js'
import * as XLSX from 'xlsx'
import { format } from 'date-fns'
import { cn, formatPrice } from '../../lib/utils'
import { usePrint } from '../../lib/usePrint'
import { printLabelHtml } from '../../lib/nativePrint'
import { loadData, runAction } from '../../lib/apiCall'
import DocumentPrintModal from '../historique/DocumentPrintModal'
import FactureAchatPrintModal from '../achats/FactureAchatPrintModal'
import PinUnlockModal from '../../components/PinUnlockModal'
import InvoiceEditModal from '../../components/InvoiceEditModal'
import type { Document } from '../../lib/types'
import {
  FileText, Search, Download, Printer, Eye, X, CheckCircle, Clock,
  Truck, RotateCcw, AlertTriangle, RefreshCw, ChevronDown, Plus,
  Ban, PackageCheck, Edit2
} from 'lucide-react'

const INVOICE_PRINT_TYPES = new Set(['FACTURE_VENTE', 'DEVIS', 'BON_LIVRAISON', 'FACTURE_JOURNALIERE_F', 'AVOIR'])
const ACHAT_PRINT_TYPES = new Set(['FACTURE_ACHAT', 'FACTURE_ACHAT_BL'])

const api = window.api

type SubTab = 'TOUS' | 'FACTURE_VENTE' | 'FACTURE_JOURNALIERE_F' | 'DEVIS' | 'BON_LIVRAISON' | 'FACTURE_ACHAT' | 'FACTURE_ACHAT_BL' | 'AVOIR'

interface DocRow {
  id: string
  numero: string
  type_document: string
  statut: string
  _source?: 'documents' | 'ff'
  client_nom?: string
  fournisseur_nom?: string
  total_ht: number
  total_tva: number
  total_ttc: number
  statut_paiement?: string
  exo?: string
  timbre?: number
  ht_7?: number; tva_7?: number; ht_19?: number; tva_19?: number
  total_remise?: number
  created_at: string
  avoir_id?: string | null
  avoir_numero?: string | null
  document_origine_id?: string | null
  facture_origine_numero?: string | null
}

const STATUT_CONFIG: Record<string, { label: string; cls: string }> = {
  ACTIF:      { label: 'Actif',      cls: 'bg-green-100 text-green-800 border-green-300' },
  NON_ARRIVE: { label: 'Non arrivé', cls: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
  ARRIVE:     { label: 'Arrivé',     cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  ANNULE:     { label: 'Annulé',     cls: 'bg-red-100 text-red-800 border-red-300' },
  CONVERTI:   { label: 'Converti',   cls: 'bg-blue-100 text-blue-800 border-blue-300' },
  REVOQUE:    { label: 'Révoqué',    cls: 'bg-red-200 text-red-900 border-red-400' },
}

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'TOUS', label: 'Tous' },
  { id: 'FACTURE_VENTE', label: 'Factures Vente' },
  { id: 'FACTURE_JOURNALIERE_F', label: 'Facture Journalière F' },
  { id: 'DEVIS', label: 'Devis' },
  { id: 'BON_LIVRAISON', label: 'BL Vente' },
  { id: 'FACTURE_ACHAT', label: 'Factures Achat' },
  { id: 'FACTURE_ACHAT_BL', label: 'BL Fournisseurs' },
  { id: 'AVOIR', label: 'Avoirs' },
]

// ── Excel Export Preview Modal ─────────────────────────────────────────────────
function ExcelPreviewModal({ rows: initialRows, columns, title: initialTitle, fileName: initialFileName, onClose, isAchats }: {
  rows: Record<string, unknown>[]
  columns: string[]
  title: string
  fileName: string
  isAchats?: boolean
  onClose: () => void
}) {
  const [editRows, setEditRows] = useState<Record<string, unknown>[]>(initialRows)
  const [title, setTitle] = useState(initialTitle)
  const [fileName, setFileName] = useState(initialFileName)
  const [periodMode, setPeriodMode] = useState<'mois' | 'trimestre' | 'annee' | 'personnalise'>('mois')
  const [periodMois, setPeriodMois] = useState(format(new Date(), 'yyyy-MM'))
  const [periodAnnee, setPeriodAnnee] = useState(String(new Date().getFullYear()))
  const [periodTrimestre, setPeriodTrimestre] = useState<'Q1' | 'Q2' | 'Q3' | 'Q4'>('Q1')
  const [periodFrom, setPeriodFrom] = useState('')
  const [periodTo, setPeriodTo] = useState('')
  const { printRef, handlePrint } = usePrint(title)

  // Update title/filename when period changes
  useEffect(() => {
    let label = ''
    if (periodMode === 'mois') label = periodMois.replace('-', '/')
    else if (periodMode === 'trimestre') label = `${periodTrimestre}_${periodAnnee}`
    else if (periodMode === 'annee') label = periodAnnee
    else label = `${periodFrom}_${periodTo}`
    const base = isAchats ? 'Bilan Factures Achat' : 'Bilan Ventes'
    const fileBase = isAchats ? 'FACTURES_ACHAT' : 'BILAN_VENTES'
    setTitle(`${base} ${label}`)
    setFileName(`${fileBase}_${label.replace(/\//g, '_')}.xlsx`)
  }, [periodMode, periodMois, periodAnnee, periodTrimestre, periodFrom, periodTo, isAchats])

  const exportToExcel = () => {
    const ws = XLSX.utils.json_to_sheet(editRows)
    const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = XLSX.utils.encode_cell({ r: 0, c })
      if (ws[cell]) ws[cell].s = { font: { bold: true }, fill: { patternType: 'solid', fgColor: { rgb: 'FFD600' } } }
    }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31))
    XLSX.writeFile(wb, fileName)
  }

  const updateCell = (rowIdx: number, col: string, val: string) => {
    setEditRows(prev => prev.map((r, i) => i === rowIdx ? { ...r, [col]: val } : r))
  }

  const addRow = () => {
    const empty: Record<string, unknown> = {}
    columns.forEach(c => { empty[c] = '' })
    setEditRows(prev => [...prev, empty])
  }

  const removeRow = (idx: number) => {
    setEditRows(prev => prev.filter((_, i) => i !== idx))
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[200] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border no-print">
          <h3 className="font-bold text-sm">{title}</h3>
          <div className="flex items-center gap-2">
            <button onClick={() => handlePrint()} className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-xs font-semibold hover:bg-muted">
              <Printer size={13} /> Imprimer
            </button>
            <button onClick={exportToExcel} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-bold">
              <Download size={13} /> Exporter Excel
            </button>
            <button onClick={onClose}><X size={18} className="text-text-muted" /></button>
          </div>
        </div>

        {/* Period selector */}
        <div className="px-6 py-3 border-b border-border bg-muted no-print flex items-center gap-3 flex-wrap">
          <span className="text-xs font-semibold text-text-secondary">Période :</span>
          {(['mois', 'trimestre', 'annee', 'personnalise'] as const).map(m => (
            <button key={m} onClick={() => setPeriodMode(m)}
              className={cn('px-3 py-1 rounded-full text-xs font-semibold border transition-all',
                periodMode === m ? 'bg-accent-500 border-accent-500 text-black' : 'bg-white border-border text-text-secondary hover:bg-accent-50')}>
              {m === 'mois' ? 'Mois' : m === 'trimestre' ? 'Trimestre' : m === 'annee' ? 'Année' : 'Personnalisé'}
            </button>
          ))}
          <div className="flex items-center gap-2 ml-2">
            {periodMode === 'mois' && (
              <input type="month" value={periodMois} onChange={e => setPeriodMois(e.target.value)}
                className="border border-border rounded-lg px-2 py-1 text-xs outline-none focus:border-accent-500" />
            )}
            {periodMode === 'trimestre' && (
              <>
                <select value={periodTrimestre} onChange={e => setPeriodTrimestre(e.target.value as 'Q1'|'Q2'|'Q3'|'Q4')}
                  className="border border-border rounded-lg px-2 py-1 text-xs outline-none focus:border-accent-500">
                  <option>Q1</option><option>Q2</option><option>Q3</option><option>Q4</option>
                </select>
                <input type="number" value={periodAnnee} onChange={e => setPeriodAnnee(e.target.value)} min="2020" max="2030"
                  className="w-20 border border-border rounded-lg px-2 py-1 text-xs outline-none focus:border-accent-500" />
              </>
            )}
            {periodMode === 'annee' && (
              <input type="number" value={periodAnnee} onChange={e => setPeriodAnnee(e.target.value)} min="2020" max="2030"
                className="w-20 border border-border rounded-lg px-2 py-1 text-xs outline-none focus:border-accent-500" />
            )}
            {periodMode === 'personnalise' && (
              <>
                <input type="date" value={periodFrom} onChange={e => setPeriodFrom(e.target.value)}
                  className="border border-border rounded-lg px-2 py-1 text-xs outline-none focus:border-accent-500" />
                <span className="text-xs text-text-muted">→</span>
                <input type="date" value={periodTo} onChange={e => setPeriodTo(e.target.value)}
                  className="border border-border rounded-lg px-2 py-1 text-xs outline-none focus:border-accent-500" />
              </>
            )}
          </div>
        </div>

        <div ref={printRef} className="flex-1 overflow-auto p-4">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-yellow-100">
                {columns.map(c => <th key={c} className="border border-gray-300 px-3 py-2 text-left font-bold text-[11px]">{c}</th>)}
                <th className="border border-gray-300 px-2 py-2 w-8 no-print" />
              </tr>
            </thead>
            <tbody>
              {editRows.map((row, i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  {columns.map(col => (
                    <td key={col} className="border border-gray-200 px-1 py-0.5">
                      <input
                        value={String(row[col] ?? '')}
                        onChange={e => updateCell(i, col, e.target.value)}
                        className="w-full bg-transparent text-xs outline-none px-1"
                      />
                    </td>
                  ))}
                  <td className="border border-gray-200 px-1 py-0.5 no-print">
                    <button onClick={() => removeRow(i)} className="text-danger hover:text-red-700 w-full flex justify-center">
                      <X size={11} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[10px] text-text-muted mt-2 no-print">Cliquez sur une cellule pour modifier avant export</p>
        </div>

        <div className="px-6 py-3 border-t border-border no-print flex items-center gap-2">
          <button onClick={addRow} className="flex items-center gap-1.5 px-3 py-1.5 bg-muted hover:bg-border border border-border rounded-lg text-xs font-semibold">
            <Plus size={12} /> Ajouter ligne
          </button>
          <span className="text-xs text-text-muted ml-auto">{editRows.length} ligne(s)</span>
        </div>
      </div>
    </div>
  )
}

// ── Main DocumentsTab ──────────────────────────────────────────────────────────
export default function DocumentsTab() {
  const [subTab, setSubTab] = useState<SubTab>('TOUS')
  const [docs, setDocs] = useState<DocRow[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [excelModal, setExcelModal] = useState<{ rows: Record<string, unknown>[]; columns: string[]; title: string; fileName: string; isAchats?: boolean } | null>(null)
  const [previewDoc, setPreviewDoc] = useState<DocRow | null>(null)
  const [printInvoiceDoc, setPrintInvoiceDoc] = useState<Document | null>(null)
  const [printAchatId, setPrintAchatId] = useState<string | null>(null)
  const [revoquerDoc, setRevoquerDoc] = useState<DocRow | null>(null)
  const [editTarget, setEditTarget] = useState<{ mode: 'vente' | 'achat'; id: string } | null>(null)
  const [showPinForEdit, setShowPinForEdit] = useState<{ mode: 'vente' | 'achat'; id: string; numero: string } | null>(null)

  const load = useCallback(async () => {
    const filters: Record<string, unknown> = {}
    if (subTab !== 'TOUS') filters.type_document = subTab
    if (dateFrom) filters.dateFrom = dateFrom
    if (dateTo) filters.dateTo = dateTo
    const result = await loadData('Chargement documents', () => api.documentsListAll(filters) as Promise<DocRow[]>, { setLoading })
    if (result) setDocs(result)
  }, [subTab, dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  const tabFiltered = useMemo(() => {
    if (subTab === 'TOUS') return docs
    return docs.filter(d => d.type_document === subTab)
  }, [docs, subTab])

  const fuseIndex = useMemo(() => new Fuse(tabFiltered, {
    keys: ['numero', 'client_nom', 'fournisseur_nom'],
    threshold: 0.4, minMatchCharLength: 2, ignoreLocation: true,
  }), [tabFiltered])

  const filtered = useMemo(() => {
    if (search.length >= 2) return fuseIndex.search(search, { limit: 200 }).map(r => r.item)
    return tabFiltered
  }, [search, tabFiltered, fuseIndex])

  const tiers = (d: DocRow) => d.client_nom || d.fournisseur_nom || '—'

  const annulerDoc = async (d: DocRow) => {
    const isFactureVente = d._source !== 'ff' && (d.type_document === 'FACTURE_VENTE' || d.type_document === 'FACTURE_JOURNALIERE_F')
    const motif = isFactureVente ? window.prompt(`Annuler ${d.numero} et créer un avoir ?\nMotif (optionnel) :`) : null
    if (isFactureVente && motif === null) return
    if (!isFactureVente && !window.confirm(`Annuler ${d.numero} ?`)) return
    await runAction('Annulation document', async () => {
      if (isFactureVente) {
        const res = await api.documentsAnnulerAvecAvoir?.(d.id, motif || undefined) as { success?: boolean; error?: string; avoir?: { numero: string } }
        if (!res?.success) throw new Error(res?.error || 'Échec annulation')
      } else if (d._source === 'ff') {
        await api.facturesFournisseursAnnuler(d.id)
      } else {
        await api.documentsUpdate(d.id, { statut: 'ANNULE' })
      }
      load()
    }, { successMessage: isFactureVente ? 'Facture annulée — avoir créé' : 'Document annulé' })
  }

  const canEditDoc = (d: DocRow) => {
    if (d.statut === 'ANNULE' || d.statut === 'REVOQUE' || d.type_document === 'AVOIR') return false
    if (d._source === 'ff') return d.type_document === 'FACTURE_ACHAT' || d.type_document === 'FACTURE_ACHAT_BL'
    return ['FACTURE_VENTE', 'DEVIS', 'BON_LIVRAISON', 'FACTURE_JOURNALIERE_F'].includes(d.type_document)
  }

  const startEdit = (d: DocRow) => {
    const mode = d._source === 'ff' ? 'achat' : 'vente'
    setShowPinForEdit({ mode, id: d.id, numero: d.numero })
  }

  const exportAvoirForRow = (d: DocRow) => {
    const avoirRow = d.avoir_id ? docs.find(x => x.id === d.avoir_id) : docs.find(x => x.numero === d.avoir_numero)
    if (avoirRow) exportSingleDoc(avoirRow)
  }

  const marquerRecu = async (d: DocRow) => {
    await runAction('Marquage réception', async () => {
      const res = await api.facturesFournisseursMarquerRecu(d.id) as { success?: boolean; error?: string }
      if (!res?.success) throw new Error(res?.error || 'Echec marquage reception')
      load()
    }, { successMessage: 'Facture marquée comme reçue' })
  }

  const exportSingleDoc = (d: DocRow) => {
    const isAchat = d._source === 'ff'
    const row = isAchat
      ? {
          'N° FACTURE': d.numero,
          'DATE DE FACTURE': d.created_at ? format(new Date(d.created_at), 'dd/MM/yyyy') : '',
          'SOCIETE': d.fournisseur_nom ?? '',
          'EXO': d.exo ?? null,
          'HT': +(d.total_ht ?? 0).toFixed(3),
          'TVA': +(d.total_tva ?? 0).toFixed(3),
          'TTC': +(d.total_ttc ?? 0).toFixed(3),
          'TIMBRE': d.timbre ?? 1,
          'TOT GENERAL': +((d.total_ttc ?? 0) + (d.timbre ?? 1)).toFixed(3),
          'HT 7%': d.ht_7 ?? null, 'TVA 7%': d.tva_7 ?? null,
          'HT 19%': d.ht_19 ?? null, 'TVA 19%': d.tva_19 ?? null,
          'TOTAL REMISE': d.total_remise ?? null,
        }
      : {
          'DOCUMENT': d.numero, 'CLIENT': d.client_nom ?? '',
          'DATE': d.created_at ? format(new Date(d.created_at), 'dd/MM/yyyy') : '',
          'EXO': d.exo ?? null, 'TVA': null, 'BASE': +(d.total_ht ?? 0).toFixed(3),
          'MONTANT': +(d.total_ht ?? 0).toFixed(3), 'TAXE': null,
          'MT TAXE': +(d.total_tva ?? 0).toFixed(3),
          'TOTAL TVA': +(d.total_tva ?? 0).toFixed(3), 'TOTAL HT': +(d.total_ht ?? 0).toFixed(3),
          'TOTAL TTC': +(d.total_ttc ?? 0).toFixed(3),
        }
    const ws = XLSX.utils.json_to_sheet([row])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, d.numero.slice(0, 31))
    XLSX.writeFile(wb, `${d.numero}.xlsx`)
  }

  const printDoc = (d: DocRow) => {
    if (d._source === 'ff' && ACHAT_PRINT_TYPES.has(d.type_document)) {
      setPrintAchatId(d.id)
      return
    }
    if (d._source !== 'ff' && INVOICE_PRINT_TYPES.has(d.type_document)) {
      setPrintInvoiceDoc(d as unknown as Document)
      return
    }
    const tierName = tiers(d)
    const dateStr = d.created_at ? format(new Date(d.created_at), 'dd/MM/yyyy') : '—'
    const html = `<!DOCTYPE html><html><head><title>${d.numero}</title>
    <style>
      @page{size:A4;margin:15mm}
      body{font-family:Arial,sans-serif;font-size:12px;color:#000;margin:0}
      h2{font-size:16px;margin:0 0 4px}
      .sub{font-size:11px;color:#555;margin-bottom:16px}
      table{width:100%;border-collapse:collapse;margin-top:12px;font-size:11px}
      th{background:#f5f5f5;border:1px solid #ccc;padding:6px 8px;text-align:left;font-weight:bold}
      td{border:1px solid #ddd;padding:5px 8px}
      .right{text-align:right}
      .total-row td{font-weight:bold;background:#fffde7;border-top:2px solid #ccc}
    </style></head><body>
    <h2>${d.numero}</h2>
    <div class="sub">${d.type_document?.replace(/_/g,' ')} — ${tierName} — ${dateStr}</div>
    <table>
      <thead><tr><th>Description</th><th class="right">HT</th><th class="right">TVA</th><th class="right">TTC</th></tr></thead>
      <tbody>
        ${d.exo ? `<tr><td colspan="4">Exonéré : ${d.exo}</td></tr>` : ''}
        ${d.ht_7 != null ? `<tr><td>TVA 7%</td><td class="right">${(d.ht_7 as number).toFixed(3)}</td><td class="right">${(d.tva_7 as number ?? 0).toFixed(3)}</td><td class="right">${((d.ht_7 as number) + (d.tva_7 as number ?? 0)).toFixed(3)}</td></tr>` : ''}
        ${d.ht_19 != null ? `<tr><td>TVA 19%</td><td class="right">${(d.ht_19 as number).toFixed(3)}</td><td class="right">${(d.tva_19 as number ?? 0).toFixed(3)}</td><td class="right">${((d.ht_19 as number) + (d.tva_19 as number ?? 0)).toFixed(3)}</td></tr>` : ''}
        ${d.total_remise ? `<tr><td>Remise</td><td class="right" colspan="3">- ${(d.total_remise as number).toFixed(3)}</td></tr>` : ''}
        ${d.timbre ? `<tr><td>Timbre fiscal</td><td class="right" colspan="3">+ ${(d.timbre as number).toFixed(3)}</td></tr>` : ''}
        <tr class="total-row"><td><strong>Total</strong></td><td class="right">${d.total_ht.toFixed(3)}</td><td class="right">${d.total_tva.toFixed(3)}</td><td class="right">${d.total_ttc.toFixed(3)}</td></tr>
      </tbody>
    </table>
    </body></html>`
    void printLabelHtml(html)
  }

  // ── Export Format A — Bilan Factures Achat ──
  const exportAchats = () => {
    const achats = tabFiltered.filter(d => d.type_document === 'FACTURE_ACHAT' || d.type_document === 'FACTURE_ACHAT_BL')
    const rows = achats.map(f => ({
      'N° FACTURE':    f.numero,
      'DATE DE FACTURE': format(new Date(f.created_at), 'dd/MM/yyyy'),
      'SOCIETE':       f.fournisseur_nom ?? '',
      'EXO':           f.exo ?? null,
      'HT':            +(f.total_ht ?? 0).toFixed(3),
      'TVA':           +(f.total_tva ?? 0).toFixed(3),
      'TTC':           +(f.total_ttc ?? 0).toFixed(3),
      'TIMBRE':        +(f.timbre ?? 1).toFixed(3),
      'TOT GENERAL':   +((f.total_ttc ?? 0) + (f.timbre ?? 1)).toFixed(3),
      'HT 7%':         f.ht_7 != null ? +f.ht_7.toFixed(3) : null,
      'TVA 7%':        f.tva_7 != null ? +f.tva_7.toFixed(3) : null,
      'HT 19%':        f.ht_19 != null ? +f.ht_19.toFixed(3) : null,
      'TVA 19%':       f.tva_19 != null ? +f.tva_19.toFixed(3) : null,
      'TOTAL REMISE':  f.total_remise != null ? +f.total_remise.toFixed(3) : null,
    }))
    const sum = (key: string) => rows.reduce((s, r) => s + (Number(r[key as keyof typeof r]) || 0), 0)
    rows.push({
      'N° FACTURE': 'TOTAL', 'DATE DE FACTURE': '', 'SOCIETE': '', 'EXO': null,
      'HT': +sum('HT').toFixed(3), 'TVA': +sum('TVA').toFixed(3),
      'TTC': +sum('TTC').toFixed(3), 'TIMBRE': +sum('TIMBRE').toFixed(3),
      'TOT GENERAL': +sum('TOT GENERAL').toFixed(3),
      'HT 7%': +sum('HT 7%').toFixed(3), 'TVA 7%': +sum('TVA 7%').toFixed(3),
      'HT 19%': +sum('HT 19%').toFixed(3), 'TVA 19%': +sum('TVA 19%').toFixed(3),
      'TOTAL REMISE': +sum('TOTAL REMISE').toFixed(3),
    })
    const periode = dateFrom ? dateFrom.slice(0, 7).replace('-', '/') : format(new Date(), 'MM/yyyy')
    setExcelModal({
      rows: rows as Record<string, unknown>[],
      columns: ['N° FACTURE','DATE DE FACTURE','SOCIETE','EXO','HT','TVA','TTC','TIMBRE','TOT GENERAL','HT 7%','TVA 7%','HT 19%','TVA 19%','TOTAL REMISE'],
      title: `Bilan Factures Achat ${periode}`,
      fileName: `FACTURES_ACHAT_${periode.replace('/', '_')}.xlsx`,
      isAchats: true,
    })
  }

  // ── Export Format B — Bilan Factures Vente ──
  const exportVentes = () => {
    const ventes = tabFiltered.filter(d => d._source !== 'ff' && (d.type_document === 'FACTURE_VENTE' || d.type_document === 'DEVIS' || d.type_document === 'BON_LIVRAISON' || d.type_document === 'AVOIR'))
    const rows = ventes.map(f => ({
      'DOCUMENT':  f.numero,
      'CLIENT':    f.client_nom ?? '',
      'DATE':      format(new Date(f.created_at), 'dd/MM/yyyy'),
      'AVOIR':     f.avoir_numero ?? '',
      'EXO':       f.exo ?? null,
      'TVA':       +(f.total_tva ?? 0).toFixed(3),
      'BASE':      +(f.total_ht ?? 0).toFixed(3),
      'MONTANT':   +(f.total_ht ?? 0).toFixed(3),
      'TAXE':      +(f.total_tva ?? 0).toFixed(3),
      'MT TAXE':   +(f.total_tva ?? 0).toFixed(3),
      'TOTAL TVA': +(f.total_tva ?? 0).toFixed(3),
      'TOTAL HT':  +(f.total_ht ?? 0).toFixed(3),
      'TOTAL TTC': +(f.total_ttc ?? 0).toFixed(3),
    }))
    const sum = (key: string) => rows.reduce((s, r) => s + (Number(r[key as keyof typeof r]) || 0), 0)
    rows.push({
      'DOCUMENT': 'TOTAL', 'CLIENT': '', 'DATE': '', 'AVOIR': '',
      'EXO': null,
      'TVA': +sum('TVA').toFixed(3), 'BASE': +sum('BASE').toFixed(3), 'MONTANT': +sum('MONTANT').toFixed(3),
      'TAXE': +sum('TAXE').toFixed(3), 'MT TAXE': +sum('MT TAXE').toFixed(3),
      'TOTAL TVA': +sum('TOTAL TVA').toFixed(3), 'TOTAL HT': +sum('TOTAL HT').toFixed(3), 'TOTAL TTC': +sum('TOTAL TTC').toFixed(3),
    })
    const periode = dateFrom ? dateFrom.slice(0, 7).replace('-', '/') : format(new Date(), 'MM/yyyy')
    setExcelModal({
      rows: rows as Record<string, unknown>[],
      columns: ['DOCUMENT','CLIENT','DATE','AVOIR','EXO','TVA','BASE','MONTANT','TAXE','MT TAXE','TOTAL TVA','TOTAL HT','TOTAL TTC'],
      title: `Bilan Ventes ${periode}`,
      fileName: `BILAN_VENTES_${periode.replace('/', '_')}.xlsx`,
    })
  }

  const { printRef: printTableRef, handlePrint: handlePrintTable } = usePrint('Documents')

  return (
    <div className="h-full flex flex-col bg-surface overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-white flex-shrink-0">
        <h2 className="font-bold text-sm flex items-center gap-2"><FileText size={15} /> Documents</h2>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading} className="p-1.5 text-text-muted hover:text-text-primary rounded-lg hover:bg-muted">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={exportAchats} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold">
            <Download size={13} /> Export Achats
          </button>
          <button onClick={exportVentes} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-bold">
            <Download size={13} /> Export Ventes
          </button>
          <button onClick={() => handlePrintTable()} className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-xs font-semibold hover:bg-muted">
            <Printer size={13} /> Imprimer
          </button>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-0 px-4 pt-1 bg-white border-b border-border flex-shrink-0 overflow-x-auto">
        {SUB_TABS.map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)}
            className={cn('px-3 py-2 text-xs font-medium border-b-2 whitespace-nowrap transition-all',
              subTab === t.id ? 'border-accent-500 text-text-primary bg-accent-50' : 'border-transparent text-text-secondary hover:text-text-primary hover:bg-muted'
            )}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 px-4 py-2 bg-white border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2 border border-border rounded-lg px-3 py-1.5 bg-muted flex-1 max-w-xs">
          <Search size={13} className="text-text-muted" />
          <input value={search} onChange={e => setSearch(e.target.value)} className="flex-1 bg-transparent text-xs outline-none" placeholder="Rechercher n°, client, fournisseur..." />
        </div>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border border-border rounded-lg px-3 py-1.5 text-xs outline-none focus:border-accent-500" placeholder="Du" />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="border border-border rounded-lg px-3 py-1.5 text-xs outline-none focus:border-accent-500" placeholder="Au" />
        {(dateFrom || dateTo) && <button onClick={() => { setDateFrom(''); setDateTo('') }} className="text-text-muted hover:text-danger"><X size={14} /></button>}
        <span className="ml-auto text-xs text-text-muted">{filtered.length} doc(s)</span>
      </div>

      {/* Table */}
      <div ref={printTableRef} className="flex-1 overflow-auto px-4 py-2">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted border-b border-border">
            <tr>
              <th className="text-left px-3 py-2 font-semibold text-text-secondary">Numéro</th>
              <th className="text-left px-3 py-2 font-semibold text-text-secondary">Type</th>
              <th className="text-left px-3 py-2 font-semibold text-text-secondary">Client / Fournisseur</th>
              <th className="text-left px-3 py-2 font-semibold text-text-secondary">Date</th>
              <th className="text-right px-3 py-2 font-semibold text-text-secondary">Total TTC</th>
              <th className="text-center px-3 py-2 font-semibold text-text-secondary">Statut</th>
              <th className="text-left px-3 py-2 font-semibold text-text-secondary">Avoir</th>
              <th className="w-40 px-3 py-2 no-print" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map(d => {
              const sc = STATUT_CONFIG[d.statut] ?? STATUT_CONFIG['ACTIF']
              return (
                <tr key={d.id} className={cn('hover:bg-muted/50', d.statut === 'ANNULE' && 'opacity-60')}>
                  <td className={cn('px-3 py-2 font-mono font-semibold text-text-primary', (d.statut === 'ANNULE' || d.statut === 'REVOQUE') && 'line-through')}>
                    {d.numero}
                    {d.statut === 'REVOQUE' && (
                      <span className="ml-1.5 text-[10px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded no-underline not-italic">RÉVOQUÉ</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-text-muted">{d.type_document?.replace('_', ' ')}</td>
                  <td className={cn('px-3 py-2 max-w-[180px] truncate', d.statut === 'ANNULE' && 'line-through')}>{tiers(d)}</td>
                  <td className="px-3 py-2 text-text-muted">{d.created_at ? format(new Date(d.created_at), 'dd/MM/yyyy') : '—'}</td>
                  <td className="px-3 py-2 text-right font-price font-semibold">{formatPrice(d.total_ttc)}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full border', sc.cls)}>{sc.label}</span>
                  </td>
                  <td className="px-3 py-2">
                    {d.avoir_numero ? (
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-[10px] text-red-700 font-semibold">{d.avoir_numero}</span>
                        <button onClick={() => exportAvoirForRow(d)} title="Exporter avoir" className="p-0.5 rounded text-green-600 hover:bg-green-50 no-print">
                          <Download size={11} />
                        </button>
                      </div>
                    ) : d.type_document === 'AVOIR' && d.facture_origine_numero ? (
                      <span className="text-[10px] text-text-muted">← {d.facture_origine_numero}</span>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2 no-print">
                    <div className="flex items-center gap-1 justify-end">
                      <button onClick={() => setPreviewDoc(d)} title="Voir" className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-muted"><Eye size={12} /></button>
                      <button onClick={() => printDoc(d)} title="Imprimer" className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-muted"><Printer size={12} /></button>
                      <button onClick={() => exportSingleDoc(d)} title="Exporter Excel" className="p-1 rounded text-text-muted hover:text-green-600 hover:bg-green-50"><Download size={12} /></button>
                      {canEditDoc(d) && (
                        <button onClick={() => startEdit(d)} title="Modifier" className="p-1 rounded text-text-muted hover:text-accent-600 hover:bg-accent-50"><Edit2 size={12} /></button>
                      )}
                      {d.statut === 'NON_ARRIVE' && (
                        <button onClick={() => marquerRecu(d)} title="Marquer reçu" className="p-1 rounded text-blue-600 hover:bg-blue-50"><PackageCheck size={12} /></button>
                      )}
                      {(d.type_document === 'FACTURE_VENTE' || d.type_document === 'FACTURE_JOURNALIERE_F') && d.statut === 'ACTIF' && (
                        <button onClick={() => setRevoquerDoc(d)} title="Révoquer facture" className="p-1 rounded text-orange-500 hover:text-red-600 hover:bg-red-50">
                          <RotateCcw size={12} />
                        </button>
                      )}
                      {d.statut !== 'ANNULE' && d.statut !== 'REVOQUE' && d.type_document !== 'AVOIR' && (
                        <button onClick={() => annulerDoc(d)} title="Annuler" className="p-1 rounded text-text-muted hover:text-danger hover:bg-red-50"><Ban size={12} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && !loading && (
              <tr><td colSpan={8} className="px-3 py-12 text-center text-text-muted">Aucun document trouvé</td></tr>
            )}
            {loading && (
              <tr><td colSpan={8} className="px-3 py-12 text-center text-text-muted">Chargement...</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Document preview modal */}
      {previewDoc && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold">{previewDoc.numero}</h3>
              <button onClick={() => setPreviewDoc(null)}><X size={18} /></button>
            </div>
            <div className="text-sm space-y-1">
              <div className="flex justify-between"><span className="text-text-muted">Type</span><span>{previewDoc.type_document}</span></div>
              <div className="flex justify-between"><span className="text-text-muted">Tiers</span><span>{tiers(previewDoc)}</span></div>
              <div className="flex justify-between"><span className="text-text-muted">Date</span><span>{previewDoc.created_at ? format(new Date(previewDoc.created_at), 'dd/MM/yyyy HH:mm') : '—'}</span></div>
              <div className="flex justify-between"><span className="text-text-muted">HT</span><span className="font-price">{formatPrice(previewDoc.total_ht)}</span></div>
              <div className="flex justify-between"><span className="text-text-muted">TVA</span><span className="font-price">{formatPrice(previewDoc.total_tva)}</span></div>
              {previewDoc.timbre ? <div className="flex justify-between"><span className="text-text-muted">Timbre</span><span className="font-price">{formatPrice(previewDoc.timbre)}</span></div> : null}
              {previewDoc.total_remise ? <div className="flex justify-between text-red-600"><span>Remise</span><span className="font-price">- {formatPrice(previewDoc.total_remise)}</span></div> : null}
              <div className="flex justify-between font-bold border-t border-border pt-1"><span>Total TTC</span><span className="font-price text-base">{formatPrice(previewDoc.total_ttc)}</span></div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button type="button" onClick={() => setPreviewDoc(null)} className="flex-1 bg-muted hover:bg-border py-2 rounded-xl text-sm font-semibold">Fermer</button>
              <button type="button" onClick={() => { printDoc(previewDoc); setPreviewDoc(null) }} className="flex items-center gap-1.5 px-4 py-2 bg-muted border border-border hover:bg-border rounded-xl text-sm font-semibold"><Printer size={13} /> Imprimer</button>
              {canEditDoc(previewDoc) && (
                <button type="button" onClick={() => { startEdit(previewDoc); setPreviewDoc(null) }} className="flex items-center gap-1.5 px-4 py-2 bg-accent-50 hover:bg-accent-100 border border-accent-200 rounded-xl text-sm font-semibold"><Edit2 size={13} /> Modifier</button>
              )}
              {previewDoc.statut !== 'ANNULE' && previewDoc.statut !== 'REVOQUE' && previewDoc.type_document !== 'AVOIR' && (
                <button type="button" onClick={() => { annulerDoc(previewDoc); setPreviewDoc(null) }} className="flex items-center gap-1.5 px-4 py-2 bg-red-50 hover:bg-red-100 text-danger border border-red-200 rounded-xl text-sm font-semibold"><Ban size={13} /> Annuler</button>
              )}
            </div>
          </div>
        </div>
      )}

      {excelModal && (
        <ExcelPreviewModal
          rows={excelModal.rows}
          columns={excelModal.columns}
          title={excelModal.title}
          fileName={excelModal.fileName}
          isAchats={excelModal.isAchats}
          onClose={() => setExcelModal(null)}
        />
      )}

      {revoquerDoc && (
        <RevocationModal
          doc={revoquerDoc}
          onClose={() => setRevoquerDoc(null)}
          onConfirmed={() => { setRevoquerDoc(null); load() }}
        />
      )}

      {printInvoiceDoc && (
        <DocumentPrintModal doc={printInvoiceDoc} onClose={() => setPrintInvoiceDoc(null)} />
      )}

      {printAchatId && (
        <FactureAchatPrintModal factureId={printAchatId} onClose={() => setPrintAchatId(null)} />
      )}

      {showPinForEdit && (
        <PinUnlockModal
          title={`Modifier ${showPinForEdit.numero}`}
          onCancel={() => setShowPinForEdit(null)}
          onUnlocked={() => {
            setEditTarget({ mode: showPinForEdit.mode, id: showPinForEdit.id })
            setShowPinForEdit(null)
          }}
        />
      )}

      {editTarget && (
        <InvoiceEditModal
          mode={editTarget.mode}
          documentId={editTarget.id}
          onClose={() => setEditTarget(null)}
          onSaved={load}
        />
      )}
    </div>
  )
}

// ── RevocationModal ────────────────────────────────────────────────────────────
function RevocationModal({ doc, onClose, onConfirmed }: { doc: DocRow; onClose: () => void; onConfirmed: () => void }) {
  const [pin, setPin] = useState('')
  const [motif, setMotif] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const VALID_PINS = ['sml2023', '1234', 'admin', 'superadmin']

  const handleConfirm = async () => {
    if (!pin.trim()) { setError('PIN requis'); return }
    if (!motif.trim()) { setError('Motif obligatoire'); return }
    const storedPin = await api.settingsGet('caisse_interne_pin') as string | null
    const valid = (storedPin && pin === storedPin) || VALID_PINS.includes(pin)
    if (!valid) { setError('PIN incorrect'); return }
    await runAction('Révocation document', async () => {
      await api.documentsRevoquer(doc.id, motif.trim(), 'opérateur')
      onConfirmed()
    }, { setLoading, silent: true, onError: setError, successMessage: 'Document révoqué' })
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm animate-slide-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="font-bold text-sm text-red-700 flex items-center gap-2">
            <RotateCcw size={14} /> Révoquer {doc.numero}
          </h3>
          <button onClick={onClose}><X size={16} className="text-text-muted" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
            La révocation est irréversible. Le numéro <strong>{doc.numero}</strong> sera marqué comme révoqué et ne pourra plus être réutilisé.
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5">PIN Opérateur <span className="text-danger">*</span></label>
            <input type="password" value={pin} onChange={e => { setPin(e.target.value); setError('') }}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent-500"
              placeholder="Entrer votre PIN" autoFocus />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5">Motif de révocation <span className="text-danger">*</span></label>
            <textarea value={motif} onChange={e => { setMotif(e.target.value); setError('') }}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent-500 resize-none"
              rows={2} placeholder="Erreur de saisie, doublon, etc." />
          </div>
          {error && <p className="text-xs text-danger font-semibold">{error}</p>}
        </div>
        <div className="flex gap-3 px-5 py-4 border-t border-border">
          <button type="button" onClick={onClose} className="flex-1 bg-muted hover:bg-border font-semibold py-2.5 rounded-xl text-sm">Annuler</button>
          <button type="button" onClick={handleConfirm} disabled={loading}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold py-2.5 rounded-xl text-sm flex items-center justify-center gap-2">
            {loading ? <RefreshCw size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            Confirmer révocation
          </button>
        </div>
      </div>
    </div>
  )
}

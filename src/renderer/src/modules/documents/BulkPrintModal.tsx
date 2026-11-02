import { useEffect, useRef, useState } from 'react'
import Fuse from 'fuse.js'
import { AlertTriangle, CheckCircle, Clock, Loader2, Printer, RefreshCw, Square, X } from 'lucide-react'
import { bulkPrintDate, runBulkPrintQueue, selectBulkPrintDocuments, type BulkPrintDocument, type BulkPrintStatus } from '../../lib/bulkPrint'
import { wrapPrintHtml } from '../../lib/printHtml'

const api = window.api
type PrinterInfo = { name: string; displayName?: string; isDefault?: boolean }
type QueueItem = { key: string; document: BulkPrintDocument; status: BulkPrintStatus; error?: string }
const LABELS: Record<BulkPrintStatus, string> = {
  pending: 'En attente', preparing: 'Préparation facture', sending: 'Envoi en cours…',
  queued: 'Envoyé à la file', failed: 'Échec', uncertain: 'Envoi non confirmé', cancelled: 'Non envoyé',
}

export default function BulkPrintModal({ type, dateFrom, dateTo, search, loadMarkup, onClose }: {
  type: string
  dateFrom: string
  dateTo: string
  search: string
  loadMarkup: (row: BulkPrintDocument) => Promise<string>
  onClose: () => void
}) {
  const [items, setItems] = useState<QueueItem[]>([])
  const [printers, setPrinters] = useState<PrinterInfo[]>([])
  const [printerName, setPrinterName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [started, setStarted] = useState(false)
  const [stopRequested, setStopRequested] = useState(false)
  const [reload, setReload] = useState(0)
  const runningRef = useRef(false)
  const stopRef = useRef(false)
  const mountedRef = useRef(true)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; stopRef.current = true }
  }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    void Promise.all([
      api.documentsListAll
        ? api.documentsListAll({ bulkPrint: true, type_document: type, dateFrom, dateTo }) as Promise<BulkPrintDocument[]>
        : Promise.reject(new Error('Chargement des documents indisponible')),
      api.getPrinters ? api.getPrinters() : Promise.reject(new Error('Impression Windows indisponible')),
      api.settingsGetAll(),
    ]).then(([rows, devices, settings]) => {
      if (!active) return
      let selected = selectBulkPrintDocuments(rows, type)
      if (search.length >= 2) {
        const matches = new Fuse(selected, { keys: ['numero', 'client_nom', 'fournisseur_nom'], threshold: 0.4, minMatchCharLength: 2, ignoreLocation: true }).search(search)
        const matched = new Set(matches.map(match => match.item))
        selected = selected.filter(row => matched.has(row))
      }
      setItems(selected.map(document => ({ key: `${document._source ?? 'documents'}:${document.id}`, document, status: 'pending' })))
      setPrinters(devices)
      const saved = String(settings.impression_printer_a4 || '')
      setPrinterName(devices.find(printer => printer.name === saved)?.name || devices.find(printer => printer.isDefault)?.name || devices[0]?.name || '')
      if (!devices.length) setError('Aucune imprimante Windows trouvée. Installez ou connectez votre imprimante puis actualisez.')
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [type, dateFrom, dateTo, search, reload])

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (!runningRef.current) onClose()
      }
      if (event.key === 'Tab') {
        const dialog = closeRef.current?.closest('[role="dialog"]')
        const controls = Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled)') || [])
        const first = controls[0]; const last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const start = async (mode: 'pending' | 'failed' | 'cancelled' = 'pending') => {
    if (runningRef.current || !printerName || !api.printContent) return
    const pending = items.filter(item => item.status === mode)
    if (!pending.length) return
    runningRef.current = true
    stopRef.current = false
    setRunning(true)
    setStarted(true)
    setStopRequested(false)
    setError('')
    try {
      // Remember the printer without making a settings-write failure block printing.
      await api.settingsSet('impression_printer_a4', printerName).catch(() => {})
      await runBulkPrintQueue({
        items: pending,
        prepare: item => loadMarkup(item.document),
        submit: markup => api.printContent!(wrapPrintHtml(markup, 'A4'), printerName, {
          pageSize: 'A4', copies: 1, silent: true, printBackground: true, color: true, timeoutMs: 90_000,
        }),
        shouldStop: () => stopRef.current || !mountedRef.current,
        onStatus: (item, status, reason) => {
          if (mountedRef.current) setItems(previous => previous.map(row => row.key === item.key ? { ...row, status, error: reason } : row))
        },
      })
    } finally {
      runningRef.current = false
      if (mountedRef.current) setRunning(false)
    }
  }

  const queued = items.filter(item => item.status === 'queued').length
  const failed = items.filter(item => item.status === 'failed').length
  const unsent = items.filter(item => item.status === 'cancelled').length
  const uncertain = items.some(item => item.status === 'uncertain')
  const completed = items.filter(item => ['queued', 'failed', 'uncertain', 'cancelled'].includes(item.status)).length
  const progress = items.length ? Math.round(completed / items.length * 100) : 0

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <section role="dialog" aria-modal="true" aria-labelledby="bulk-print-title" className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-border bg-white shadow-2xl" data-preview-allowed="true">
        <header className="flex items-center gap-3 border-b border-border bg-accent-50 px-6 py-4">
          <span className="rounded-2xl bg-accent-200 p-3"><Printer size={22}/></span>
          <div className="min-w-0 flex-1"><h2 id="bulk-print-title" className="font-bold">Imprimer en groupe</h2><p className="text-xs text-text-secondary">{dateFrom || 'Début'} → {dateTo || 'Aujourd’hui'}{search && ` · Recherche : ${search}`}</p></div>
          <button ref={closeRef} type="button" aria-label="Fermer l’impression en groupe" disabled={running} onClick={onClose} className="rounded-xl p-2 hover:bg-muted disabled:opacity-30"><X size={20}/></button>
        </header>
        <div className="space-y-3 border-b border-border px-6 py-4">
          <label className="block text-xs font-semibold" htmlFor="bulk-print-printer">Imprimante · A4 · 1 exemplaire par document</label>
          <div className="flex gap-2">
            <select id="bulk-print-printer" value={printerName} disabled={loading || started} onChange={event => setPrinterName(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-border bg-white px-3 py-2 text-sm disabled:opacity-60">
              <option value="">Choisir une imprimante…</option>
              {printers.map(printer => <option key={printer.name} value={printer.name}>{printer.displayName || printer.name}{printer.isDefault ? ' (par défaut)' : ''}</option>)}
            </select>
            {!started && <button type="button" disabled={loading} onClick={() => setReload(value => value + 1)} aria-label="Actualiser les imprimantes et documents" className="rounded-xl border border-border p-2"><RefreshCw size={16} className={loading ? 'animate-spin' : ''}/></button>}
          </div>
          <p className="text-xs text-text-secondary">{type === 'TOUS' ? 'Factures vente, journalières et achat' : type.replace(/_/g, ' ')} · Documents annulés, révoqués et brouillons exclus. Toutes les pages du PDF complet sont envoyées, pas le tableau récapitulatif.</p>
          {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs text-red-700">{error}</p>}
          <div aria-live="polite" className="flex items-center justify-between text-xs"><strong>{loading ? 'Chargement de toute la période…' : `${items.length} document(s)`}</strong><span>{queued} envoyé(s) · {failed} échec(s)</span></div>
          <div role="progressbar" aria-label="Envoi des documents à la file d’impression" aria-valuemin={0} aria-valuemax={items.length || 1} aria-valuenow={completed} className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-accent-500 transition-all duration-300" style={{ width: `${progress}%` }}/></div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-2">
          {!loading && !items.length && <p className="py-10 text-center text-sm text-text-muted">Aucun document imprimable pour ces filtres.</p>}
          <ol className="divide-y divide-border">
            {items.map(item => <li key={item.key} className="flex items-start gap-3 py-3 text-sm">
              <span className="mt-0.5">{item.status === 'queued' ? <CheckCircle size={17} className="text-emerald-600"/> : ['failed', 'uncertain'].includes(item.status) ? <AlertTriangle size={17} className="text-red-600"/> : ['preparing', 'sending'].includes(item.status) ? <Loader2 size={17} className="animate-spin text-accent-600"/> : <Clock size={17} className="text-text-muted"/>}</span>
              <div className="min-w-0 flex-1"><p className="font-mono font-semibold">{item.document.numero}</p><p className="truncate text-xs text-text-muted">{item.document.client_nom || item.document.fournisseur_nom || 'Client Passager'} · {bulkPrintDate(item.document.created_at).toLocaleDateString('fr-TN')}</p>{item.error && <p className="mt-1 text-xs text-red-700">{item.error}</p>}</div>
              <span className="shrink-0 text-xs font-semibold text-text-secondary">{LABELS[item.status]}</span>
            </li>)}
          </ol>
        </div>
        <footer className="space-y-3 border-t border-border bg-muted/30 px-6 py-4">
          <p className="text-xs text-text-secondary">Le suivi confirme l’envoi à la file Windows, pas la sortie du papier. Arrêter laisse les documents déjà envoyés dans la file.</p>
          {uncertain && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">Lot arrêté par sécurité : vérifiez la file d’impression Windows pour le document non confirmé avant de relancer une impression.</p>}
          <div className="flex justify-end gap-2">
            {running ? <button type="button" disabled={stopRequested} onClick={() => { stopRef.current = true; setStopRequested(true) }} className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700"><Square size={14}/>{stopRequested ? 'Arrêt après le document en cours…' : 'Arrêter les envois'}</button> : <>
              <button type="button" onClick={onClose} className="rounded-xl border border-border px-4 py-2 text-sm font-semibold">Fermer</button>
              {!started && <button type="button" disabled={loading || !!error || !printerName || !items.length} onClick={() => void start()} className="flex items-center gap-2 rounded-xl bg-accent-500 px-5 py-2 text-sm font-bold disabled:opacity-40"><Printer size={16}/>Envoyer les {items.length} document(s)</button>}
              {started && failed > 0 && !uncertain && <button type="button" onClick={() => void start('failed')} className="flex items-center gap-2 rounded-xl bg-accent-500 px-4 py-2 text-sm font-bold"><RefreshCw size={15}/>Réessayer les {failed} échec(s) uniquement</button>}
              {started && unsent > 0 && !uncertain && <button type="button" onClick={() => void start('cancelled')} className="flex items-center gap-2 rounded-xl bg-accent-500 px-4 py-2 text-sm font-bold"><Printer size={15}/>Continuer les {unsent} non envoyé(s)</button>}
            </>}
          </div>
        </footer>
      </section>
    </div>
  )
}

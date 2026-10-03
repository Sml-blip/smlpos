import { useState, useEffect } from 'react'
import { useAppStore } from '../store/appStore'
import { formatPrice } from '../lib/utils'
import { runAction } from '../lib/apiCall'
import { showToast } from '../lib/toast'
import { playFeedback } from '../lib/feedback'
import { buildBalanceReport, saveBalanceReport } from '../lib/reportPdf'
import { printFullHtmlDocument } from '../lib/nativePrint'
import { X, DollarSign, ShoppingBag, Wrench, ArrowDownCircle, ArrowUpCircle, LogOut, AlertCircle, CheckCircle, CreditCard, FileText, Download, Printer, RefreshCw, Play } from 'lucide-react'

const api = window.api

interface ShiftSummary {
  ventes: { total: number; count: number }
  reparations: { total: number; count: number }
  services: { total: number; count: number }
  sorties: { total: number; count: number }
  parMode: Array<{ mode_paiement: string; total: number }>
  creditsPercus: { total: number; count: number }
  avancesClients: { total: number; count: number }
  echanges: { entrees: number; sorties: number; count: number }
  operations: Array<{ id: string; date: string; type: string; direction: 'ENTREE' | 'SORTIE'; amount: number; operator: string; note: string }>
  moneyIn: number
  moneyOut: number
  net: number
}

interface SavedCashReport {
  id: string
  numero: string
  session_type: 'MATIN' | 'SOIR'
  date_journal: string
  ended_at: string
}

const MODE_LABELS: Record<string, string> = {
  ESPECES: 'Espèces',
  CARTE: 'Carte',
  CHEQUE: 'Chèque',
  MIXTE: 'Mixte',
}

interface Props {
  onClose: () => void
}

export default function FermetureCaisseModal({ onClose }: Props) {
  const { currentShift, setCurrentShift, setCurrentOperateur, setShowShiftModal, setPreviewMode } = useAppStore()
  const [summary, setSummary] = useState<ShiftSummary | null>(null)
  const [soldeCaisse, setSoldeCaisse] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingSummary, setLoadingSummary] = useState(true)
  const [confirmed, setConfirmed] = useState(false)
  const [closedShiftsToday, setClosedShiftsToday] = useState<number | null>(null)
  const [savedReport, setSavedReport] = useState<SavedCashReport | null>(null)

  useEffect(() => {
    if (!currentShift) return
    let cancelled = false
    const timeout = setTimeout(() => {
      if (!cancelled) setLoadingSummary(false)
    }, 8000)
    Promise.all([
      api.shiftsGetSummary(currentShift.id),
      api.shiftsCountClosedToday?.() ?? Promise.resolve(0),
    ])
      .then(([s, closedCount]) => {
        if (cancelled) return
        if (s) setSummary(s as ShiftSummary)
        setClosedShiftsToday(typeof closedCount === 'number' ? closedCount : 0)
      })
      .catch((e) => {
        console.error('[FermetureCaisse] load failed:', e)
      })
      .finally(() => {
        if (!cancelled) setLoadingSummary(false)
      })
    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [currentShift])

  if (!currentShift) return null

  // Services are cart lines already included in ventes.total; keep their card informational only.
  const totalEncaisse = summary ? summary.ventes.total + summary.reparations.total + (summary.creditsPercus?.total ?? 0) + (summary.avancesClients?.total ?? 0) + (summary.echanges?.entrees ?? 0) : 0
  const reportNet = summary ? summary.moneyIn - summary.moneyOut : 0
  const drawerExpected = currentShift.fond_de_caisse + reportNet
  const soldeReel = parseFloat(soldeCaisse.replace(',', '.')) || 0
  const soldeReelHorsFond = soldeCaisse ? soldeReel - currentShift.fond_de_caisse : null
  const ecart = soldeCaisse ? soldeReel - drawerExpected : null
  const isMorningClosure = currentShift.session_type ? currentShift.session_type === 'MATIN' : closedShiftsToday === 0

  const reportData = () => {
    if (!summary) return null
    const subject = `${currentShift.operateur_nom} · ${new Date(currentShift.started_at).toLocaleString('fr-TN')} → ${new Date().toLocaleString('fr-TN')}`
    const boxes: Array<[string, string]> = [
      ['Total entrées', formatPrice(summary.moneyIn)],
      ['Total sorties', formatPrice(summary.moneyOut)],
      ['Résultat hors fond', formatPrice(reportNet)],
      ['Réel hors fond', soldeReelHorsFond == null ? 'Non compté' : formatPrice(soldeReelHorsFond)],
    ]
    const rows = summary.operations.map(operation => ({
      date: operation.date,
      type: `${operation.direction === 'ENTREE' ? 'Entrée' : 'Sortie'} · ${operation.type}`,
      amount: operation.direction === 'SORTIE' ? -operation.amount : operation.amount,
      operator: operation.operator,
      note: operation.note,
    }))
    return { subject, boxes, rows }
  }

  const handleDownloadReport = async () => {
    const report = reportData()
    if (!report) return
    const ok = await saveBalanceReport('Bilan détaillé de caisse', report.subject, report.boxes, report.rows, `bilan-caisse-${new Date().toLocaleDateString('en-CA')}.pdf`)
    showToast(ok ? 'success' : 'error', ok ? 'Bilan PDF enregistré' : 'Enregistrement PDF annulé ou impossible')
  }

  const handlePrintReport = async () => {
    const report = reportData()
    if (!report) return
    await printFullHtmlDocument(buildBalanceReport('Bilan détaillé de caisse', report.subject, report.boxes, report.rows), { pageSize: 'A4', printKind: 'document' })
  }

  const handleClose = async () => {
    if (closedShiftsToday === null) return
    if (!confirmed) { setConfirmed(true); return }
    const succeeded = await runAction('Fermeture de caisse', async () => {
      const now = new Date().toISOString()
      const result = await api.shiftsClose(currentShift.id, {
        ended_at: now,
        // Keep the physical drawer value on the shift for backwards-compatible
        // reconciliation; the attached report itself is always outside the fund.
        solde_theorique: drawerExpected,
        notes_cloture: notes || null,
        rapport: {
          session_type: isMorningClosure ? 'MATIN' : 'SOIR',
          operateur: currentShift.operateur_nom,
          total_entrees: summary?.moneyIn ?? totalEncaisse,
          total_sorties: summary?.moneyOut ?? (summary?.sorties.total ?? 0),
          solde_reel: soldeReelHorsFond,
          summary,
          operations: summary?.operations ?? [],
        },
      })
      await api.caisseInterneTransferShift(currentShift.id)
      const report = (result as { report?: SavedCashReport } | undefined)?.report
      if (!report) throw new Error('Le rapport de caisse n’a pas été enregistré')
      setSavedReport(report)
    }, { setLoading })
    if (succeeded) {
      playFeedback('success')
      showToast('success', `Caisse ${isMorningClosure ? 'du matin' : 'du soir'} fermée — rapport enregistré`)
    }
  }

  const finishClosure = () => {
    setCurrentShift(null)
    setCurrentOperateur(null)
    setPreviewMode(false)
    setShowShiftModal(true)
    onClose()
  }

  if (savedReport) {
    return (
      <div className="fixed inset-0 bg-black/55 flex items-center justify-center z-50 p-3 sm:p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[calc(100vh-2rem)] overflow-hidden animate-slide-in grid grid-cols-1 lg:grid-cols-[320px_1fr]">
          <aside className="bg-gradient-to-b from-emerald-600 to-teal-700 text-white p-6 flex flex-col">
            <CheckCircle size={42} className="mb-4" />
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-100">Clôture terminée</p>
            <h2 className="text-2xl font-black mt-1">Rapport {savedReport.session_type === 'MATIN' ? 'Matin' : 'Soir'}</h2>
            <p className="font-mono text-sm mt-2 text-emerald-50">{savedReport.numero}</p>
            <div className="mt-6 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-emerald-100">Entrées</span><strong>{formatPrice(summary?.moneyIn ?? 0)}</strong></div>
              <div className="flex justify-between"><span className="text-emerald-100">Sorties</span><strong>{formatPrice(summary?.moneyOut ?? 0)}</strong></div>
              <div className="flex justify-between border-t border-white/25 pt-2"><span>Résultat hors fond</span><strong>{formatPrice(reportNet)}</strong></div>
            </div>
            <p className="mt-auto pt-6 text-xs text-emerald-100">Le rapport est conservé hors fonds dans Documents → Rapports de caisse.{!isMorningClosure && ' Le rapport Total journée a aussi été généré.'} La facture journalière reste indépendante.</p>
            <button onClick={finishClosure} className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-white text-teal-800 py-2.5 font-bold"><Play size={15}/> Continuer vers le choix</button>
          </aside>
          <section className="min-h-0 flex flex-col">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div><h3 className="font-bold">Aperçu imprimable</h3><p className="text-xs text-text-muted">{new Date(savedReport.ended_at).toLocaleString('fr-TN')}</p></div>
              <div className="flex gap-2"><button onClick={handlePrintReport} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-bold"><Printer size={14}/> Imprimer</button><button onClick={handleDownloadReport} className="flex items-center gap-1.5 rounded-lg bg-red-50 text-red-700 border border-red-200 px-3 py-2 text-xs font-bold"><Download size={14}/> PDF</button><button onClick={finishClosure} className="p-2"><X size={18}/></button></div>
            </div>
            <div className="overflow-auto p-5">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">{[['Entrées', summary?.moneyIn ?? 0], ['Sorties', summary?.moneyOut ?? 0], ['Résultat hors fond', reportNet]].map(([label,value]) => <div key={String(label)} className="rounded-xl border border-border bg-muted p-3"><p className="text-[10px] uppercase text-text-muted">{label}</p><p className="font-price font-bold mt-1">{formatPrice(Number(value))}</p></div>)}</div>
              <table className="w-full text-xs"><thead><tr className="bg-muted"><th className="p-2 text-left">Heure</th><th className="p-2 text-left">Opération</th><th className="p-2 text-left">Utilisateur</th><th className="p-2 text-right">Entrée</th><th className="p-2 text-right">Sortie</th><th className="p-2 text-left">Détail</th></tr></thead><tbody>{summary?.operations.map(operation => <tr key={operation.id} className="border-b border-border"><td className="p-2">{new Date(operation.date).toLocaleTimeString('fr-TN', {hour:'2-digit',minute:'2-digit'})}</td><td className="p-2 font-semibold">{operation.type}</td><td className="p-2">{operation.operator}</td><td className="p-2 text-right text-green-700">{operation.direction === 'ENTREE' ? formatPrice(operation.amount) : '—'}</td><td className="p-2 text-right text-red-700">{operation.direction === 'SORTIE' ? formatPrice(operation.amount) : '—'}</td><td className="p-2 text-text-muted">{operation.note}</td></tr>)}</tbody></table>
            </div>
          </section>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-3 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-7xl max-h-[calc(100vh-1.5rem)] sm:max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden animate-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <LogOut size={16} className="text-danger" />
            <h2 className="font-bold text-base">Fermeture caisse {isMorningClosure ? 'matin' : 'soir'}</h2>
          </div>
          <div className="flex items-center gap-2">
            {summary && <><button onClick={handlePrintReport} title="Imprimer le bilan" className="p-2 rounded-lg hover:bg-muted text-text-secondary"><Printer size={16} /></button><button onClick={handleDownloadReport} title="Télécharger le bilan PDF" className="p-2 rounded-lg hover:bg-muted text-text-secondary"><Download size={16} /></button></>}
            {!confirmed && <button onClick={onClose} className="text-text-muted hover:text-text-primary"><X size={18} /></button>}
          </div>
        </div>

        <div className="p-4 sm:p-5 overflow-y-auto grid grid-cols-1 lg:grid-cols-[380px_minmax(0,1fr)] gap-4 lg:gap-5 items-start bg-slate-50/70">
          <div className={`lg:col-span-2 flex items-start gap-2 p-3 rounded-xl text-xs ${isMorningClosure ? 'bg-blue-50 border border-blue-200 text-blue-900' : 'bg-teal-50 border border-teal-200 text-teal-900'}`}>
            <FileText size={14} className="flex-shrink-0 mt-0.5" />
            <span>
              <><strong>Rapport de caisse {isMorningClosure ? 'matin' : 'soir'}</strong> — il sera enregistré et affiché dans un aperçu imprimable. La facture journalière Client Passager est séparée et ne sera pas créée par cette clôture.</>
            </span>
          </div>

          {/* Shift info */}
          <div className="lg:col-start-1 bg-white border border-border rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-secondary">Opérateur</span>
              <span className="font-semibold">{currentShift.operateur_nom}</span>
            </div>
            <div className="flex items-center justify-between text-sm mt-1">
              <span className="text-text-secondary">Ouverture</span>
              <span className="font-mono text-xs">{new Date(currentShift.started_at).toLocaleString('fr-FR')}</span>
            </div>
            <div className="flex items-center justify-between text-sm mt-1">
              <span className="text-text-secondary">Fond de caisse</span>
              <span className="font-price font-semibold">{formatPrice(currentShift.fond_de_caisse)}</span>
            </div>
            <div className="flex items-center justify-between text-sm mt-1">
              <span className="text-text-secondary">Shifts déjà clos aujourd&apos;hui</span>
              <span className="font-semibold">{closedShiftsToday ?? '…'}</span>
            </div>
          </div>

          {/* Summary */}
          {loadingSummary ? (
            <div className="lg:col-start-2 text-center py-8 text-text-muted text-sm bg-white border border-border rounded-2xl">Chargement du rapport...</div>
          ) : summary && (
            <div className="lg:col-start-2 space-y-3 rounded-2xl border border-border bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent-700">Aperçu rapport en direct</p><h3 className="text-sm font-bold">Rapport de caisse {isMorningClosure ? 'Matin' : 'Soir'}</h3></div><span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-semibold text-text-secondary">Imprimable après clôture</span></div>

              <div className="grid grid-cols-2 gap-2">
                <div className="bg-green-50 border border-green-200 rounded-xl p-3">
                  <div className="flex items-center gap-1 text-xs text-green-700 font-semibold mb-1">
                    <ShoppingBag size={11} /> Ventes
                  </div>
                  <div className="font-price font-bold text-sm text-green-800">{formatPrice(summary.ventes.total)}</div>
                  <div className="text-xs text-green-600">{summary.ventes.count} transaction{summary.ventes.count > 1 ? 's' : ''}</div>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                  <div className="flex items-center gap-1 text-xs text-blue-700 font-semibold mb-1">
                    <Wrench size={11} /> Réparations
                  </div>
                  <div className="font-price font-bold text-sm text-blue-800">{formatPrice(summary.reparations.total)}</div>
                  <div className="text-xs text-blue-600">{summary.reparations.count} dossier{summary.reparations.count > 1 ? 's' : ''}</div>
                </div>
                {(summary.services?.total ?? 0) > 0 && <div className="bg-cyan-50 border border-cyan-200 rounded-xl p-3"><div className="text-xs text-cyan-700 font-semibold mb-1">Services (inclus dans ventes)</div><div className="font-price font-bold text-sm text-cyan-800">{formatPrice(summary.services.total)}</div><div className="text-xs text-cyan-600">{summary.services.count} service(s)</div></div>}
                {(summary.creditsPercus?.total ?? 0) > 0 && (
                  <div className="bg-orange-50 border border-orange-200 rounded-xl p-3">
                    <div className="flex items-center gap-1 text-xs text-orange-700 font-semibold mb-1">
                      <CreditCard size={11} /> Paiements crédit
                    </div>
                    <div className="font-price font-bold text-sm text-orange-800">{formatPrice(summary.creditsPercus.total)}</div>
                    <div className="text-xs text-orange-600">{summary.creditsPercus.count} paiement{summary.creditsPercus.count > 1 ? 's' : ''}</div>
                  </div>
                )}
                {(summary.avancesClients?.total ?? 0) > 0 && <div className="bg-violet-50 border border-violet-200 rounded-xl p-3"><div className="text-xs text-violet-700 font-semibold mb-1">Avances clients</div><div className="font-price font-bold text-sm text-violet-800">{formatPrice(summary.avancesClients.total)}</div><div className="text-xs text-violet-600">{summary.avancesClients.count} avance(s)</div></div>}
                {(summary.echanges?.entrees ?? 0) > 0 && <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3"><div className="flex items-center gap-1 text-xs text-emerald-700 font-semibold mb-1"><ArrowUpCircle size={11} /> Suppléments échanges</div><div className="font-price font-bold text-sm text-emerald-800">+{formatPrice(summary.echanges.entrees)}</div></div>}
                {(summary.echanges?.sorties ?? 0) > 0 && <div className="bg-rose-50 border border-rose-200 rounded-xl p-3"><div className="flex items-center gap-1 text-xs text-rose-700 font-semibold mb-1"><RefreshCw size={11} /> Remboursements échanges</div><div className="font-price font-bold text-sm text-rose-800">-{formatPrice(summary.echanges.sorties)}</div></div>}
                <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                  <div className="flex items-center gap-1 text-xs text-red-700 font-semibold mb-1">
                    <ArrowDownCircle size={11} /> Sorties
                  </div>
                  <div className="font-price font-bold text-sm text-red-800">-{formatPrice(summary.sorties.total)}</div>
                  <div className="text-xs text-red-600">{summary.sorties.count} sortie{summary.sorties.count > 1 ? 's' : ''}</div>
                </div>
              </div>

              {/* Par mode */}
              {summary.parMode.length > 0 && (
                <div className="bg-muted rounded-xl p-3">
                  <div className="text-xs font-semibold text-text-secondary mb-2">Ventes par mode de paiement</div>
                  <div className="space-y-1">
                    {summary.parMode.map(m => (
                      <div key={m.mode_paiement} className="flex justify-between text-xs">
                        <span className="text-text-secondary">{MODE_LABELS[m.mode_paiement] || m.mode_paiement}</span>
                        <span className="font-price font-semibold">{formatPrice(m.total)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Solde théorique */}
              <div className="bg-accent-50 border border-accent-400 rounded-xl p-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
                    <DollarSign size={14} />
                    Résultat du rapport (hors fond)
                  </span>
                  <span className="font-price font-bold text-lg text-text-primary">{formatPrice(reportNet)}</span>
                </div>
                <div className="text-xs text-text-secondary mt-1">
                  Entrées (ventes, réparations, crédits, avances, suppléments d’échange) − sorties. Le fond initial est toujours exclu du rapport.
                </div>
              </div>
            </div>
          )}

          {summary && (
            <div className="lg:col-start-2 lg:col-span-1 lg:row-span-3 border border-border rounded-2xl overflow-hidden bg-white shadow-sm">
              <div className="flex items-center justify-between gap-3 px-4 py-3 bg-muted">
                <div><h3 className="text-sm font-bold">Opérations détaillées du shift</h3><p className="text-xs text-text-secondary">Toutes les entrées et sorties, avec l’utilisateur responsable.</p></div>
                <div className="flex gap-4 text-xs"><span className="text-green-700 font-semibold">Entrées {formatPrice(summary.moneyIn)}</span><span className="text-red-700 font-semibold">Sorties {formatPrice(summary.moneyOut)}</span></div>
              </div>
              <div className="max-h-56 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-white border-b border-border"><tr><th className="text-left p-2">Heure</th><th className="text-left p-2">Opération</th><th className="text-left p-2">Utilisateur</th><th className="text-right p-2">Entrée</th><th className="text-right p-2">Sortie</th><th className="text-left p-2">Détail</th></tr></thead>
                  <tbody>{summary.operations.length ? summary.operations.map(operation => <tr key={operation.id} className="border-b border-border/60"><td className="p-2 whitespace-nowrap">{new Date(operation.date).toLocaleTimeString('fr-TN', { hour: '2-digit', minute: '2-digit' })}</td><td className="p-2 font-medium">{operation.type}</td><td className="p-2">{operation.operator}</td><td className="p-2 text-right font-price text-green-700">{operation.direction === 'ENTREE' ? formatPrice(operation.amount) : '—'}</td><td className="p-2 text-right font-price text-red-700">{operation.direction === 'SORTIE' ? formatPrice(operation.amount) : '—'}</td><td className="p-2 text-text-secondary">{operation.note}</td></tr>) : <tr><td colSpan={6} className="p-5 text-center text-text-muted">Aucune opération</td></tr>}</tbody>
                </table>
              </div>
            </div>
          )}

          {/* Solde réel */}
          <div className="lg:col-start-1 rounded-xl border border-border bg-white p-4 shadow-sm">
            <label className="block text-xs font-semibold text-text-secondary mb-1.5">
              Solde réel compté (optionnel)
            </label>
            <div className="flex items-center gap-2 border border-border rounded-xl px-4 py-3 focus-within:border-accent-500">
              <input
                type="text"
                inputMode="decimal"
                value={soldeCaisse}
                onChange={e => setSoldeCaisse(e.target.value.replace(/[^0-9.,]/g, ''))}
                className="flex-1 bg-transparent font-price text-base font-semibold outline-none"
                placeholder={drawerExpected.toFixed(3)}
              />
              <span className="text-text-secondary font-medium">DT</span>
            </div>
            <p className="mt-1.5 text-[10px] text-text-muted">Comptez tout le tiroir, fonds inclus. Le rapport soustrait automatiquement le fond de {formatPrice(currentShift.fond_de_caisse)}.</p>
            {ecart !== null && (
              <div className={`mt-2 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold ${
                Math.abs(ecart) < 0.001
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : ecart > 0
                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
              }`}>
                {Math.abs(ecart) < 0.001 ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                Écart : {ecart >= 0 ? '+' : ''}{formatPrice(ecart)}
                {Math.abs(ecart) < 0.001 && ' — Parfait !'}
                {ecart > 0.001 && ' — Excédent'}
                {ecart < -0.001 && ' — Manque'}
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="lg:col-start-1 rounded-xl border border-border bg-white p-4 shadow-sm">
            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Notes de clôture (optionnel)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full border border-border rounded-xl px-4 py-3 text-sm h-16 resize-none"
              placeholder="Remarques, incidents..."
            />
          </div>

          {/* Confirmation warning */}
          {confirmed && (
            <div className="lg:col-start-1 flex items-center gap-2 p-3 bg-orange-50 border border-orange-200 rounded-lg text-sm text-orange-800">
              <AlertCircle size={14} />
              Confirmez la fermeture de caisse. Cette action ne peut pas être annulée.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 flex gap-3 px-4 sm:px-6 py-3.5 border-t border-border bg-white shadow-[0_-8px_24px_rgba(0,0,0,0.04)]">
          {!confirmed ? (
            <>
              <button
                onClick={onClose}
                className="flex-1 bg-muted hover:bg-border text-text-primary font-semibold py-2.5 rounded-xl transition-colors text-sm"
              >
                Annuler
              </button>
              <button
                onClick={handleClose}
                disabled={loadingSummary}
                className="flex-1 bg-danger hover:bg-red-700 disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold py-2.5 rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
              >
                <LogOut size={15} />
                Fermer la Caisse
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setConfirmed(false)}
                disabled={loading}
                className="flex-1 bg-muted hover:bg-border text-text-primary font-semibold py-2.5 rounded-xl transition-colors text-sm"
              >
                Retour
              </button>
              <button
                onClick={handleClose}
                disabled={loading}
                className="flex-1 bg-danger hover:bg-red-700 disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold py-2.5 rounded-xl transition-colors text-sm"
              >
                {loading ? 'Clôture...' : 'Confirmer la Fermeture'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

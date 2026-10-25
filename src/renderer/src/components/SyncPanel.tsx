import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Wifi, WifiOff, Monitor, ShieldCheck, Upload, Pause, Play, AlertTriangle, FileDown, RefreshCw, CheckCircle2, Loader2 } from 'lucide-react'
import type { SeedApi, SeedPanelStatus, SeedRejectedOp, SeedResult } from '../lib/seedTypes'
import LiveSyncStatus from './LiveSyncStatus'

const api = window.api as unknown as SeedApi

const fmtTnd = (millimes: number) => (millimes / 1000).toLocaleString('fr-TN', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
const fmtBytes = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} Mo` : `${Math.round(n / 1024)} Ko`)
const ago = (iso: string | null) => {
  if (!iso) return 'jamais'
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
  if (s < 60) return `il y a ${s} s`
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`
  return `il y a ${Math.round(s / 86400)} j`
}

const STATE_LABEL: Record<string, string> = {
  idle: 'Non démarré', backup_ok: 'Sauvegarde vérifiée', checked: 'Vérifications OK — en attente de confirmation',
  blocked: 'Bloqué — corrections nécessaires', approved: 'Confirmé — prêt à envoyer', running: 'Envoi en cours',
  paused: 'En pause', finalizing: 'Contrôle final', done: 'Terminé', needs_review: 'Terminé — à vérifier', failed: 'Arrêté (erreur)',
}

export default function SyncPanel({ onClose }: { onClose: () => void }) {
  const [st, setSt] = useState<SeedPanelStatus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [phrase, setPhrase] = useState('')
  const [form, setForm] = useState({ url: '', token: '', name: '' })
  const [rejected, setRejected] = useState<SeedRejectedOp[] | null>(null)
  const alive = useRef(true)

  const refresh = useCallback(async (force = false) => {
    const r = await api.seedStatus(force)
    if (!alive.current) return
    if (r.ok) setSt(r.data)
    else setErr(r.error)
  }, [])

  useEffect(() => {
    alive.current = true
    refresh(true)
    const t = setInterval(() => refresh(false), 3000)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { alive.current = false; clearInterval(t); window.removeEventListener('keydown', onKey) }
  }, [refresh, onClose])

  const act = async <T,>(label: string, fn: () => Promise<SeedResult<T>>) => {
    setBusy(label); setErr(null)
    try {
      const r = await fn()
      if (!r.ok) setErr(r.error)
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
      refresh(true)
    }
  }

  const seed = st?.seed
  const report = seed?.report ?? null
  const running = seed?.state === 'running' || seed?.state === 'finalizing'
  const pct = seed && seed.progress.total > 0 ? Math.min(100, Math.round((seed.progress.sent / seed.progress.total) * 100)) : 0
  const online = st?.connection === 'online'
  const needsRegistration = st?.connection === 'unconfigured' || st?.connection === 'unregistered' || st?.connection === 'auth_failed'

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[210] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h3 className="font-bold text-sm flex items-center gap-2">
            {online ? <Wifi size={14} className="text-success" /> : <WifiOff size={14} className="text-warning" />}
            Synchronisation multi-postes
          </h3>
          <button onClick={onClose} aria-label="Fermer"><X size={16} className="text-text-muted" /></button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-5 text-xs">
          {err && (
            <div className="rounded-lg border border-red-300 bg-red-50 text-red-800 px-3 py-2 flex gap-2">
              <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" /><span>{err}</span>
            </div>
          )}
          {!st && <div className="flex items-center gap-2 text-text-muted"><Loader2 size={13} className="animate-spin" /> Chargement…</div>}

          {st && (
            <>
              <LiveSyncStatus live={st.live} busy={!!busy} act={act} />
              {/* ── Connexion ── */}
              <section>
                <h4 className="font-bold mb-2">1. Connexion au serveur</h4>
                {needsRegistration ? (
                  <div className="grid gap-2 max-w-md">
                    {st.connection === 'auth_failed' && <p className="text-danger">Ce poste n'est plus autorisé. Enregistrez-le à nouveau.</p>}
                    <input className="border border-border rounded-lg px-3 py-2" placeholder="https://sync.exemple.com" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} />
                    <input className="border border-border rounded-lg px-3 py-2" placeholder="Jeton d'enregistrement" type="password" autoComplete="off" value={form.token} onChange={e => setForm({ ...form, token: e.target.value })} />
                    <input className="border border-border rounded-lg px-3 py-2" placeholder="Nom de ce poste (ex. PC Caisse 1)" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                    <button
                      disabled={!!busy || !form.url || !form.token || !form.name}
                      onClick={() => act('register', async () => { const r = await api.seedRegister(form.url, form.token, form.name); if (r.ok) setForm({ url: '', token: '', name: '' }); return r })}
                      className="px-3 py-2 rounded-lg bg-teal-600 text-white font-semibold disabled:opacity-50"
                    >
                      {busy === 'register' ? 'Enregistrement…' : 'Enregistrer ce poste'}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block w-2 h-2 rounded-full ${online ? 'bg-green-500' : 'bg-orange-500'}`} />
                      <strong>{online ? 'Connecté' : 'Serveur injoignable'}</strong>
                      <span className="text-text-muted">{st.baseUrl}</span>
                    </div>
                    <div className="text-text-muted">Poste : <strong>{st.deviceName}</strong></div>
                    {st.connectionError && <div className="text-warning">{st.connectionError}</div>}
                    {!st.sessionPersisted && <div className="text-warning">Le chiffrement du système n'est pas disponible : la session sera perdue à la fermeture de l'application.</div>}
                  </div>
                )}
              </section>

              {/* ── Postes ── */}
              <section>
                <h4 className="font-bold mb-2">Postes connectés</h4>
                {st.server?.devices?.length ? (
                  <div className="border border-border rounded-lg divide-y divide-border">
                    {st.server.devices.map(d => (
                      <div key={d.device_id} className="flex items-center gap-3 px-3 py-2">
                        <Monitor size={13} className="text-text-muted" />
                        <span className={`inline-block w-2 h-2 rounded-full ${d.online ? 'bg-green-500' : 'bg-gray-300'}`} />
                        <strong className="flex-1 truncate">{d.name}{d.device_id === st.deviceId ? ' (ce poste)' : ''}</strong>
                        <span className="text-text-muted">{d.platform}{d.app_version ? ` · v${d.app_version}` : ''}</span>
                        <span className="text-text-muted w-24 text-right">{d.online ? 'en ligne' : ago(d.last_seen_at)}</span>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-text-muted">{online ? 'Aucun autre poste enregistré.' : 'Disponible une fois connecté.'}</p>}
                <p className="text-text-muted mt-2">
                  File Supabase conservée : {st.legacyQueue.pending} en attente, {st.legacyQueue.failed} en erreur. {st.live.backend === 'vps' ? 'Connexion Supabase désactivée.' : 'Connexion actuelle active.'}
                </p>
              </section>

              {/* ── Données (seed) ── */}
              <section>
                <h4 className="font-bold mb-1">2. Envoi des données de ce poste (poste principal)</h4>
                <p className="text-text-muted mb-2">
                  État : <strong>{STATE_LABEL[seed!.state] ?? seed!.state}</strong>
                  {seed!.message ? ` — ${seed!.message}` : ''}
                </p>
                <p className="text-text-muted mb-3">
                  Démarrage initial manuel : sauvegarde vérifiée → contrôles → résumé → confirmation → envoi. Ensuite, les changements sont synchronisés automatiquement.
                  La sauvegarde est vérifiée avant l'installation du suivi des changements.
                </p>

                <div className="flex flex-wrap gap-2 mb-3">
                  <button
                    disabled={!!busy || running}
                    onClick={() => act('check', () => api.seedBackupAndCheck())}
                    className="px-3 py-2 rounded-lg border border-border font-semibold flex items-center gap-2 disabled:opacity-50"
                  >
                    {busy === 'check' ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />}
                    Sauvegarder et vérifier
                  </button>
                  {seed!.backup?.ok && (
                    <button disabled={!!busy || running} onClick={() => act('recheck', () => api.seedRecheck())} className="px-3 py-2 rounded-lg border border-border flex items-center gap-2 disabled:opacity-50">
                      <RefreshCw size={12} /> Relancer les contrôles
                    </button>
                  )}
                  {report && (
                    <button onClick={() => act('export', () => api.seedExportReport())} className="px-3 py-2 rounded-lg border border-border flex items-center gap-2">
                      <FileDown size={12} /> Exporter le rapport
                    </button>
                  )}
                </div>

                {seed!.backup && (
                  <div className={`rounded-lg border px-3 py-2 mb-3 ${seed!.backup.ok ? 'border-green-300 bg-green-50' : 'border-red-300 bg-red-50'}`}>
                    <div className="font-semibold flex items-center gap-1.5">
                      {seed!.backup.ok ? <CheckCircle2 size={12} className="text-green-700" /> : <AlertTriangle size={12} className="text-red-700" />}
                      Sauvegarde {seed!.backup.ok ? 'vérifiée' : 'invalide'} · {fmtBytes(seed!.backup.bytes)}
                    </div>
                    <div className="text-text-muted break-all">{seed!.backup.path}</div>
                    <div className="text-text-muted font-mono">sha256 {seed!.backup.sha256.slice(0, 16)}…</div>
                    {seed!.backup.problems.length > 0 && <div className="text-danger">{seed!.backup.problems.join(', ')}</div>}
                  </div>
                )}

                {report && (
                  <>
                    {report.blockers.length > 0 && (
                      <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 mb-3">
                        <div className="font-semibold text-red-800 mb-1">Bloquant ({report.blockers.length})</div>
                        {report.blockers.map((b, i) => (
                          <div key={i}><strong>{b.table}</strong> · {b.code}{b.column ? ` (${b.column})` : ''} × {b.count} <span className="text-text-muted">{b.samples[0]}</span></div>
                        ))}
                      </div>
                    )}
                    {report.warnings.length > 0 && (
                      <details className="rounded-lg border border-orange-300 bg-orange-50 px-3 py-2 mb-3">
                        <summary className="font-semibold text-orange-800 cursor-pointer">Avertissements ({report.warnings.length})</summary>
                        {report.warnings.map((w, i) => (
                          <div key={i}><strong>{w.table}</strong> · {w.code}{w.column ? ` (${w.column})` : ''} × {w.count} <span className="text-text-muted">{w.samples[0]}</span></div>
                        ))}
                      </details>
                    )}
                    {report.notes.map((n, i) => <p key={i} className="text-text-muted mb-1">{n}</p>)}

                    <div className="border border-border rounded-lg overflow-hidden mb-3">
                      <table className="w-full">
                        <thead className="bg-muted text-left">
                          <tr><th className="px-3 py-1.5">Table</th><th className="px-3 py-1.5 text-right">Lignes</th><th className="px-3 py-1.5 text-right">À envoyer</th><th className="px-3 py-1.5 text-right">Totaux par champ (TND)</th></tr>
                        </thead>
                        <tbody>
                          {report.tables.filter(t => t.rows > 0).map(t => {
                            return (
                              <tr key={t.name} className="border-t border-border">
                                <td className="px-3 py-1">{t.name}</td>
                                <td className="px-3 py-1 text-right">{t.rows}</td>
                                <td className="px-3 py-1 text-right">{t.seedable}</td>
                                <td className="px-3 py-1 text-right font-price">{Object.entries(t.moneySumsMillimes).map(([field, sum]) => <div key={field}>{field}: {fmtTnd(sum)}</div>)}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                {seed!.canApprove && (
                  <div className="rounded-lg border border-teal-300 bg-teal-50 px-3 py-3 mb-3">
                    <p className="mb-2">Les contrôles sont passés. Pour autoriser l'envoi vers le serveur, tapez <strong>SEED</strong>.</p>
                    <div className="flex gap-2">
                      <input className="border border-border rounded-lg px-3 py-2 w-32 font-mono" value={phrase} onChange={e => setPhrase(e.target.value)} placeholder="SEED" />
                      <button
                        disabled={!!busy || phrase.trim() !== 'SEED'}
                        onClick={() => act('approve', async () => { const r = await api.seedApprove(phrase); if (r.ok) setPhrase(''); return r })}
                        className="px-3 py-2 rounded-lg bg-teal-600 text-white font-semibold disabled:opacity-50"
                      >
                        {busy === 'approve' ? 'Vérification…' : 'Confirmer'}
                      </button>
                    </div>
                  </div>
                )}

                {(seed!.canRun || running) && (
                  <div className="space-y-2 mb-3">
                    {running ? (
                      <>
                        <div className="flex items-center justify-between">
                          <span>{seed!.state === 'finalizing' ? 'Contrôle final…' : `${seed!.progress.table ?? '…'} (${seed!.progress.tableIndex}/${seed!.progress.tableCount})`}</span>
                          <span className="font-price">{seed!.progress.sent}/{seed!.progress.total}</span>
                        </div>
                        <div className="h-2 rounded bg-gray-200 overflow-hidden"><div className="h-full bg-teal-600 transition-all" style={{ width: `${pct}%` }} /></div>
                        <button onClick={() => act('pause', () => api.seedPause())} className="px-3 py-2 rounded-lg border border-border flex items-center gap-2"><Pause size={12} /> Mettre en pause</button>
                      </>
                    ) : (
                      <button disabled={!!busy} onClick={() => act('run', () => api.seedRun())} className="px-3 py-2 rounded-lg bg-teal-600 text-white font-semibold flex items-center gap-2 disabled:opacity-50">
                        {seed!.state === 'approved' ? <Upload size={12} /> : <Play size={12} />}
                        {seed!.state === 'approved' ? 'Démarrer l\'envoi' : 'Reprendre l\'envoi'}
                      </button>
                    )}
                    <p className="text-text-muted">{seed!.ackedRows} ligne(s) confirmées par le serveur sur {seed!.totalRows}. Une coupure ne perd rien : la reprise continue où elle s'est arrêtée.</p>
                  </div>
                )}

                {(seed!.state === 'done' || seed!.state === 'needs_review') && (
                  <button onClick={() => act('newpass', () => api.seedNewPass())} className="px-3 py-2 rounded-lg border border-border">
                    Nouvelle passe (n'enverra que les lignes modifiées)
                  </button>
                )}
              </section>

              {/* ── Opérations rejetées ── */}
              <section>
                <h4 className="font-bold mb-2">Opérations rejetées ({seed!.rejectedCount})</h4>
                {seed!.rejectedCount === 0 ? <p className="text-text-muted">Aucune.</p> : (
                  <>
                    <button onClick={async () => { const r = await api.seedRejected(); if (r.ok) setRejected(r.data) }} className="px-3 py-1.5 rounded-lg border border-border mb-2">
                      Afficher le détail
                    </button>
                    {rejected && (
                      <div className="border border-border rounded-lg max-h-48 overflow-y-auto divide-y divide-border">
                        {rejected.map(r => (
                          <div key={r.op_id} className="px-3 py-1.5"><strong>{r.table_name}</strong> · {r.pk} · <span className="text-danger">{r.code}</span> <span className="text-text-muted">{r.message}</span></div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

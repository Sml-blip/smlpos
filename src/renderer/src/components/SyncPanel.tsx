import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Wifi, WifiOff, Monitor, ShieldCheck, Upload, Pause, Play, AlertTriangle, FileDown, RefreshCw, CheckCircle2, Loader2 } from 'lucide-react'
import type { SeedApi, SeedPanelStatus, SeedRejectedOp, SeedResult } from '../lib/seedTypes'
import LiveSyncStatus from './LiveSyncStatus'
import { friendlySyncError } from '../lib/syncErrors'

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

type JoinStage = 'credentials' | 'waiting-seed' | 'preparing' | 'downloading' | 'verifying' | 'ready' | 'error'

export default function SyncPanel({ onClose, mode = 'manage' }: { onClose: () => void; mode?: 'manage' | 'join' }) {
  const firstTouch = mode === 'join'
  const [st, setSt] = useState<SeedPanelStatus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [phrase, setPhrase] = useState('')
  const [joinPhrase, setJoinPhrase] = useState('')
  const [form, setForm] = useState({ url: 'https://api.pos.sml.boutique', username: '', password: '', name: 'PC Caisse 2' })
  const [joinStage, setJoinStage] = useState<JoinStage>('credentials')
  const [rejected, setRejected] = useState<SeedRejectedOp[] | null>(null)
  const alive = useRef(true)
  const joinStarted = useRef(false)

  const refresh = useCallback(async (force = false) => {
    const r = await api.seedStatus(force)
    if (!alive.current) return
    if (r.ok) setSt(r.data)
    else setErr(friendlySyncError(r.error))
  }, [])

  const beginJoin = useCallback(async () => {
    if (joinStarted.current) return
    joinStarted.current = true
    setBusy('prepare-replica'); setErr(null); setJoinStage('preparing')
    try {
      const prepared = await api.sync2PrepareReplica('JOIN')
      if (!prepared.ok) throw new Error(prepared.error)
      setJoinStage('downloading'); setBusy('join-replica')
      const started = await api.sync2JoinReplica()
      if (!started.ok) throw new Error(started.error)
      await refresh(true)
    } catch (error) {
      joinStarted.current = false
      setJoinStage('error')
      setErr(friendlySyncError(error instanceof Error ? error.message : String(error)))
      await refresh(true)
    } finally { setBusy(null) }
  }, [refresh])

  useEffect(() => {
    alive.current = true
    refresh(true)
    const t = setInterval(() => refresh(false), 3000)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { alive.current = false; clearInterval(t); window.removeEventListener('keydown', onKey) }
  }, [refresh, onClose])

  useEffect(() => {
    if (!firstTouch || !st) return
    if (st.live.bootstrapState === 'complete' && st.live.enabled) {
      setJoinStage('ready')
      return
    }
    if (st.live.bootstrapState === 'review' || st.live.bootstrapState === 'error') {
      joinStarted.current = false
      setJoinStage('error')
      setErr(friendlySyncError(st.live.pullError || 'La vérification initiale demande une correction.'))
      return
    }
    if (st.live.bootstrapState === 'verifying') setJoinStage('verifying')
    else if (st.live.joining && st.live.bootstrapState === 'downloading') setJoinStage('downloading')
    if (st.connection === 'online' && st.server?.seed.state === 'seeded' && !st.live.enabled && !joinStarted.current && joinStage !== 'error') void beginJoin()
    else if (!needsRegistration && st.connection === 'online' && st.server?.seed.state !== 'seeded' && joinStage === 'credentials') setJoinStage('waiting-seed')
  }, [beginJoin, firstTouch, joinStage, st])

  useEffect(() => {
    if (!firstTouch || joinStage !== 'ready') return
    const timer = window.setTimeout(() => window.location.reload(), 1400)
    return () => window.clearTimeout(timer)
  }, [firstTouch, joinStage])

  const registerForJoin = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy('register'); setErr(null); joinStarted.current = false
    const result = await api.seedRegister(form.url, form.username, form.password, form.name)
    if (!result.ok) {
      setErr(friendlySyncError(result.error)); setBusy(null); return
    }
    setForm(current => ({ ...current, password: '' }))
    setJoinStage('waiting-seed'); setBusy(null)
    await refresh(true)
  }

  const retryJoin = async () => {
    if (st?.live.joining) {
      joinStarted.current = true; setJoinStage('downloading'); setBusy('join-replica'); setErr(null)
      const resumed = await api.sync2JoinReplica()
      if (!resumed.ok) { joinStarted.current = false; setJoinStage('error'); setErr(friendlySyncError(resumed.error)) }
      setBusy(null); await refresh(true)
      return
    }
    joinStarted.current = false
    if (st?.server?.seed.state === 'seeded') void beginJoin()
    else { setJoinStage('waiting-seed'); setErr(null); await refresh(true) }
  }

  const act = async <T,>(label: string, fn: () => Promise<SeedResult<T>>) => {
    setBusy(label); setErr(null)
    try {
      const r = await fn()
      if (!r.ok) setErr(friendlySyncError(r.error))
    } catch (error) {
      setErr(friendlySyncError(error instanceof Error ? error.message : String(error)))
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
  const replica = online && st?.server?.seed.state === 'seeded' && !st.live.enabled
  const needsRegistration = st?.connection === 'unconfigured' || st?.connection === 'unregistered' || st?.connection === 'auth_failed'
  const joinStep = joinStage === 'credentials' ? 0 : joinStage === 'waiting-seed' || joinStage === 'preparing' ? 1 : joinStage === 'downloading' ? 2 : 3

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[210] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h3 className="font-bold text-sm flex items-center gap-2">
            {online ? <Wifi size={14} className="text-success" /> : <WifiOff size={14} className="text-warning" />}
            {firstTouch ? 'Rejoindre une entreprise' : 'Synchronisation multi-postes'}
          </h3>
          <button onClick={onClose} aria-label="Fermer"><X size={16} className="text-text-muted" /></button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-5 text-xs">
          {err && !firstTouch && (
            <div className="rounded-lg border border-red-300 bg-red-50 text-red-800 px-3 py-2 flex gap-2">
              <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" /><span>{err}</span>
            </div>
          )}
          {!st && <div className="flex items-center gap-2 text-text-muted"><Loader2 size={13} className="animate-spin" /> Chargement…</div>}

          {st && (
            <>
              {firstTouch ? (
                <section className="mx-auto max-w-xl space-y-5 py-2 text-sm">
                  <div className="rounded-2xl border border-teal-200 bg-gradient-to-br from-teal-50 to-white p-5">
                    <h2 className="text-xl font-bold text-slate-900">Ce PC va recevoir les données de l’entreprise</h2>
                    <p className="mt-2 text-slate-600">Connectez-vous avec le compte remis par l’administrateur. Les ventes, les produits et les soldes seront téléchargés avant l’ouverture de la caisse.</p>
                  </div>
                  {st.connection === 'offline' && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{friendlySyncError(st.connectionError || 'Serveur injoignable')}</p>}
                  <ol className="grid grid-cols-4 gap-2 text-center text-[11px]">
                    {['Connexion', 'Données prêtes', 'Téléchargement', 'Vérification'].map((step, index) => <li key={step} className={`rounded-xl border px-2 py-2 font-semibold ${index < joinStep || joinStage === 'ready' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : index === joinStep ? 'border-teal-400 bg-teal-50 text-teal-900' : 'border-border text-text-muted'}`}>
                      <span className="block">{index < joinStep || joinStage === 'ready' ? '✓' : index + 1}</span>{step}
                    </li>)}
                  </ol>

                  {needsRegistration && joinStage === 'credentials' && <form onSubmit={registerForJoin} className="space-y-3 rounded-2xl border border-border bg-white p-5 shadow-sm">
                    <label className="block font-semibold">Adresse du serveur<input type="url" autoComplete="url" required value={form.url} onChange={event => setForm({ ...form, url: event.target.value })} className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 font-normal" /></label>
                    <label className="block font-semibold">Nom d’utilisateur<input autoComplete="username" required maxLength={80} value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 font-normal" /></label>
                    <label className="block font-semibold">Mot de passe<input type="password" autoComplete="current-password" required maxLength={256} value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 font-normal" /></label>
                    <label className="block font-semibold">Nom de ce poste<input autoComplete="organization-title" required maxLength={80} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 font-normal" /></label>
                    {st.connection === 'auth_failed' && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{friendlySyncError(st.connectionError || 'DEVICE_REVOKED')}</p>}
                    <p className="text-xs text-text-muted">L’inscription est limitée à 3 appareils actifs. Une sauvegarde de protection sera créée avant le téléchargement.</p>
                    {err && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p>}
                    <button type="submit" disabled={!!busy || !form.username.trim() || !form.password || !form.name.trim()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-3 font-bold text-white shadow-sm hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50">
                      {busy === 'register' ? <><Loader2 size={16} className="animate-spin"/>Connexion au serveur…</> : 'Se connecter et recevoir les données'}
                    </button>
                  </form>}

                  {joinStage === 'waiting-seed' && <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-blue-950" role="status" aria-live="polite">
                    <p className="flex items-center gap-2 font-bold"><Loader2 size={17} className="animate-spin"/>Compte accepté · attente des données du PC principal</p>
                    <p className="mt-2">L’administrateur doit terminer la préparation initiale. Cette fenêtre vérifiera automatiquement quand les données seront prêtes.</p>
                    {st.connection !== 'online' && <p className="mt-2 text-sm text-amber-900">{friendlySyncError(st.connectionError || 'Serveur injoignable')}</p>}
                    {err && <p className="mt-2 text-sm text-red-800">{err}</p>}
                    <button type="button" disabled={!!busy} onClick={() => void refresh(true)} className="mt-3 rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm font-semibold">Vérifier maintenant</button>
                  </div>}

                  {(joinStage === 'preparing' || joinStage === 'downloading' || joinStage === 'verifying') && <div className="rounded-2xl border border-teal-200 bg-teal-50 p-5" role="status" aria-live="polite">
                    <p className="flex items-center gap-2 font-bold text-teal-950"><Loader2 size={17} className="animate-spin"/>{joinStage === 'preparing' ? 'Protection de ce PC…' : joinStage === 'verifying' ? 'Vérification des données reçues…' : 'Téléchargement des données de l’entreprise…'}</p>
                    {joinStage === 'preparing' && <p className="mt-2 text-sm text-teal-900">Création et contrôle d’une sauvegarde locale, puis préparation d’une base vide. Si ce PC contient déjà un historique, la jonction sera arrêtée sans effacer ses données.</p>}
                    {joinStage === 'downloading' && <p className="mt-2 text-sm text-teal-900">{st.live.bootstrapRows.toLocaleString('fr-TN')} événements reçus · {st.live.bootstrapPages} pages. La caisse reste verrouillée jusqu’au contrôle final.</p>}
                    {joinStage === 'verifying' && <p className="mt-2 text-sm text-teal-900">Comparaison des lignes et de chaque total monétaire avec le serveur. Le POS ne s’ouvrira qu’après réussite.</p>}
                    {err && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-red-800">{err}</p>}
                  </div>}

                  {joinStage === 'ready' && <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-5 text-emerald-950" role="status" aria-live="polite">
                    <p className="flex items-center gap-2 text-lg font-bold"><CheckCircle2 size={20}/>Données reçues et vérifiées</p>
                    {st.live.bootstrapVerification && <p className="mt-2">{st.live.bootstrapVerification.tables.toLocaleString('fr-TN')} tables · {st.live.bootstrapVerification.rows.toLocaleString('fr-TN')} lignes · {st.live.bootstrapVerification.moneyFields.toLocaleString('fr-TN')} totaux monétaires contrôlés.</p>}
                    <p className="mt-2 text-sm">Ouverture de l’écran de caisse…</p>
                    <button type="button" onClick={() => window.location.reload()} className="mt-3 rounded-lg bg-emerald-700 px-4 py-2 font-bold text-white">Continuer vers le POS</button>
                  </div>}

                  {joinStage === 'error' && <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-950" role="alert">
                    <p className="flex items-center gap-2 font-bold"><AlertTriangle size={17}/>La jonction n’est pas terminée</p>
                    <p className="mt-2">{err || 'Une étape doit être reprise.'}</p>
                    <button type="button" disabled={!!busy} onClick={() => void retryJoin()} className="mt-3 rounded-lg bg-red-700 px-4 py-2 font-bold text-white disabled:opacity-50">Réessayer</button>
                  </div>}

                  {st.live.joining && joinStage === 'credentials' && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" role="status">
                    <p className="font-bold">Une réception précédente peut être reprise.</p>
                    <button type="button" disabled={!!busy} onClick={() => void retryJoin()} className="mt-2 rounded-lg border border-amber-300 bg-white px-3 py-2 font-semibold">Reprendre le téléchargement</button>
                  </div>}
                </section>
              ) : <>
              <LiveSyncStatus live={st.live} connection={st.connection} busy={!!busy} act={act} />
              {/* ── Connexion ── */}
              <section>
                <h4 className="font-bold mb-2">1. Rejoindre une entreprise</h4>
                {needsRegistration ? (
                  <div className="grid gap-2 max-w-md">
                    {st.connection === 'auth_failed' && <p className="text-danger">Ce poste n'est plus autorisé. Enregistrez-le à nouveau.</p>}
                    <label className="grid gap-1 font-semibold">Adresse du serveur<input type="url" autoComplete="url" required className="border border-border rounded-lg px-3 py-2 font-normal" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} /></label>
                    <label className="grid gap-1 font-semibold">Nom d'utilisateur<input className="border border-border rounded-lg px-3 py-2 font-normal" placeholder="Compte fourni par l’administrateur" autoComplete="username" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} /></label>
                    <label className="grid gap-1 font-semibold">Mot de passe<input className="border border-border rounded-lg px-3 py-2 font-normal" type="password" autoComplete="current-password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></label>
                    <label className="grid gap-1 font-semibold">Nom de ce poste<input className="border border-border rounded-lg px-3 py-2 font-normal" placeholder="Ex. PC Caisse 2" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
                    <button
                      disabled={!!busy || !form.url || !form.username || !form.password || !form.name}
                      onClick={() => act('register', async () => { const r = await api.seedRegister(form.url, form.username, form.password, form.name); if (r.ok) setForm({ url: '', username: '', password: '', name: '' }); return r })}
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
                    {st.connectionError && <div className="text-warning">{friendlySyncError(st.connectionError)}</div>}
                    {!st.sessionPersisted && <div className="text-warning">Le chiffrement du système n'est pas disponible : la session sera perdue à la fermeture de l'application.</div>}
                  </div>
                )}
              </section>

              {/* ── Postes ── */}
              <section>
                <h4 className="font-bold mb-2">Appareils connectés à l’entreprise</h4>
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
                {st.legacyQueue.pending + st.legacyQueue.failed > 0 && <details className="mt-2 text-text-muted">
                  <summary className="cursor-pointer">Ancienne file locale : {st.legacyQueue.pending} en attente, {st.legacyQueue.failed} en erreur</summary>
                  <p className="mt-1">Ces éléments appartiennent à l’ancien mécanisme de synchronisation. Ils ne sont pas envoyés au serveur SMLPOS.</p>
                </details>}
              </section>

              {replica && <section className="border border-border rounded-lg p-3 space-y-2">
                <h4 className="font-bold">Poste secondaire</h4>
                <p>Une sauvegarde vérifiée conserve le catalogue initial. Un poste contenant des ventes ou un historique métier ne sera pas effacé. Les écritures métier sont verrouillées pendant la réception.</p>
                {!st.live.joining && !st.live.enabled && <div className="flex gap-2">
                  <input aria-label="Confirmation de préparation du poste secondaire" className="border rounded px-2 py-1 w-24" placeholder="JOIN" value={joinPhrase} onChange={event => setJoinPhrase(event.target.value)} />
                  <button disabled={!!busy || joinPhrase !== 'JOIN'} onClick={() => act('prepare-replica', () => api.sync2PrepareReplica(joinPhrase))} className="border rounded px-2 py-1 disabled:opacity-50">Sauvegarder et préparer ce poste</button>
                </div>}
                {st.live.joining && <button disabled={!!busy} onClick={() => act('join-replica', () => api.sync2JoinReplica())} className="border rounded px-2 py-1">Recevoir / reprendre les données du serveur</button>}
                {st.live.enabled && <p className="text-green-700">Réception initiale terminée. Synchronisation continue active.</p>}
              </section>}
              {/* ── Données (seed) ── */}
              {!replica && <section>
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
                    disabled={!!busy || running || st.live.enabled}
                    onClick={() => act('check', () => api.seedBackupAndCheck())}
                    className="px-3 py-2 rounded-lg border border-border font-semibold flex items-center gap-2 disabled:opacity-50"
                  >
                    {busy === 'check' ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />}
                    Sauvegarder et vérifier
                  </button>
                  {seed!.backup?.ok && (
                    <button disabled={!!busy || running || st.live.enabled} onClick={() => act('recheck', () => api.seedRecheck())} className="px-3 py-2 rounded-lg border border-border flex items-center gap-2 disabled:opacity-50">
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

                {!st.live.enabled && (seed!.state === 'done' || seed!.state === 'needs_review') && (
                  <button onClick={() => act('newpass', () => api.seedNewPass())} className="px-3 py-2 rounded-lg border border-border">
                    Nouvelle passe (n'enverra que les lignes modifiées)
                  </button>
                )}
              </section>}

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
              </>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

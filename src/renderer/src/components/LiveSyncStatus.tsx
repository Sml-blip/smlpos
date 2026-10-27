import { useState } from 'react'
import type { SeedApi, SeedPanelStatus, SeedResult } from '../lib/seedTypes'
import { friendlySyncError } from '../lib/syncErrors'

const api = window.api as unknown as SeedApi
const time = (value: string | null) => value ? new Date(value).toLocaleString('fr-TN') : 'Jamais'
type Issue = Awaited<ReturnType<SeedApi['sync2Issues']>> extends SeedResult<infer T> ? T : never

export default function LiveSyncStatus({ live, connection, busy, act }: {
  live: SeedPanelStatus['live']; busy: boolean
  connection: SeedPanelStatus['connection']
  act: <T>(label: string, fn: () => Promise<SeedResult<T>>) => Promise<void>
}) {
  const [issues, setIssues] = useState<Issue>([])
  const hasError = live.bootstrapState === 'error' || live.bootstrapState === 'review' || !!live.pushError || !!live.pullError
  const label = hasError ? 'Erreur à examiner'
    : connection === 'auth_failed' ? 'Connexion refusée'
    : connection === 'offline' ? 'Hors ligne'
    : connection === 'unconfigured' || connection === 'unregistered' ? 'Non connecté'
    : live.bootstrapState === 'downloading' || live.bootstrapState === 'verifying' || live.joining || live.pending > 0 || busy ? 'Synchronisation en cours'
    : 'Connecté'
  const color = hasError || connection === 'auth_failed' ? 'bg-red-600'
    : connection === 'offline' ? 'bg-orange-500'
    : connection === 'unconfigured' || connection === 'unregistered' ? 'bg-gray-400'
    : label === 'Synchronisation en cours' ? 'bg-blue-600' : 'bg-green-600'
  const explain = (reason: string) => {
    if (reason.includes('UNSUPPORTED_DELTA')) return 'Cette variation de compteur n’est pas autorisée par le contrat de synchronisation. Elle reste enregistrée sur ce poste.'
    if (reason.includes('COUNTER_DELTA_REQUIRED')) return 'Le serveur a demandé une variation de solde plutôt qu’un remplacement de valeur. Réessayez après la mise à jour de ce poste.'
    if (reason.includes('UNSUPPORTED_COUNTER_LEDGER')) return 'Le serveur ne peut pas recalculer le journal de stock pour cette opération. Elle reste en attente.'
    if (reason.includes('IMMUTABLE_ROW')) return 'Cette écriture d’historique est définitive. Passez une opération de correction (avoir ou contrepassation).'
    return friendlySyncError(reason.replace(/^rejected:[^:]+:/, ''))
  }
  return <section className="rounded-lg border border-border p-3 space-y-2" aria-label="État de la synchronisation continue">
    <div className="flex flex-wrap items-center gap-2">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} aria-hidden="true" />
      <h4 className="font-bold">{label}</h4>
      <span className="text-text-muted">· {live.backend === 'vps' ? 'Serveur SMLPOS' : 'ancienne connexion'}</span>
    </div>
    <p>{live.enabled ? 'Ce poste envoie et reçoit les changements automatiquement.' : live.joining ? 'Les écritures métier restent verrouillées jusqu’à la fin du téléchargement.' : 'Synchronisation inactive sur ce poste.'}</p>
    {live.backend==='vps' && live.enabled && <p className="text-text-muted">Les ventes, le stock et les soldes sont synchronisés en arrière-plan.</p>}
    {live.bootstrapState === 'downloading' && <div className="space-y-1" role="status" aria-live="polite">
      <p className="font-semibold">Réception initiale en cours — {live.bootstrapRows.toLocaleString('fr-TN')} changements reçus, {live.bootstrapPages} pages vérifiées.</p>
      <div className="h-2 overflow-hidden rounded bg-gray-200" aria-label="Téléchargement initial en cours">
        <div className="h-full w-1/3 rounded bg-blue-600 animate-pulse" />
      </div>
      <p className="text-text-muted">Les données sont contrôlées par table avant l’activation de ce poste.</p>
    </div>}
    {live.bootstrapState === 'verifying' && <p role="status" aria-live="polite" className="font-semibold">Téléchargement terminé. Vérification des lignes et des totaux monétaires avant l’ouverture du POS…</p>}
    {live.bootstrapState === 'complete' && live.bootstrapVerification && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900">Vérification terminée : {live.bootstrapVerification.tables.toLocaleString('fr-TN')} tables, {live.bootstrapVerification.rows.toLocaleString('fr-TN')} lignes et {live.bootstrapVerification.moneyFields.toLocaleString('fr-TN')} totaux monétaires contrôlés.</p>}
    {live.bootstrapState === 'review' && <p role="alert" className="text-orange-800">La réception contient des lignes rejetées. Consultez les rejets avant d’activer ce poste.</p>}
    {live.bootstrapState === 'error' && live.pullError && <p role="alert" className="text-red-700">Réception interrompue : {live.pullError}</p>}
    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {[
        ['À envoyer', live.pending], ['Rejets d’envoi', live.rejected], ['Rejets de réception', live.pullRejected],
        ['Position reçue', live.cursor], ['Retard connu', live.lag ?? 'Inconnu'],
        ['Dernier envoi', time(live.lastPush)], ['Dernière réception', time(live.lastPull)],
      ].map(([label, value]) => <div key={label}><dt className="text-text-muted">{label}</dt><dd className="font-semibold">{value}</dd></div>)}
    </dl>
    {(live.pushError || live.pullError) && <p role="alert" className="text-red-700">{[live.pushError, live.pullError].filter(Boolean).map(error=>friendlySyncError(error!)).join(' · ')}</p>}
    {live.retryAt > Date.now() && <p>Nouvel essai après {new Date(live.retryAt).toLocaleTimeString('fr-TN')}</p>}
    <div className="flex flex-wrap gap-2">
      <button disabled={busy || !live.prepared} onClick={() => act('live-retry', () => api.sync2Retry())} className="border border-border rounded px-2 py-1 disabled:opacity-50">Réessayer les envois</button>
      <button disabled={busy} onClick={() => act('live-issues', async () => {
        const result = await api.sync2Issues(); if (result.ok) setIssues(result.data); return result
      })} className="border border-border rounded px-2 py-1">Afficher les rejets</button>
      <button disabled={busy} onClick={() => act('live-export', () => api.sync2Export())} className="border border-border rounded px-2 py-1">Exporter le diagnostic</button>
      {issues.length > 0 && <button onClick={() => setIssues([])} className="border border-border rounded px-2 py-1">Masquer les détails</button>}
    </div>
    {issues.length > 0 && <div className="max-h-40 overflow-y-auto border rounded divide-y">
      {issues.map(issue => <p className="p-2 break-all" key={`${issue.source}:${issue.seq}`}>
        {issue.source === 'push' ? 'Envoi' : 'Réception'} #{issue.seq} · {issue.table} · {issue.pk} · {explain(issue.reason)}
      </p>)}
    </div>}
    {(live.rejected > 0 || live.pullRejected > 0) && <p className="text-text-muted">Les opérations rejetées sont conservées pour examen. Aucun rejet n’est marqué comme envoyé.</p>}
  </section>
}

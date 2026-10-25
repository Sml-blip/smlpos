import { useState } from 'react'
import type { SeedApi, SeedPanelStatus, SeedResult } from '../lib/seedTypes'

const api = window.api as unknown as SeedApi
const time = (value: string | null) => value ? new Date(value).toLocaleString('fr-TN') : 'Jamais'
type Issue = Awaited<ReturnType<SeedApi['sync2Issues']>> extends SeedResult<infer T> ? T : never

export default function LiveSyncStatus({ live, busy, act }: {
  live: SeedPanelStatus['live']; busy: boolean
  act: <T>(label: string, fn: () => Promise<SeedResult<T>>) => Promise<void>
}) {
  const [issues, setIssues] = useState<Issue>([])
  return <section className="rounded-lg border border-border p-3 space-y-2" aria-label="État de la synchronisation continue">
    <h4 className="font-bold">Synchronisation continue · {live.backend === 'vps' ? 'VPS' : 'ancienne connexion'}</h4>
    <p>{live.enabled ? 'Vérification initiale terminée' : 'Envoi verrouillé : sauvegarde et vérification initiale requises'}</p>
    {live.backend==='vps' && <p className="text-text-muted">Les corrections financières passent par un avoir ou une contrepassation. Les enregistrements validés restent immuables.</p>}
    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {[
        ['À envoyer', live.pending], ['Rejets d’envoi', live.rejected], ['Rejets de réception', live.pullRejected],
        ['Position reçue', live.cursor], ['Retard connu', live.lag ?? 'Inconnu'],
        ['Dernier envoi', time(live.lastPush)], ['Dernière réception', time(live.lastPull)],
      ].map(([label, value]) => <div key={label}><dt className="text-text-muted">{label}</dt><dd className="font-semibold">{value}</dd></div>)}
    </dl>
    {(live.pushError || live.pullError) && <p role="alert" className="text-red-700">{[live.pushError, live.pullError].filter(Boolean).join(' · ')}</p>}
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
        {issue.source === 'push' ? 'Envoi' : 'Réception'} #{issue.seq} · {issue.table} · {issue.pk} · {issue.reason}
      </p>)}
    </div>}
    {(live.rejected > 0 || live.pullRejected > 0) && <p className="text-text-muted">Les opérations rejetées sont conservées pour examen. Aucun rejet n’est marqué comme envoyé.</p>}
  </section>
}

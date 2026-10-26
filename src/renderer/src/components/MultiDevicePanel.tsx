import { useCallback,useEffect,useRef,useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Cloud,MonitorSmartphone,RefreshCw,ShieldCheck,X,AlertTriangle } from 'lucide-react'
import type { HetznerOverview,SeedPreflight } from '../lib/hetznerTypes'

export default function MultiDevicePanel(){
 const [open,setOpen]=useState(false)
 const [overview,setOverview]=useState<HetznerOverview|null>(null)
 const [preflight,setPreflight]=useState<SeedPreflight|null>(null)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [username,setUsername]=useState('')
 const [password,setPassword]=useState('')
 const [checkedAt,setCheckedAt]=useState<Date|null>(null)
 const refreshing=useRef(false)
 const refresh=useCallback(async()=>{
  if(refreshing.current || !window.api.hetznerOverview)return
  refreshing.current=true
  try{setOverview(await window.api.hetznerOverview());setCheckedAt(new Date())}
  catch{setError('Impossible de lire l’état de connexion.')}
  finally{refreshing.current=false}
 },[])
 useEffect(()=>{
  let cancelled=false
  let timer:ReturnType<typeof setTimeout>
  const poll=async()=>{await refresh();if(!cancelled)timer=setTimeout(poll,30_000)}
  void poll()
  return()=>{cancelled=true;clearTimeout(timer)}
 },[refresh])
 const login=async(event:React.FormEvent)=>{
  event.preventDefault();setBusy(true);setError('')
  try{await window.api.hetznerLogin({username:username.trim(),password});setPassword('');await refresh()}
  catch(e){setError(e instanceof Error?e.message:'Connexion impossible')}
  finally{setBusy(false)}
 }
 const prepare=async()=>{
  setBusy(true);setError('')
  try{setPreflight(await window.api.hetznerPreflight())}
  catch(e){setError(e instanceof Error?e.message:'Préparation impossible')}
  finally{setBusy(false)}
 }
 return <Dialog.Root open={open} onOpenChange={setOpen}>
  <div className="flex justify-end border-b border-border bg-[var(--bg-primary)] px-3 py-1">
   <Dialog.Trigger asChild><button type="button" className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs hover:bg-surface" aria-label="Ouvrir la synchronisation multi-appareils">
    <Cloud size={14} className={overview?.serverReachable?'text-emerald-600':'text-amber-600'}/>
    Multi-appareils <span className="text-text-muted">· préparation</span>
   </button></Dialog.Trigger>
  </div>
  <Dialog.Portal>
   <Dialog.Overlay className="fixed inset-0 z-[10000] bg-black/50"/>
   <Dialog.Content className="fixed left-1/2 top-1/2 z-[10001] max-h-[85vh] w-[min(620px,95vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-[var(--bg-primary)] p-6 shadow-2xl">
    <div className="flex items-start justify-between gap-4">
     <div><Dialog.Title className="flex items-center gap-2 text-lg font-bold"><MonitorSmartphone size={21}/>Synchronisation multi-appareils</Dialog.Title>
      <Dialog.Description className="mt-1 text-sm text-text-muted">Votre PC principal prépare la première copie. Les autres appareils recevront ensuite les données.</Dialog.Description></div>
     <Dialog.Close asChild><button type="button" className="rounded-lg p-2 hover:bg-surface" aria-label="Fermer"><X size={18}/></button></Dialog.Close>
    </div>
    <div className="mt-5 flex items-center justify-between rounded-xl border border-border p-3">
     <div><p className="text-sm font-semibold">{overview?.serverReachable?'Serveur joignable':'Serveur indisponible'}</p><p className="text-xs text-text-muted">{checkedAt?`Vérifié à ${checkedAt.toLocaleTimeString('fr-TN')}`:'Vérification…'}</p></div>
     <button type="button" onClick={()=>void refresh()} aria-label="Actualiser la connexion" className="rounded-lg p-2 hover:bg-surface"><RefreshCw size={16}/></button>
    </div>
    <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950"><p className="font-semibold">Import en préparation</p><p className="mt-1">Une connexion au serveur ne signifie pas que les ventes sont synchronisées. L’envoi des données reste verrouillé jusqu’à validation de la migration.</p></div>
    {!overview?.authenticated?<form onSubmit={login} className="mt-4 space-y-3">
     <p className="text-sm font-semibold">Connecter ce poste : {overview?.deviceName??'SMLPOS'}</p>
     <label className="block text-sm">Identifiant serveur<input value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" required maxLength={80} className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2"/></label>
     <label className="block text-sm">Mot de passe<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" required maxLength={256} className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2"/></label>
     <button type="submit" disabled={busy||!overview?.serverReachable} className="rounded-lg bg-yellow-400 px-4 py-2 text-sm font-semibold text-black disabled:opacity-50">{busy?'Connexion…':'Connecter cet appareil'}</button>
    </form>:<section className="mt-4" aria-label="Appareils inscrits">
     <h3 className="font-semibold">Appareils inscrits</h3>
     <ul className="mt-2 divide-y divide-border rounded-xl border border-border">{overview.devices.map(d=><li key={d.id} className="flex items-center justify-between gap-3 p-3 text-sm"><div><p className="font-medium">{d.name}{d.id===overview.deviceId?' · ce poste':''}</p><p className="text-xs text-text-muted">{d.platform} · v{d.client_version}{d.importer?' · PC source':''}</p></div><span className={d.revoked_at?'text-red-600':d.online?'text-emerald-700':'text-text-muted'}>{d.revoked_at?'Révoqué':d.online?'En ligne':'Hors ligne'}</span></li>)}</ul>
     <p className="mt-2 text-xs text-text-muted">« En ligne » indique une activité récente, pas la fin d’un transfert.</p>
    </section>}
    <section className="mt-5 border-t border-border pt-4" aria-label="Préparation du PC principal">
     <h3 className="flex items-center gap-2 font-semibold"><ShieldCheck size={17}/>Préparer le PC principal</h3>
     <p className="mt-1 text-sm text-text-muted">À lancer sur le PC qui contient tout l’historique, après fermeture de la caisse. Sauvegarde complète, contrôles et plan de conversion local ; aucune donnée envoyée.</p>
     <button type="button" disabled={busy} onClick={()=>void prepare()} className="mt-3 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-surface disabled:opacity-50">{busy?'Préparation en cours…':'Créer une copie vérifiée'}</button>
     {preflight?<div className="mt-3 rounded-xl border border-emerald-300 p-3 text-sm" role="status"><p className="font-semibold">Copie vérifiée · {preflight.tableCount} tables</p><p>{Object.values(preflight.rowCounts).reduce((sum,n)=>sum+n,0).toLocaleString('fr-TN')} enregistrements · intégrité et nombres de lignes contrôlés</p><p className="mt-2 break-all text-xs text-text-muted">{preflight.backupPath}</p>{preflight.warnings.length?<ul className="mt-2 list-disc pl-4 text-amber-800">{preflight.warnings.map(w=><li key={w}>{w}</li>)}</ul>:null}
      {preflight.conversion?<div className="mt-3 border-t border-border pt-3"><p className="font-semibold">{preflight.conversion.canStage?'Plan de conversion créé':'Plan de conversion à corriger'}</p><p>{preflight.conversion.convertedRows.toLocaleString('fr-TN')} lignes préparées, dont {preflight.conversion.openingStockRows} ouvertures de stock et {preflight.conversion.openingAccountRows} ouvertures de compte.</p><p className={preflight.conversion.blockingIssues?'mt-1 text-red-700':'mt-1 text-text-muted'}>{preflight.conversion.blockingIssues} anomalie(s) bloquante(s) · {preflight.conversion.reviewIssues} élément(s) historiques à examiner</p>{preflight.conversion.planPath?<p className="mt-1 break-all text-xs text-text-muted">{preflight.conversion.planPath}</p>:null}</div>:null}
      <p className="mt-2 text-xs">Le plan reste sur ce PC. L’envoi et l’activation restent désactivés ; les données de la caisse ne sont pas modifiées.</p></div>:null}
    </section>
    {overview?.rejections.length?<section className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-900"><h3 className="flex items-center gap-2 font-semibold"><AlertTriangle size={16}/>Opérations refusées</h3><ul>{overview.rejections.map(r=><li key={r.id}>{r.message}</li>)}</ul></section>:null}
    <p className="mt-4 text-xs text-text-muted">Ancienne file locale : {overview?.localQueue??'—'} opération(s). Cette file n’est pas encore reliée au nouveau serveur.</p>
    {error?<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-900">{error}</p>:null}
    {!error && overview?.message?<p className="mt-3 text-xs text-text-muted" aria-live="polite">{overview.message}</p>:null}
   </Dialog.Content>
  </Dialog.Portal>
 </Dialog.Root>
}


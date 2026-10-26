import type Database from 'better-sqlite3'
import type { BackendClient,LiveChange,PullPage } from './client'
import { captureState,setCaptureState,canDrainOutbox } from './gate'
import { CONTRACT_VERSION,COUNTER_COLUMNS,moneyColumnsOf,primaryKeyOf,syncedTableNames } from './tables'
import { isSeedableSetting,describeColumns } from './dryRun'
const q=(name:string)=>`"${name.replaceAll('"','""')}"`
export class PullClient {
  private running=false
  private cancelPolling:(()=>void)|null=null
  constructor(private readonly db:Database.Database,private readonly client:BackendClient) {
    if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='pull_rejects'").get())throw new Error('Prepare verified backup and capture before pull')
  }
  get busy(){return this.running}
  private names(){return syncedTableNames((this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {name:string}[]).map(row=>row.name))}
  private apply(change:LiveChange,bootstrap=false):boolean {
    const {table,pk}=change
    if(!this.names().includes(table)||typeof pk!=='string'||!pk)throw new Error('Unknown table or missing primary key')
    if(table==='app_settings'&&!isSeedableSetting(pk))return false
    const key=primaryKeyOf(table),columns=describeColumns(this.db,table),allowed=new Set(columns.map(column=>column.name))
    const own=!bootstrap&&change.origin_device===captureState(this.db,'device_id')
    const counterKey=`deleted_counters:${JSON.stringify([table,pk])}`
    if(change.op==='DELETE'){
      const row=this.db.prepare(`SELECT * FROM ${q(table)} WHERE ${q(key)}=?`).get(pk) as Record<string,unknown>|undefined
      if(row&&(COUNTER_COLUMNS[table]??[]).length)setCaptureState(this.db,counterKey,JSON.stringify(Object.fromEntries(COUNTER_COLUMNS[table].map(field=>[field,row[field]??0]))))
      this.db.prepare(`DELETE FROM ${q(table)} WHERE ${q(key)}=?`).run(pk);return true
    }
    if(change.op==='DELTA'){
      if(!(COUNTER_COLUMNS[table]??[]).includes(change.field??'')||!Number.isSafeInteger(change.value))throw new Error('Invalid delta')
      if(own)return false // Already applied by this device's original transaction.
      const amount=change.value!/(moneyColumnsOf(table).includes(change.field!)?1000:1)
      const expression=`COALESCE(${q(change.field!)},0)+?`
      const updated=this.db.prepare(`UPDATE ${q(table)} SET ${q(change.field!)}=${moneyColumnsOf(table).includes(change.field!)?`ROUND(${expression},3)`:expression} WHERE ${q(key)}=?`).run(amount,pk)
      if(!updated.changes)throw new Error('Delta target is missing')
      return true
    }
    if(change.op!=='UPSERT'||!change.row||Array.isArray(change.row)||typeof change.row[key]!=='string'||change.row[key]!==pk)throw new Error('Invalid UPSERT')
    const row:Record<string,unknown>={}
    for(const [column,value] of Object.entries(change.row)){
      if(!allowed.has(column)||!bootstrap&&(COUNTER_COLUMNS[table]??[]).includes(column))throw new Error('Unknown column or counter in live UPSERT')
      if(value!==null&&!['string','number'].includes(typeof value))throw new Error('Unsupported value')
      if(value!==null&&moneyColumnsOf(table).includes(column)){
        if(!Number.isSafeInteger(value))throw new Error('Money must be integer millimes')
        row[column]=Number(value)/1000
      }else{
        const kind=columns.find(info=>info.name===column)!.kind
        if(kind==='real_unclassified'||typeof value==='number'&&(!Number.isFinite(value)||kind==='integer'&&!Number.isSafeInteger(value)))throw new Error('Invalid column units')
        row[column]=value
      }
    }
    if(table==='caisse_interne'&&row.date_journal){
      const daily=this.db.prepare('SELECT id FROM caisse_interne WHERE date_journal=?').get(row.date_journal) as {id:string}|undefined
      // The server chooses the historical identity for a shared calendar day.
      // Movements reference date_journal, so no business FK is rewritten.
      if(daily&&daily.id!==pk)this.db.prepare('UPDATE caisse_interne SET id=? WHERE id=?').run(pk,daily.id)
    }
    const current=this.db.prepare(`SELECT * FROM ${q(table)} WHERE ${q(key)}=?`).get(pk) as Record<string,unknown>|undefined
    if(own&&current&&Object.entries(row).every(([column,value])=>current[column]===value))return false
    // Apply server order even with unsent local edits. In particular an own
    // UPSERT may need to restore state overwritten by an earlier remote event.
    const names=Object.keys(row),updates=names.filter(column=>column!==key)
    this.db.prepare(`INSERT INTO ${q(table)}(${names.map(q).join(',')}) VALUES(${names.map(()=>'?').join(',')}) ON CONFLICT(${q(key)}) ${updates.length?`DO UPDATE SET ${updates.map(column=>`${q(column)}=excluded.${q(column)}`).join(',')}`:'DO NOTHING'}`).run(...Object.values(row))
    const saved=captureState(this.db,counterKey)
    if(!current&&!bootstrap&&saved){
      const counters=JSON.parse(saved) as Record<string,number>,fields=(COUNTER_COLUMNS[table]??[]).filter(field=>Object.hasOwn(counters,field))
      if(fields.length)this.db.prepare(`UPDATE ${q(table)} SET ${fields.map(field=>`${q(field)}=?`).join(',')} WHERE ${q(key)}=?`).run(...fields.map(field=>counters[field]),pk)
    }
    this.db.prepare('DELETE FROM sync_state WHERE k=?').run(counterKey)
    return true
  }
  private isolated(change:LiveChange,bootstrap=false){
    this.db.exec('SAVEPOINT pull_change')
    try{const changed=this.apply(change,bootstrap);this.db.exec('RELEASE pull_change');return changed?'applied':'skipped'}
    catch(error){
      this.db.exec('ROLLBACK TO pull_change; RELEASE pull_change')
      this.db.prepare('INSERT OR REPLACE INTO pull_rejects(server_seq,table_name,pk,reason,payload,at) VALUES(?,?,?,?,?,?)').run(change.server_seq,change.table,change.pk,(error instanceof Error?error.message:'Invalid change').slice(0,300),JSON.stringify(change),new Date().toISOString())
      return 'rejected'
    }
  }
  applyPage(page:PullPage,bootstrap=false){
    if(!page||!Array.isArray(page.changes)||page.changes.length>500||typeof page.has_more!=='boolean'||!Number.isSafeInteger(page.next_seq)||page.next_seq<0)throw new Error('Invalid pull page')
    let last=0
    for(const change of page.changes){if(!Number.isSafeInteger(change.server_seq)||change.server_seq<=last||typeof change.origin_device!=='string')throw new Error('Invalid server sequence');last=change.server_seq}
    if(page.changes.length&&page.next_seq!==last||page.has_more&&!page.changes.length)throw new Error('Invalid next cursor')
    return this.db.transaction(()=>{
      const cursor=Number(captureState(this.db,'pull_cursor')??0),result={applied:0,rejected:0,skipped:0,hasMore:page.has_more}
      if(!Number.isSafeInteger(cursor)||cursor<0)throw new Error('Invalid stored pull cursor')
      if(!page.changes.length&&page.next_seq!==cursor)throw new Error('Empty page advanced the cursor')
      if(page.next_seq<=cursor){result.skipped=page.changes.length;return result}
      const mute=captureState(this.db,'apply_mute')??'0';setCaptureState(this.db,'apply_mute','1')
      for(const change of page.changes){if(change.server_seq<=cursor){result.skipped++;continue}result[this.isolated(change,bootstrap)]++}
      setCaptureState(this.db,'pull_cursor',String(page.next_seq));setCaptureState(this.db,'last_pull_at',new Date().toISOString());setCaptureState(this.db,'apply_mute',mute)
      return result
    })()
  }
  async once(){
    if(this.running||!canDrainOutbox(this.db)&&captureState(this.db,'bootstrap_complete')!=='1')return {applied:0,rejected:0,skipped:0,hasMore:false,gated:true}
    this.running=true
    try{const result=this.applyPage(await this.client.pullLive(Number(captureState(this.db,'pull_cursor')??0)));setCaptureState(this.db,'pull_last_error','');return {...result,gated:false}}
    catch(error){setCaptureState(this.db,'pull_last_error',(error instanceof Error?error.message:'Pull failed').slice(0,300));throw error}finally{this.running=false}
  }
  stopPolling(){this.cancelPolling?.();this.cancelPolling=null}
  startPolling(onResult:(value:Awaited<ReturnType<PullClient['once']>>)=>void=()=>{},interval=15_000){
    if(!Number.isFinite(interval)||interval<1000)throw new Error('Invalid pull interval')
    this.stopPolling();let active=true,timer:ReturnType<typeof setTimeout>|null=null
    const stop=()=>{active=false;if(timer)clearTimeout(timer)};this.cancelPolling=stop
    const tick=async()=>{
      try{const result=await this.once();if(active)onResult(result)}catch{/* once persists the error; retry on the next poll. */}
      finally{if(active){timer=setTimeout(tick,interval);timer.unref?.()}}
    }
    void tick();return stop
  }
  async bootstrap(){
    if(this.running)throw new Error('Pull is already running')
    if(captureState(this.db,'bootstrap_complete')==='1'&&captureState(this.db,'replica_join_pending')!=='1')return
    this.running=true
    try{
      const preflight=await this.client.preflight();if(preflight.state!=='seeded'||preflight.contract_version!==CONTRACT_VERSION)throw new Error('Main PC seed or contract is not ready')
      const names=syncedTableNames(Object.keys(preflight.tables)),local=this.names()
      if(!names.length||names.length!==local.length||names.some(table=>!local.includes(table)||preflight.tables[table].pk!==primaryKeyOf(table)))throw new Error('Bootstrap schema differs from this client')
      const encoded=JSON.stringify(names),previous=captureState(this.db,'bootstrap_tables')
      if(previous&&previous!==encoded)throw new Error('Bootstrap schema changed; review before restarting')
      if(!previous){
        for(const table of names)if(!['app_settings','operateurs','categories','services_pos'].includes(table)&&(this.db.prepare(`SELECT 1 FROM ${q(table)} LIMIT 1`).get()))throw new Error('This PC contains business data; review it before joining')
        setCaptureState(this.db,'bootstrap_tables',encoded)
      }
      setCaptureState(this.db,'bootstrap_state','downloading')
      let downloaded=Number(captureState(this.db,'bootstrap_rows')??0)
      let pages=Number(captureState(this.db,'bootstrap_pages')??0)
      const expectedIds=new Map<string,Set<string>>()
      for(const table of names){
        const key=primaryKeyOf(table)
        const rows=this.db.prepare(`SELECT ${q(key)} AS id FROM ${q(table)}`).all() as {id:string}[]
        const ids=new Set(rows.map(row=>String(row.id)))
        if(table==='app_settings')for(const id of [...ids])if(!isSeedableSetting(id))ids.delete(id)
        expectedIds.set(table,ids)
      }
      // sync2 has no table/bootstrap endpoint. Seed activation publishes the
      // full snapshot to the change log, so a fresh device starts at since=0.
      // Cursor commits make an interrupted join resumable without replaying rows.
      while(true){
        if(this.db.prepare('SELECT 1 FROM outbox WHERE sent_at IS NULL LIMIT 1').get())throw new Error('Local writes occurred during bootstrap; review before continuing')
        const cursor=Number(captureState(this.db,'pull_cursor')??0)
        const page=await this.client.pullLive(cursor)
        if(!page||!Array.isArray(page.changes)||page.changes.length>500||typeof page.has_more!=='boolean'||!Number.isSafeInteger(page.next_seq)||page.next_seq<cursor||page.has_more&&!page.changes.length)throw new Error('Bootstrap pull page is invalid')
        if(page.changes.some(change=>!Number.isSafeInteger(change.server_seq)||change.server_seq<=cursor))throw new Error('Bootstrap pull cursor did not advance')
        if(this.db.prepare('SELECT 1 FROM outbox WHERE sent_at IS NULL LIMIT 1').get())throw new Error('Local writes occurred during bootstrap')
        for(const change of page.changes){
          const ids=expectedIds.get(change.table)
          if(!ids||change.table==='app_settings'&&!isSeedableSetting(change.pk))continue
          if(change.op==='DELETE')ids.delete(change.pk)
          else if(change.op==='UPSERT')ids.add(change.pk)
        }
        this.applyPage(page,true)
        downloaded+=page.changes.length;pages++
        setCaptureState(this.db,'bootstrap_rows',String(downloaded));setCaptureState(this.db,'bootstrap_pages',String(pages))
        setCaptureState(this.db,'bootstrap_as_of',String(page.next_seq))
        if(!page.has_more)break
      }
      const countMismatches:string[]=[]
      for(const table of names){
        const actual=table==='app_settings'
          ? (this.db.prepare('SELECT "key" FROM app_settings').all() as {key:string}[]).filter(row=>isSeedableSetting(row.key)).length
          : (this.db.prepare(`SELECT count(*) n FROM ${q(table)}`).get() as {n:number}).n
        const expected=expectedIds.get(table)!.size
        if(actual!==expected)countMismatches.push(`${table}: attendu ${expected}, reçu ${actual}`)
      }
      if(countMismatches.length)throw new Error(`Vérification du téléchargement échouée — ${countMismatches.slice(0,8).join('; ')}`)
      this.db.transaction(()=>{
        const mute=captureState(this.db,'apply_mute')??'0';setCaptureState(this.db,'apply_mute','1')
        const retries=this.db.prepare('SELECT server_seq,payload FROM pull_rejects WHERE server_seq<0').all() as {server_seq:number;payload:string}[]
        retries.sort((a,b)=>names.indexOf((JSON.parse(a.payload) as LiveChange).table)-names.indexOf((JSON.parse(b.payload) as LiveChange).table))
        for(const retry of retries)if(this.isolated(JSON.parse(retry.payload) as LiveChange,true)!=='rejected')this.db.prepare('DELETE FROM pull_rejects WHERE server_seq=?').run(retry.server_seq)
        const rejected=!!this.db.prepare('SELECT 1 FROM pull_rejects LIMIT 1').get()
        setCaptureState(this.db,'bootstrap_state',rejected?'review':'complete')
        setCaptureState(this.db,'pull_cursor',captureState(this.db,'bootstrap_as_of')!);setCaptureState(this.db,'bootstrap_complete',rejected?'0':'1')
        setCaptureState(this.db,'seed_finalized_at',new Date().toISOString());setCaptureState(this.db,'outbox_drain_enabled',rejected?'0':'1')
        setCaptureState(this.db,'replica_join_pending',rejected?'1':'0')
        setCaptureState(this.db,'apply_mute',mute);setCaptureState(this.db,'pull_last_error',rejected?'Initial reception has rejected rows; review the diagnostic before retrying':'')
      })()
    }finally{this.running=false}
  }
}

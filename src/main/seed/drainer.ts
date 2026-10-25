import type Database from 'better-sqlite3'
import type { BackendClient, LiveOp, PushResult } from './client'
import { captureState, pendingLiveRows, setCaptureState, canDrainOutbox } from './gate'
import { describeColumns, convertRow, isSeedableSetting } from './dryRun'
import { COUNTER_COLUMNS, primaryKeyOf, syncedTableNames, toMillimes, moneyColumnsOf } from './tables'

export interface DrainResult { applied:number;duplicates:number;rejected:number;gated:boolean;retryAt:number;error?:string }
export class OutboxDrainer {
  private running=false
  constructor(private readonly db:Database.Database,private readonly client:BackendClient,private readonly clock=Date.now) {}
  get busy() { return this.running }
  private reject(seq:number,message:string) {
    this.db.prepare("UPDATE outbox SET last_error=? WHERE seq=? AND sent_at IS NULL").run(`rejected:local_validation:${message.slice(0,300)}`,seq)
  }
  private wire(raw:Record<string,unknown>,tables:Set<string>):LiveOp {
    const seq=Number(raw.seq),table=String(raw.table_name),pk=String(raw.pk),at=String(raw.at)
    if(!Number.isSafeInteger(seq)||seq<1||!tables.has(table))throw new Error('Unknown table or invalid sequence')
    if(table==='app_settings'&&!isSeedableSetting(pk))throw new Error('Local setting cannot leave this device')
    const base={seq,table,pk,at}
    if(raw.op==='DELETE')return {...base,op:'DELETE'}
    const columns=describeColumns(this.db,table)
    if(raw.op==='DELTA'){
      const field=String(raw.delta_field),number=raw.delta_value
      if(!(COUNTER_COLUMNS[table]??[]).includes(field)||typeof number!=='number'||!Number.isFinite(number))throw new Error('Invalid counter delta')
      const converted=moneyColumnsOf(table).includes(field)?toMillimes(number):{ok:true as const,millimes:number}
      if(!converted.ok||!Number.isSafeInteger(converted.millimes))throw new Error('Delta must be integer units or millimes')
      return {...base,op:'DELTA',field,value:converted.millimes}
    }
    if(raw.op!=='UPSERT')throw new Error('Unknown operation')
    const row=JSON.parse(String(raw.row_json)) as Record<string,unknown>
    if(!row||Array.isArray(row)||typeof row!=='object'||String(row[primaryKeyOf(table)])!==pk)throw new Error('Invalid row identity')
    const allowed=new Set(columns.map(column=>column.name)),counters=COUNTER_COLUMNS[table]??[]
    for(const [key,value] of Object.entries(row))if(!allowed.has(key)||counters.includes(key)||value!==null&&!['string','number'].includes(typeof value))throw new Error('Unknown column, counter in UPSERT or unsupported value')
    const present=columns.filter(column=>Object.hasOwn(row,column.name))
    for(const column of present){const value=row[column.name];if(column.kind==='real_unclassified'||typeof value==='number'&&(!Number.isFinite(value)||column.kind==='integer'&&!Number.isSafeInteger(value)))throw new Error('Invalid column units')}
    const converted=convertRow(table,row,present,null)
    if(!converted)throw new Error('Missing primary key')
    for(const field of moneyColumnsOf(table))if(row[field]!=null&&!toMillimes(row[field]).ok)throw new Error('Invalid money')
    return {...base,op:'UPSERT',row:converted.row}
  }
  async once():Promise<DrainResult> {
    const result:DrainResult={applied:0,duplicates:0,rejected:0,gated:false,retryAt:0}
    if(this.running||!canDrainOutbox(this.db)){result.gated=true;return result}
    const retry=Number(captureState(this.db,'live_retry_after')??0)
    if(retry>this.clock()){result.retryAt=retry;return result}
    this.running=true
    let selected:LiveOp[]=[]
    try {
      const deviceId=captureState(this.db,'device_id');if(!deviceId)throw new Error('Register this device before live upload')
      const tables=new Set(syncedTableNames((this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {name:string}[]).map(row=>row.name)))
      let bytes=0
      for(const raw of pendingLiveRows(this.db)){
        let op:LiveOp
        try {op=this.wire(raw,tables)}catch(error){this.reject(Number(raw.seq),error instanceof Error?error.message:'Invalid operation');result.rejected++;continue}
        const size=Buffer.byteLength(JSON.stringify(op),'utf8')+1
        if(size>800_000){this.reject(op.seq,'Operation exceeds batch size limit');result.rejected++;continue}
        if(bytes+size>800_000)break
        selected.push(op);bytes+=size
      }
      if(!selected.length)return result
      this.db.transaction(()=>{const statement=this.db.prepare('UPDATE outbox SET attempts=attempts+1 WHERE seq=?');for(const op of selected)statement.run(op.seq)})()
      const response=await this.client.pushLive(deviceId,selected)
      this.validate(response,selected)
      this.db.transaction(()=>{
        setCaptureState(this.db,'server_seq',String(response.server_seq))
        for(const item of response.results){
          if(item.status==='rejected'){
            this.db.prepare('UPDATE outbox SET last_error=? WHERE seq=? AND sent_at IS NULL').run(`rejected:${item.code??'server'}:${String(item.message??'Rejected').slice(0,300)}`,item.seq);result.rejected++
          }else{
            this.db.prepare('UPDATE outbox SET sent_at=?,last_error=NULL WHERE seq=? AND sent_at IS NULL').run(new Date(this.clock()).toISOString(),item.seq)
            if(item.status==='duplicate')result.duplicates++;else result.applied++
          }
        }
        setCaptureState(this.db,'live_retry_after','0');setCaptureState(this.db,'live_failures','0');setCaptureState(this.db,'live_last_error','')
        setCaptureState(this.db,'last_push_at',new Date(this.clock()).toISOString())
      })()
      return result
    }catch(error){
      result.applied=0;result.duplicates=0
      const message=(error instanceof Error?error.message:'Upload failed').slice(0,300)
      const failures=Math.min(10,Number(captureState(this.db,'live_failures')??0)+1)
      result.retryAt=this.clock()+Math.min(60_000,1000*2**failures);result.error=message
      this.db.transaction(()=>{
        setCaptureState(this.db,'live_failures',String(failures));setCaptureState(this.db,'live_retry_after',String(result.retryAt));setCaptureState(this.db,'live_last_error',message)
        const statement=this.db.prepare('UPDATE outbox SET last_error=? WHERE seq=? AND sent_at IS NULL')
        for(const op of selected)statement.run(`retry:${message}`,op.seq)
      })()
      return result
    }finally{this.running=false}
  }
  private validate(response:PushResult,ops:LiveOp[]) {
    if(!response||!Array.isArray(response.results)||response.results.length!==ops.length||!Number.isSafeInteger(response.server_seq)||response.server_seq<0)throw new Error('Incomplete push acknowledgement')
    const expected=new Set(ops.map(op=>op.seq)),seen=new Set<number>()
    for(const item of response.results){if(!expected.has(item.seq)||seen.has(item.seq)||!['applied','duplicate','rejected'].includes(item.status))throw new Error('Invalid push acknowledgement');seen.add(item.seq)}
  }
}

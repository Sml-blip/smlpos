/** In-process mock of the seed backend (docs/SEED_CONTRACT.md). Used only by tests. */
import { createHash } from 'crypto'
import { moneyColumnsOf, COUNTER_COLUMNS } from '../tables'
import type { PushResult,LiveChange } from '../client'

const canonical=(value:unknown):string=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'?`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`:JSON.stringify(value)
const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
const MOD=1n<<256n
function addHash(a:string,b:string){return ((BigInt(`0x${a}`)+BigInt(`0x${b}`))%MOD).toString(16).padStart(64,'0')}

interface Opts {
  installId?: string | null
  serverState?: 'empty' | 'seeding' | 'seeded'
  tables?: Record<string, { columns: string[]; pk: string }>
}

export class MockBackend {
  rows = new Map<string, Map<string, Record<string, unknown>>>() // table → pk → row
  seenOps = new Set<string>()
  calls: { method: string; path: string }[] = []
  pushBatches: Array<{ ops: Array<Record<string, unknown>> }> = []
  failBatchesAfter: number | null = null
  rejectPks = new Set<string>()
  batchesReceived = 0
  refreshCount = 0
  accessTokenTtlMs = 3_600_000
  onBatch: ((table: string) => void | Promise<void>) | null = null
  liveSeen = new Map<string,{hash:string;result:PushResult['results'][number]&{version?:string;reason?:string}}>()
  seedSnapshotSeq = 0
  liveSequence = 0
  dropPushResponses = 0
  liveChanges:LiveChange[]=[]
  bootstrapCopies=new Map<number,Map<string,Map<string,Record<string,unknown>>>>()
  onBootstrapPage:(()=>void|Promise<void>)|null=null
  seedInstallId: string | null
  state: 'empty' | 'seeding' | 'seeded'
  tableSpec: Record<string, { columns: string[]; pk: string }>
  expectedTotals: Record<string, { rows: number; money_sums_millimes: Record<string, number> }> = {}
  manifest: { snapshotHash: string; expected: Record<string, { count: number; checksum: string; contentChecksum: string; moneyTotals: Record<string, string> }> } | null = null
  manifestHash = ''
  batchReceipts = new Set<string>()
  deviceId = 'dev-1'
  deviceName = 'Fixture'

  constructor(o: Opts = {}) {
    this.seedInstallId = o.installId ?? null
    this.state = o.serverState ?? 'empty'
    this.tableSpec = o.tables ?? {}
  }

  count(table: string): number { return this.rows.get(table)?.size ?? 0 }

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    this.calls.push({ method, path: url.pathname })
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    const json = (status: number, data: unknown) =>
      new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
    const auth = (init?.headers as Record<string, string> | undefined)?.authorization

    if ((init?.headers as Record<string,string>|undefined)?.['X-Client-Version'] === undefined) return json(426,{code:'CLIENT_UPDATE_REQUIRED',message:'Missing client version'})
    if (url.pathname === '/auth/login') {
      if (body.username !== 'good-user' || body.password !== 'good-pass') return json(401,{code:'INVALID_LOGIN',message:'Invalid username or password'})
      this.deviceId=body.deviceId;this.deviceName=body.deviceName
      return json(200,{accessToken:'access-a1',refreshToken:'refresh-a1',expiresIn:Math.max(1,this.accessTokenTtlMs/1000),role:'admin',syncUrl:'https://mock.invalid'})
    }
    if (url.pathname === '/auth/refresh') {
      this.refreshCount++
      return json(200,{accessToken:`access-a${this.refreshCount+1}`,refreshToken:`refresh-a${this.refreshCount+1}`,expiresIn:Math.max(1,this.accessTokenTtlMs/1000),role:'admin'})
    }
    if (!auth?.startsWith('Bearer ')) return json(401, { code: 'AUTH_REQUIRED', message: 'no token' })
    if (url.pathname === '/devices') return json(200,{currentDeviceId:this.deviceId,devices:[{id:this.deviceId,name:this.deviceName,platform:'windows',client_version:'1.9.1001',last_seen_at:new Date().toISOString(),online:true}]})
    if (url.pathname === '/sync/status') return json(200,{stage:'staging',liveWritesEnabled:false,seedingEnabled:false,rejections:[],importState:'awaiting_verified_dry_run'})
    if (url.pathname === '/sync2/contract') {
      const tables=Object.fromEntries(Object.entries(this.tableSpec).map(([name,table])=>[name,{pk:table.pk,columns:Object.fromEntries(table.columns.map(column=>[column,moneyColumnsOf(name).includes(column)?'money':'text']))}]))
      return json(200,{schemaVersion:2,tables})
    }
    if (url.pathname === '/sync2/verification') {
      if(this.state!=='seeded')return json(409,{code:'SEED_REQUIRED'})
      if(!this.liveChanges.length&&this.rows.size){for(const [table,rows]of this.rows)for(const[pk,row]of rows){this.liveSequence++;this.liveChanges.push({server_seq:this.liveSequence,origin_device:'seed',table,pk,op:'UPSERT',row})}}
      const tables=Object.fromEntries(Object.keys(this.tableSpec).map(table=>{
        const rows=this.rows.get(table)??new Map<string,Record<string,unknown>>(),fields=moneyColumnsOf(table).filter(field=>this.tableSpec[table]?.columns.includes(field))
        const moneyTotals=Object.fromEntries(fields.map(field=>[field,[...rows.values()].reduce((sum,row)=>sum+BigInt(String(row[field]??0)),0n).toString()]))
        return [table,{count:rows.size,moneyTotals}]
      }))
      const snapshot={serverSeq:this.liveSequence,tables}
      // Let the test publish a concurrent event only after verification has
      // captured its consistent snapshot, not during the earlier preflight pull.
      await this.onBootstrapPage?.()
      return json(200,snapshot)
    }
    if (url.pathname === '/sync2/pull') {
      if(this.state!=='seeded')return json(409,{code:'SEED_REQUIRED'})
      if(!this.liveChanges.length&&this.rows.size){for(const [table,rows]of this.rows)for(const[pk,row]of rows){this.liveSequence++;this.liveChanges.push({server_seq:this.liveSequence,origin_device:'seed',table,pk,op:'UPSERT',row})}}
      const since=Number(url.searchParams.get('since')??0),limit=Number(url.searchParams.get('limit')??500)
      const remaining=this.liveChanges.filter(change=>change.server_seq>since).slice(0,limit)
      return json(200,{rows:remaining.map(change=>({seq:String(change.server_seq),table_name:change.table,row_id:change.pk,payload:change.row??{[change.table==='app_settings'?'key':'id']:change.pk},deleted:change.op==='DELETE',op:change.op,...(change.op==='DELTA'?{field:change.field,value:change.value}:{})})),nextSeq:String(remaining.at(-1)?.server_seq??since),hasMore:this.liveChanges.filter(change=>change.server_seq>since).length>limit})
    }
    if (url.pathname === '/sync2/seed/validate') {
      const pk=this.tableSpec[body.table]?.pk??'id'
      return json(200,{blocking:(body.rows as Record<string,unknown>[]).filter(row=>this.rejectPks.has(String(row[pk]))).map(row=>({id:String(row[pk]),reason:'rejected by synthetic validation'})),count:body.rows.length,writes:0})
    }
    if (url.pathname === '/sync2/seed/start') {
      this.state='seeding';this.manifest=body;this.manifestHash=hash(canonical(body));this.rows.clear();this.liveChanges=[];this.liveSequence=0
      return json(200,{seedId:'00000000-0000-7000-8000-000000000001',status:'uploading'})
    }
    if (url.pathname === '/sync2/seed/batch') {
      this.batchesReceived++
      if(this.failBatchesAfter!==null&&this.batchesReceived>this.failBatchesAfter)return json(503,{code:'SERVER_ERROR',message:'temporarily down'})
      const key=`${body.seedId}:${body.batchId}`
      if(this.batchReceipts.has(key))return json(200,{accepted:0,duplicate:body.rows.length})
      const table=this.rows.get(body.table)??new Map<string,Record<string,unknown>>();this.rows.set(body.table,table)
      for(const row of body.rows as Record<string,unknown>[]){const pk=String(row[this.tableSpec[body.table]?.pk??'id']);if(this.rejectPks.has(pk))continue;table.set(pk,row)}
      this.batchReceipts.add(key);await this.onBatch?.(body.table)
      return json(200,{accepted:body.rows.filter((row:Record<string,unknown>)=>!this.rejectPks.has(String(row[this.tableSpec[body.table]?.pk??'id']))).length,duplicate:0})
    }
    if (url.pathname === '/sync2/seed/verify') {
      const actual:Record<string,{count:number;checksum:string;contentChecksum:string;moneyTotals:Record<string,string>}>=Object.fromEntries(Object.entries(this.manifest?.expected??{}).map(([name,stat])=>[name,{count:0,checksum:'0'.repeat(64),contentChecksum:'0'.repeat(64),moneyTotals:Object.fromEntries(Object.keys(stat.moneyTotals).map(key=>[key,'0']))}]))
      for(const [table,rows] of this.rows)for(const [id,row] of rows){const stat=actual[table];if(!stat)continue;stat.count++;stat.checksum=addHash(stat.checksum,hash(id));stat.contentChecksum=addHash(stat.contentChecksum,hash(canonical(row)));for(const column of Object.keys(stat.moneyTotals))stat.moneyTotals[column]=String(BigInt(stat.moneyTotals[column])+BigInt(String(row[column]??0)))}
      const mismatches=Object.keys(actual).filter(table=>canonical(actual[table])!==canonical(this.manifest?.expected[table]))
      return json(200,{ok:mismatches.length===0,actual,mismatches,status:mismatches.length?'NEEDS_REVIEW':'verified'})
    }
    if (url.pathname === '/sync2/seed/activate') {
      if(body.reviewedManifestHash!==this.manifestHash)return json(409,{code:'REVIEW_CHANGED'})
      if(this.state==='seeded')return json(200,{ok:true,replayed:true,snapshotSeq:this.seedSnapshotSeq})
      this.liveChanges=[]
      for(const [table,rows] of this.rows)for(const [pk,row] of rows){this.liveSequence++;this.liveChanges.push({server_seq:this.liveSequence,origin_device:'seed',table,pk,op:'UPSERT',row})}
      this.seedSnapshotSeq=this.liveSequence;this.state='seeded';return json(200,{ok:true,replayed:false,snapshotSeq:this.seedSnapshotSeq})
    }
    if (url.pathname === '/sync2/push') {
      if(this.state!=='seeded')return json(409,{code:'SEED_REQUIRED'})
      const results=[] as Array<{opId:string;status:string;version?:string;code?:string;reason?:string}>
      this.pushBatches.push(body)
      for(const op of body.ops as Array<{opId:string;table:string;rowId:string;op:string;payload?:Record<string,unknown>;field?:string;value?:number}>) {
        const opHash=hash(canonical(op))
        const previous=this.liveSeen.get(op.opId)
        if(previous){if(previous.hash!==opHash)return json(409,{code:'OP_CHANGED'});results.push({opId:op.opId,status:previous.result.status==='rejected'?'rejected':'duplicate',...(previous.result.version?{version:previous.result.version}:{}),...(previous.result.code?{code:previous.result.code}:{}),...(previous.result.reason?{reason:previous.result.reason}:{})});continue}
        const pk=this.tableSpec[op.table]?.pk??'id',rows=this.rows.get(op.table)??new Map<string,Record<string,unknown>>()
        const reject=(code:string,reason:string)=>{
          const result={opId:op.opId,status:'rejected',code,reason}
          this.liveSeen.set(op.opId,{hash:opHash,result:{seq:0,status:'rejected',code,message:reason,reason}});results.push(result)
        }
        if(this.rejectPks.has(op.rowId)){reject('INVALID_ROW','rejected by synthetic validation');continue}
        if(op.op==='DELTA'){
          if(!(COUNTER_COLUMNS[op.table]??[]).includes(op.field??'')){reject('DELTA_NOT_ALLOWED','counter field is not allowlisted');continue}
          if(!Number.isSafeInteger(op.value)||!op.value){reject('INVALID_DELTA','delta must be a non-zero safe integer');continue}
          const target=this.rows.get(op.table)?.get(op.rowId)
          if(!target){reject('DELTA_TARGET_MISSING','target row is missing');continue}
          if(op.table==='produits'){
            const movements=this.rows.get('stock_movements')??new Map<string,Record<string,unknown>>()
            const movementId=`mock-${op.opId}`
            const movement={id:movementId,produit_id:op.rowId,delta:op.value,reason:'SYNC2_DELTA',ref_id:op.opId,device_id:this.deviceId}
            movements.set(movementId,movement);this.rows.set('stock_movements',movements);this.liveSequence++
            this.liveChanges.push({server_seq:this.liveSequence,origin_device:this.deviceId,table:'stock_movements',pk:movementId,op:'UPSERT',row:movement})
          }
          const updated={...target,[op.field!]:Number(target[op.field!]??0)+op.value!,device_id:this.deviceId}
          rows.set(op.rowId,updated);this.rows.set(op.table,rows);this.liveSequence++
          const eventRow:Record<string,unknown>={...updated};delete eventRow[op.field!]
          if(!this.tableSpec[op.table]?.columns.includes('device_id'))delete eventRow.device_id
          this.liveChanges.push({server_seq:this.liveSequence,origin_device:this.deviceId,table:op.table,pk:op.rowId,op:'DELTA',field:op.field,value:op.value,row:eventRow})
          const result={opId:op.opId,status:'applied',version:String(this.liveSequence)}
          this.liveSeen.set(op.opId,{hash:opHash,result:{seq:0,status:'applied',version:String(this.liveSequence)}});results.push(result);continue
        }
        if(!op.payload||String(op.payload[pk])!==op.rowId){reject('ROW_ID_CHANGED','row id mismatch');continue}
        if(op.op==='DELETE'){
          rows.delete(op.rowId);this.rows.set(op.table,rows);this.liveSequence++
          this.liveChanges.push({server_seq:this.liveSequence,origin_device:this.deviceId,table:op.table,pk:op.rowId,op:'DELETE'})
        }else{
          const previous=this.rows.get(op.table)?.get(op.rowId),payload:Record<string,unknown>={...op.payload,device_id:this.deviceId}
          for(const field of COUNTER_COLUMNS[op.table]??[])if(op.table!=='produits'){
            if(previous?.[field]!==undefined)payload[field]=previous[field];else delete payload[field]
          }
          if(op.table==='produits'&&previous?.stock_actuel!==undefined)payload.stock_actuel=previous.stock_actuel
          rows.set(op.rowId,payload);this.rows.set(op.table,rows);this.liveSequence++
          const eventRow:Record<string,unknown>={...payload};for(const field of COUNTER_COLUMNS[op.table]??[])delete eventRow[field]
          if(!this.tableSpec[op.table]?.columns.includes('device_id'))delete eventRow.device_id
          this.liveChanges.push({server_seq:this.liveSequence,origin_device:this.deviceId,table:op.table,pk:op.rowId,op:'UPSERT',row:eventRow})
        }
        const result={opId:op.opId,status:'applied',version:String(this.liveSequence)}
        this.liveSeen.set(op.opId,{hash:opHash,result:{seq:0,status:'applied',version:String(this.liveSequence)}});results.push(result)
      }
      if(this.dropPushResponses>0){this.dropPushResponses--;throw new TypeError('Connection lost after server commit')}
      return json(200,{results})
    }

    if (url.pathname === '/v1/devices/register') {
      if (body.enrollment_token !== 'good-token') return json(403, { code: 'bad_token', message: 'Invalid enrollment token' })
      return json(200, { device_id: 'dev-1', session: this.session('a1') })
    }
    if (url.pathname === '/v1/auth/refresh') {
      this.refreshCount++
      return json(200, this.session(`a${1 + this.refreshCount}`))
    }
    if (!auth?.startsWith('Bearer ')) return json(401, { code: 'unauthorized', message: 'no token' })
    if (url.pathname === '/v1/sync/push') {
      if(this.state!=='seeded')return json(409,{code:'seed_not_finalized',message:'Finalize the seed first'})
      if(typeof body.device_id!=='string'||!Array.isArray(body.ops)||!body.ops.length||body.ops.length>200)return json(400,{code:'bad_request'})
      const rows=new Map([...this.rows].map(([table,data])=>[table,new Map([...data].map(([pk,row])=>[pk,{...row}]))]))
      const seen=new Map(this.liveSeen),results:PushResult['results']=[],changes=[...this.liveChanges];let serverSeq=this.liveSequence,last=0
      for(const op of body.ops){
        if(!Number.isSafeInteger(op.seq)||op.seq<=last)return json(400,{code:'sequence_order'});last=op.seq
        const key=`${body.device_id}:${op.seq}`,hash=createHash('sha256').update(JSON.stringify(op)).digest('hex'),old=seen.get(key)
        if(old){if(old.hash!==hash)return json(409,{code:'op_changed'});results.push({...old.result,status:old.result.status==='rejected'?'rejected':'duplicate'});continue}
        const definition=Object.hasOwn(this.tableSpec,op.table)?this.tableSpec[op.table]:undefined,data=rows.get(op.table)??new Map<string,Record<string,unknown>>()
        let code=this.rejectPks.has(op.pk)?'validation_failed':!definition?'unknown_table':''
        if(!code && definition && op.op==='UPSERT'){
          if(!op.row||String(op.row[definition.pk])!==op.pk)code='invalid_pk'
          else if(Object.keys(op.row).some(column=>!definition.columns.includes(column)||(COUNTER_COLUMNS[op.table]??[]).includes(column)))code='unknown_column'
          else if(moneyColumnsOf(op.table).some(column=>op.row[column]!=null&&!Number.isSafeInteger(op.row[column])))code='money_not_integer'
          else data.set(op.pk,{...data.get(op.pk),...op.row})
        }else if(!code && op.op==='DELETE')data.delete(op.pk)
        else if(!code && op.op==='DELTA'){
          if(!(COUNTER_COLUMNS[op.table]??[]).includes(op.field)||!Number.isSafeInteger(op.value))code='invalid_delta'
          else if(!data.has(op.pk))code='missing_row'
          else data.set(op.pk,{...data.get(op.pk),[op.field]:Number(data.get(op.pk)![op.field]??0)+op.value})
        }else if(!code)code='unknown_op'
        const result:PushResult['results'][number]={seq:op.seq,status:code?'rejected':'applied',...(code?{code,message:'Rejected by mock validation'}:{})}
        if(!code){rows.set(op.table,data);serverSeq++;const {seq,at,...operation}=op;changes.push({...operation,server_seq:serverSeq,origin_device:body.device_id})}seen.set(key,{hash,result});results.push(result)
      }
      this.rows=rows;this.liveSeen=seen;this.liveSequence=serverSeq;this.liveChanges=changes
      if(this.dropPushResponses>0){this.dropPushResponses--;throw new TypeError('Connection lost after server commit')}
      return json(200,{results,server_seq:serverSeq})
    }
    if(url.pathname==='/v1/sync/pull'){
      if(this.state!=='seeded')return json(409,{code:'seed_not_finalized'})
      const since=Number(url.searchParams.get('since')??0),limit=Number(url.searchParams.get('limit')??500)
      if(!Number.isSafeInteger(since)||since<0||!Number.isInteger(limit)||limit<1||limit>500)return json(400,{code:'bad_cursor'})
      const remaining=this.liveChanges.filter(change=>change.server_seq>since),changes=remaining.slice(0,limit)
      return json(200,{changes,next_seq:changes.at(-1)?.server_seq??since,has_more:remaining.length>limit})
    }
    if(url.pathname==='/v1/sync/bootstrap'){
      if(this.state!=='seeded')return json(409,{code:'seed_not_finalized'})
      const table=url.searchParams.get('table')??'',after=url.searchParams.get('after')??'',requested=url.searchParams.get('as_of_seq')
      if(!Object.hasOwn(this.tableSpec,table))return json(400,{code:'unknown_table'})
      const asOf=requested===null?this.liveSequence:Number(requested)
      if(requested===null&&!this.bootstrapCopies.has(asOf))this.bootstrapCopies.set(asOf,new Map([...this.rows].map(([name,data])=>[name,new Map([...data].map(([pk,row])=>[pk,{...row}]))])))
      const frozen=this.bootstrapCopies.get(asOf);if(!frozen)return json(409,{code:'bootstrap_expired'})
      const all=[...(frozen.get(table)?.entries()??[])].filter(([pk])=>Buffer.compare(Buffer.from(pk),Buffer.from(after))>0).sort(([a],[b])=>Buffer.compare(Buffer.from(a),Buffer.from(b)))
      await this.onBootstrapPage?.()
      return json(200,{rows:all.slice(0,500).map(([,row])=>row),as_of_seq:asOf,has_more:all.length>500})
    }

    if (url.pathname === '/v1/status') {
      return json(200, {
        server_time: new Date().toISOString(), contract_version: 1,
        devices: [{ device_id: 'dev-1', name: 'PC Caisse', platform: 'win32', last_seen_at: new Date().toISOString(), online: true }],
        seed: { state: this.state, install_id: this.seedInstallId },
      })
    }
    if (url.pathname === '/v1/seed/preflight') {
      return json(200, {
        contract_version: 1, state: this.state, install_id: this.seedInstallId,
        tables: this.tableSpec, max_batch_rows: 50, max_batch_bytes: 500_000,
      })
    }
    if (url.pathname === '/v1/seed/begin') {
      this.state = 'seeding'
      this.seedInstallId = body.install_id
      this.expectedTotals = body.expected
      return json(200, { seed_id: 'seed-1' })
    }
    if (url.pathname === '/v1/seed/batches') {
      this.batchesReceived++
      if (this.failBatchesAfter !== null && this.batchesReceived > this.failBatchesAfter) {
        return json(503, { code: 'unavailable', message: 'temporarily down' })
      }
      let accepted = 0, duplicates = 0
      const rejected: { op_id: string; pk: string; code: string; message: string }[] = []
      const tbl = this.rows.get(body.table) ?? new Map()
      this.rows.set(body.table, tbl)
      for (const { op_id, row } of body.rows as { op_id: string; row: Record<string, unknown> }[]) {
        const pk = String(row[body.table === 'app_settings' ? 'key' : 'id'])
        if (this.seenOps.has(op_id)) { duplicates++; continue }
        if (this.rejectPks.has(pk)) { rejected.push({ op_id, pk, code: 'validation_failed', message: 'rejected by test' }); continue }
        for (const m of body.money_columns as string[]) {
          const v = row[m]
          if (v != null && !Number.isInteger(v)) return json(400, { code: 'money_not_integer', message: `${body.table}.${m}` })
        }
        this.seenOps.add(op_id)
        tbl.set(pk, row)
        accepted++
      }
      await this.onBatch?.(body.table)
      return json(200, { accepted, duplicates, rejected })
    }
    if (url.pathname === '/v1/seed/finalize') {
      const diffs: { table: string; field: string; expected: number | string; actual: number | string }[] = []
      for (const [table, exp] of Object.entries(this.expectedTotals)) {
        const actual = this.count(table)
        if (actual !== exp.rows) diffs.push({ table, field: 'rows', expected: exp.rows, actual })
        for (const m of moneyColumnsOf(table)) {
          if (exp.money_sums_millimes[m] === undefined) continue
          const sum = [...(this.rows.get(table)?.values() ?? [])].reduce((a, r) => a + (Number(r[m]) || 0), 0)
          if (sum !== exp.money_sums_millimes[m]) diffs.push({ table, field: m, expected: exp.money_sums_millimes[m], actual: sum })
        }
      }
      if (diffs.length === 0) this.state = 'seeded'
      return json(200, { ok: diffs.length === 0, diffs })
    }
    return json(404, { code: 'not_found', message: url.pathname })
  }

  private session(token: string) {
    return {
      access_token: token,
      refresh_token: createHash('sha256').update(token).digest('hex'),
      expires_at: new Date(Date.now() + this.accessTokenTtlMs).toISOString(),
    }
  }
}

/** In-process mock of the seed backend (docs/SEED_CONTRACT.md). Used only by tests. */
import { createHash } from 'crypto'
import { moneyColumnsOf, COUNTER_COLUMNS } from '../tables'
import type { PushResult } from '../client'

interface Opts {
  installId?: string | null
  serverState?: 'empty' | 'seeding' | 'seeded'
  tables?: Record<string, { columns: string[]; pk: string }>
}

export class MockBackend {
  rows = new Map<string, Map<string, Record<string, unknown>>>() // table → pk → row
  seenOps = new Set<string>()
  calls: { method: string; path: string }[] = []
  failBatchesAfter: number | null = null
  rejectPks = new Set<string>()
  batchesReceived = 0
  refreshCount = 0
  accessTokenTtlMs = 3_600_000
  onBatch: ((table: string) => void | Promise<void>) | null = null
  liveSeen = new Map<string,{hash:string;result:PushResult['results'][number]}>()
  liveSequence = 0
  dropPushResponses = 0
  seedInstallId: string | null
  state: 'empty' | 'seeding' | 'seeded'
  tableSpec: Record<string, { columns: string[]; pk: string }>
  expectedTotals: Record<string, { rows: number; money_sums_millimes: Record<string, number> }> = {}

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
      const seen=new Map(this.liveSeen),results:PushResult['results']=[];let serverSeq=this.liveSequence,last=0
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
        if(!code){rows.set(op.table,data);serverSeq++}seen.set(key,{hash,result});results.push(result)
      }
      this.rows=rows;this.liveSeen=seen;this.liveSequence=serverSeq
      if(this.dropPushResponses>0){this.dropPushResponses--;throw new TypeError('Connection lost after server commit')}
      return json(200,{results,server_seq:serverSeq})
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

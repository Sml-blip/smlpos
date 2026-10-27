import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import registryData from '../schema/registry.json' with { type: 'json' }

export type Column = { type: 'uuid' | 'text' | 'integer' | 'money' | 'numeric' | 'timestamp'; required: boolean }
export type Table = { columns: Record<string, Column>; lww: boolean; manager: boolean }
export const registry = registryData as Record<string, Table>
export const uuid7 = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
export function newId(): string {
  const bytes = randomBytes(16)
  bytes.writeUIntBE(Date.now(), 0, 6)
  bytes[6] = (bytes[6] & 15) | 0x70
  bytes[8] = (bytes[8] & 63) | 0x80
  const s = bytes.toString('hex')
  return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`
}
export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) { super(message); this.status=status; this.code=code }
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  return JSON.stringify(value)
}
export const digest = (value: string) => createHash('sha256').update(value).digest('hex')
export function requireVersion(actual: string, minimum: string): void {
  const parse = (v: string) => { if (!/^\d+\.\d+\.\d+$/.test(v)) throw new ApiError(426,'CLIENT_UPDATE_REQUIRED','Mettez à jour SMLPOS'); return v.split('.').map(Number) }
  const a = parse(actual), b = parse(minimum)
  for (let i=0;i<3;i++) { if (a[i]>b[i]) return; if (a[i]<b[i]) throw new ApiError(426,'CLIENT_UPDATE_REQUIRED','Mettez à jour SMLPOS') }
}
export const uploadSchema = z.object({
  transactionId: uuid7,
  ops: z.array(z.object({ op: z.enum(['PUT','PATCH','DELETE']), table: z.string().max(80), id: uuid7, data: z.record(z.string(), z.unknown()).optional() }).strict()).min(1).max(500),
}).strict()
export type Upload = z.infer<typeof uploadSchema>
const metadata = new Set(['id','created_at','updated_at','updated_by','device_id','deleted_at'])
export function validateOperation(op: Upload['ops'][number], role: string, mode: 'live'|'seed' = 'live'): Table {
  const table = Object.hasOwn(registry,op.table) ? registry[op.table] : undefined
  if (!table) throw new ApiError(422,'UNKNOWN_TABLE','Table non autorisée')
  if (table.manager && role!=='admin' && role!=='manager') throw new ApiError(403,'ROLE_FORBIDDEN','Droits insuffisants')
  if (!table.lww && op.op!=='PUT') throw new ApiError(422,'IMMUTABLE_RECORD','Utilisez une annulation ou un mouvement inverse')
  if (op.op==='DELETE' && op.data && Object.keys(op.data).length) throw new ApiError(422,'INVALID_DELETE','Suppression invalide')
  const data = op.data ?? {}
  for (const [key,value] of Object.entries(data)) {
    if (metadata.has(key)) throw new ApiError(422,'SERVER_METADATA','Métadonnées réservées au serveur')
    const column = Object.hasOwn(table.columns,key) ? table.columns[key] : undefined
    if (!column) throw new ApiError(422,'UNKNOWN_COLUMN','Colonne non autorisée')
    if (value===null) { if(column.required) throw new ApiError(422,'REQUIRED_FIELD','Champ requis'); continue }
    let valid = false
    if(column.type==='text') valid = typeof value==='string' && value.length<=250_000
    if(column.type==='uuid') valid = uuid7.safeParse(value).success
    if(column.type==='integer' || column.type==='money') valid = typeof value==='number' && Number.isSafeInteger(value)
    if(column.type==='numeric') valid = typeof value==='number' && Number.isFinite(value) && Math.abs(value)<1e12
    if(column.type==='timestamp') valid = typeof value==='string' && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value) && Number.isFinite(Date.parse(value))
    if(!valid) throw new ApiError(422,'INVALID_VALUE',`Valeur invalide pour ${key}`)
  }
  if(op.op==='PUT') for(const [key,col] of Object.entries(table.columns)) {
    if(col.required && !(key in data)) throw new ApiError(422,'REQUIRED_FIELD',`Champ requis : ${key}`)
  }
  if(mode==='live' && op.table==='app_settings' && !/^(company_|invoice_|facture_|tva_|fidelite_)/.test(String(data.key??''))) throw new ApiError(422,'LOCAL_SETTING','Ce réglage doit rester local')
  if(op.table.endsWith('_movements') && data.amount_millimes!==undefined && Number(data.amount_millimes)===0) throw new ApiError(422,'ZERO_MOVEMENT','Mouvement nul')
  return table
}


import { createHash } from 'node:crypto'
import { z } from 'zod'
import contractJson from '../schema/sync2-contract.json' with {type:'json'}
import { ApiError,canonical } from './domain.ts'
export const contract=contractJson as Record<string,{pk:string;columns:Record<string,string>}>
/** Counter values are changed only by an atomic DELTA, never by live UPSERT. */
export const deltaAllowlist:Record<string,Readonly<Record<string,'stock'|'money'>>>={
 produits:{stock_actuel:'stock'},
 clients:{solde_credit:'money',solde_fidelite:'money'},
 fournisseurs:{solde_du:'money'},
 organisations:{credit_total:'money'},
 personnels:{avance_solde:'money',credit_solde:'money'},
 caisse_interne:{total_entrees:'money',total_sorties:'money'},
}
export const counterFields=(table:string)=>Object.keys(deltaAllowlist[table]??{})
export const rowId=z.string().min(1).max(512)
export const snapshotHash=z.string().regex(/^[0-9a-f]{64}$/)
export const secretSetting=(key:string)=>/^(r2_|pin_|device_|seed_|sync2_|backup_|supabase_)/i.test(key)||/(secret|token|password|passwd|pin|api[_-]?key|access[_-]?key|private)/i.test(key)||['first_touch_pending','sync_backend','backend_url','schema_version','bootstrap_completed_at','bootstrap_last_errors','pull_last_at'].includes(key)
export function validateRow(table:string,payload:Record<string,unknown>){
 if(!Object.hasOwn(contract,table))throw new ApiError(422,'UNKNOWN_TABLE','Table non autorisée')
 const definition=contract[table];rowId.parse(payload[definition.pk])
 if(table==='app_settings' && secretSetting(String(payload.key)))throw new ApiError(422,'LOCAL_SETTING','Réglage local interdit')
 for(const [key,value] of Object.entries(payload)){
  const kind=Object.hasOwn(definition.columns,key)?definition.columns[key]:null
  if(!kind)throw new ApiError(422,'UNKNOWN_COLUMN',`Colonne inconnue : ${table}.${key}`)
  if(value===null)continue
  if(kind==='text' && (typeof value!=='string'||value.length>250_000))throw new ApiError(422,'INVALID_TEXT','Texte invalide')
  if(['integer','money'].includes(kind) && (typeof value!=='number'||!Number.isSafeInteger(value)))throw new ApiError(422,'INVALID_MONEY_UNIT','Entiers en millimes requis')
  if(kind==='number' && (typeof value!=='number'||!Number.isFinite(value)))throw new ApiError(422,'INVALID_NUMBER','Nombre invalide')
 }
 if(table==='stock_movements' && (typeof payload.produit_id!=='string'||!Number.isSafeInteger(payload.delta)))throw new ApiError(422,'INVALID_STOCK','Mouvement de stock invalide')
 return String(payload[definition.pk])
}
const MOD=1n<<256n
const sha=(s:string)=>createHash('sha256').update(s).digest('hex')
export type Stats={count:number;checksum:string;contentChecksum:string;moneyTotals:Record<string,string>}
export function emptyStats(table:string):Stats{return {count:0,checksum:'0'.repeat(64),contentChecksum:'0'.repeat(64),moneyTotals:Object.fromEntries(Object.entries(contract[table].columns).filter(([,kind])=>kind==='money').map(([column])=>[column,'0']))}}
export function addStats(stats:Stats,id:string,payload:Record<string,unknown>){
 stats.count++;stats.checksum=((BigInt(`0x${stats.checksum}`)+BigInt(`0x${sha(id)}`))%MOD).toString(16).padStart(64,'0')
 stats.contentChecksum=((BigInt(`0x${stats.contentChecksum}`)+BigInt(`0x${sha(canonical(payload))}`))%MOD).toString(16).padStart(64,'0')
 for(const column of Object.keys(stats.moneyTotals))stats.moneyTotals[column]=String(BigInt(stats.moneyTotals[column])+BigInt(String(payload[column]??0)))
}
export const statsSchema=z.object({count:z.number().int().nonnegative(),checksum:snapshotHash,contentChecksum:snapshotHash,moneyTotals:z.record(z.string(),z.string().regex(/^-?\d+$/))}).strict()
export const manifestSchema=z.object({snapshotHash,expected:z.record(z.string(),statsSchema)}).strict()
export type Manifest=z.infer<typeof manifestSchema>
export function validateManifest(manifest:Manifest){
 if(canonical(Object.keys(manifest.expected).sort())!==canonical(Object.keys(contract).sort()))throw new ApiError(422,'TABLE_COVERAGE','Couverture des tables incomplète')
 for(const table of Object.keys(contract))if(canonical(Object.keys(manifest.expected[table].moneyTotals).sort())!==canonical(Object.keys(emptyStats(table).moneyTotals).sort()))throw new ApiError(422,'MONEY_COVERAGE','Couverture monétaire incomplète')
}


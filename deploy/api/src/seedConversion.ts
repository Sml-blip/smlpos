import { createHash } from 'node:crypto'
import { canonical,digest,registry,validateOperation } from './domain.ts'
import { seedContractHash } from './seedContract.ts'
import type { SeedManifest,SeedRow } from './seedContract.ts'
import references from '../schema/references.json' with {type:'json'}
import legacyContract from '../schema/legacy-contract.json' with {type:'json'}

export type LegacySnapshot=Record<string,Array<Record<string,unknown>>>
type Issue={level:'error'|'review';code:string;table:string;legacyId?:string;column?:string}
type Options={sourceSha256:string;cutoverAt:string;naiveTimestampPolicy?:'reject'|'Africa/Tunis'|'UTC'}
const tunis=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Tunis',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'})

/** Decimal arithmetic rounds each source value to a millime, away from zero
 * on ties, without multiplying a floating-point value by 1000. */
export function toMillimes(value:unknown):number{
 if(typeof value!=='number' && typeof value!=='string' && typeof value!=='bigint')throw new Error('INVALID_MONEY')
 if(typeof value==='number' && !Number.isFinite(value))throw new Error('INVALID_MONEY')
 const match=/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value))
 if(!match)throw new Error('INVALID_MONEY')
 const digits=match[2]+(match[3]??'');const exponent=Number(match[4]??0)-(match[3]?.length??0)+3
 if(Math.abs(exponent)>100 || digits.length>100)throw new Error('MONEY_OUT_OF_RANGE')
 let result=BigInt(digits)
 if(exponent>=0)result*=10n**BigInt(exponent)
 else{const divisor=10n**BigInt(-exponent);result=result/divisor+(result%divisor*2n>=divisor?1n:0n)}
 if(match[1])result=-result
 const number=Number(result);if(!Number.isSafeInteger(number))throw new Error('MONEY_OUT_OF_RANGE')
 return number
}

/** Zoned values preserve their instant. Bare SQLite timestamps require an
 * explicit policy because the source mixes UTC defaults and local wall time. */
export function sourceTimestamp(value:unknown,policy:Options['naiveTimestampPolicy']='reject'):string|null{
 if(value===null || value===undefined || value==='')return null
 if(typeof value!=='string')throw new Error('INVALID_TIMESTAMP')
 const calendar=/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value)
 if(calendar){
  const [year,month,day,hour,minute,second]=calendar.slice(1).map(Number)
  const date=new Date(Date.UTC(year,month-1,day,hour,minute,second))
  if(date.getUTCFullYear()!==year || date.getUTCMonth()!==month-1 || date.getUTCDate()!==day || hour>23 || minute>59 || second>59)throw new Error('INVALID_TIMESTAMP')
 }
 if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)){
  if(!Number.isFinite(Date.parse(value)))throw new Error('INVALID_TIMESTAMP')
  return new Date(value).toISOString()
 }
 const match=/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(value)
 if(!match)throw new Error('INVALID_TIMESTAMP')
 if(policy==='reject')throw new Error('NAIVE_TIMESTAMP_POLICY_REQUIRED')
 const parts=match.slice(1,7).map(Number);const desired=Date.UTC(parts[0],parts[1]-1,parts[2],parts[3],parts[4],parts[5])
 if(policy==='UTC')return new Date(desired+Number((match[7]??'').padEnd(3,'0'))).toISOString()
 let instant=desired
 for(let attempt=0;attempt<3;attempt++){
  const actual=Object.fromEntries(tunis.formatToParts(instant).map(part=>[part.type,part.value]))
  const wall=Date.UTC(Number(actual.year),Number(actual.month)-1,Number(actual.day),Number(actual.hour),Number(actual.minute),Number(actual.second))
  instant+=desired-wall
 }
 const actual=Object.fromEntries(tunis.formatToParts(instant).map(part=>[part.type,part.value]))
 if([actual.year,actual.month,actual.day,actual.hour,actual.minute,actual.second].join('-')!==match.slice(1,7).join('-'))throw new Error('INVALID_TIMESTAMP')
 for(const delta of [-7_200_000,-3_600_000,3_600_000,7_200_000]){
  const other=Object.fromEntries(tunis.formatToParts(instant+delta).map(part=>[part.type,part.value]))
  if([other.year,other.month,other.day,other.hour,other.minute,other.second].join('-')===match.slice(1,7).join('-'))throw new Error('AMBIGUOUS_TIMESTAMP')
 }
 return new Date(instant+Number((match[7]??'').padEnd(3,'0'))).toISOString()
}

function stableId(options:Options,namespace:string,legacyId:string){
 const bytes=createHash('sha256').update(`${options.sourceSha256}\0${namespace}\0${legacyId}`).digest().subarray(0,16)
 bytes.writeUIntBE(Date.parse(options.cutoverAt),0,6);bytes[6]=(bytes[6]&15)|0x70;bytes[8]=(bytes[8]&63)|0x80
 const h=bytes.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`
}

/** A local dry-run artifact. Source rows are never changed or automatically repaired.
 * Historical JSON remains byte-for-byte intact and is explicitly flagged for
 * adapter review; this module does not authorize production activation. */
export function buildSeedBundle(snapshot:LegacySnapshot,options:Options){
 if(!/^[a-f0-9]{64}$/.test(options.sourceSha256) || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(options.cutoverAt) || !Number.isFinite(Date.parse(options.cutoverAt)))throw new Error('INVALID_SOURCE_MANIFEST')
 const issues:Issue[]=[];const mappings=new Map<string,string>();const idMap:Array<{table:string;legacyId:string;id:string}>=[]
 const sourceCounts:Record<string,number>={};const excludedCounts:Record<string,number>={};const convertedCounts=Object.fromEntries(Object.keys(registry).map(table=>[table,0]))
 const jobId=stableId(options,'seed-job','snapshot')
 const knownTables=new Set(legacyContract.tables.map(table=>table.name))
 for(const table of Object.keys(snapshot))if(!knownTables.has(table))issues.push({level:'error',code:'UNKNOWN_SOURCE_TABLE',table})
 const includeSetting=(row:Record<string,unknown>)=>/^(company_|invoice_|facture_|tva_|fidelite_)/.test(String(row.key??''))
 for(const table of legacyContract.tables){
  if(!Object.hasOwn(snapshot,table.name)){issues.push({level:'error',code:'SOURCE_TABLE_MISSING',table:table.name});continue}
  sourceCounts[table.name]=snapshot[table.name].length
  if(table.local){excludedCounts[table.name]=snapshot[table.name].length;continue}
  for(const row of snapshot[table.name]){
   if(table.name==='app_settings' && !includeSetting(row)){excludedCounts.app_settings=(excludedCounts.app_settings??0)+1;continue}
   const legacy=row[table.name==='app_settings'?'key':'id']
   if(typeof legacy!=='string' || !legacy.length){issues.push({level:'error',code:'SOURCE_ID_MISSING',table:table.name});continue}
   const key=`${table.name}\0${legacy}`
   if(mappings.has(key)){issues.push({level:'error',code:'SOURCE_ID_DUPLICATE',table:table.name,legacyId:legacy});continue}
   const id=stableId(options,table.name,legacy);mappings.set(key,id);idMap.push({table:table.name,legacyId:legacy,id})
  }
 }
 const rows:SeedRow[]=[]
 const extras:Record<string,Record<string,string>>={
  activity_logs:{shift_id:'shifts'},avances_clients:{dossier_id:'avances_clients',facture_id:'documents',vente_id:'ventes'},
  ventes:{avance_dossier_id:'avances_clients'},shifts:{operateur_id:'operateurs'},sorties_caisse:{mouvement_interne_id:'mouvements_caisse_interne'},
 }
 const refer=(table:string,column:string)=>references.find(ref=>ref.table===table && ref.column===column)?.target??extras[table]?.[column]
 const appendOpening=(table:string,legacyId:string,data:Record<string,unknown>)=>{
  const id=stableId(options,table,legacyId)
  rows.push({table,id,data:{...data,legacy_id:legacyId},sourceCreatedAt:options.cutoverAt,sourceUpdatedAt:options.cutoverAt})
 }
 for(const table of legacyContract.tables){
  if(table.local || !snapshot[table.name])continue
  for(const source of snapshot[table.name]){
   if(table.name==='app_settings' && !includeSetting(source))continue
   const legacy=source[table.name==='app_settings'?'key':'id'];if(typeof legacy!=='string')continue
   const id=mappings.get(`${table.name}\0${legacy}`);if(!id)continue
   const data:Record<string,unknown>={legacy_id:legacy};let valid=true
   const error=(code:string,column?:string)=>{valid=false;issues.push({level:'error',code,table:table.name,legacyId:legacy,column})}
   for(const column of Object.keys(source))if(!table.columns.includes(column))error('UNKNOWN_SOURCE_COLUMN',column)
   for(const [column,definition] of Object.entries(registry[table.name].columns)){
    if(column==='legacy_id')continue
    const value=source[column]
    if(value===null || value===undefined){data[column]=null;continue}
    try{
     const target=refer(table.name,column)
     if(target){
      if(value===''){data[column]=null;continue}
      let mapped=mappings.get(`${target}\0${String(value)}`)
      if(!mapped && table.name==='clients' && column==='organisation_id'){
       const matches=(snapshot.organisations??[]).filter(organisation=>String(organisation.nom??'').trim().toLocaleLowerCase('fr')===String(value).trim().toLocaleLowerCase('fr'))
       if(matches.length===1)mapped=mappings.get(`organisations\0${String(matches[0].id)}`)
      }
      if(!mapped){error('SOURCE_REFERENCE_MISSING',column);continue}
      data[column]=mapped
     }else if(definition.type==='money')data[column]=toMillimes(value)
     else if(definition.type==='timestamp')data[column]=sourceTimestamp(value,options.naiveTimestampPolicy)
     else if(definition.type==='uuid'){
      // A polymorphic link cannot be guessed by whichever table happens to contain an ID.
      if(value==='')data[column]=null
      else if(table.name==='serial_numbers' && column==='vente_id'){
       const targetTable=source.statut==='RESERVE_AVANCE'?'avances_clients':'ventes'
       const mapped=mappings.get(`${targetTable}\0${String(value)}`)
       if(!mapped)error('SOURCE_REFERENCE_MISSING',column);else data[column]=mapped
      }else error('REFERENCE_POLICY_REQUIRED',column)
     }else if(definition.type==='integer'){
      const number=typeof value==='bigint'?Number(value):value
      if(typeof number!=='number' || !Number.isSafeInteger(number))throw new Error('INVALID_INTEGER')
      data[column]=number
     }else if(definition.type==='numeric'){
      if(typeof value!=='number' || !Number.isFinite(value) || Math.abs(value)>=1e12 || Math.abs(value*1e6-Math.round(value*1e6))>0.001)throw new Error('INVALID_RATE')
      data[column]=value
     }else data[column]=value
     if((column.endsWith('_json') || column==='layout_snapshot') && typeof value==='string' && value.length>0)issues.push({level:'review',code:'HISTORICAL_JSON_PRESERVED',table:table.name,legacyId:legacy,column})
    }catch(failure){error(failure instanceof Error?failure.message:'INVALID_SOURCE_VALUE',column)}
   }
   let createdAt:string|null=null,updatedAt:string|null=null
   try{createdAt=sourceTimestamp(source.created_at,options.naiveTimestampPolicy);updatedAt=sourceTimestamp(source.updated_at,options.naiveTimestampPolicy)}catch(failure){error(failure instanceof Error?failure.message:'INVALID_SOURCE_TIMESTAMP')}
   try{validateOperation({op:'PUT',table:table.name,id,data},'admin','seed')}catch{error('TARGET_CONTRACT_REJECTED')}
   if(!valid)continue
   rows.push({table:table.name,id,data,sourceCreatedAt:createdAt,sourceUpdatedAt:updatedAt})
   // Historical rows are retained as history. Only the current snapshot becomes
   // an opening movement; old transactions are not replayed into these ledgers.
   if(table.name==='produits'){
    const qty=source.stock_actuel??0
    if(typeof qty!=='number' || !Number.isSafeInteger(qty))error('INVALID_OPENING_STOCK','stock_actuel')
    else if(qty!==0)appendOpening('stock_movements',`opening:produits:${legacy}`,{product_id:id,qty_delta:qty,reason:'legacy_snapshot_cutover',ref_type:'seed_opening',ref_id:jobId})
   }
   const balances:Record<string,Array<[string,string]>>={clients:[['solde_credit','customer_credit'],['solde_fidelite','loyalty']],fournisseurs:[['solde_du','supplier_debt']],personnels:[['avance_solde','staff_advance'],['credit_solde','staff_credit']]}
   for(const [column,kind] of balances[table.name]??[]){
    try{const amount=toMillimes(source[column]??0);if(amount!==0)appendOpening('account_movements',`opening:${table.name}:${legacy}:${kind}`,{account_kind:kind,owner_id:id,amount_millimes:amount,reason:'legacy_snapshot_cutover',ref_type:'seed_opening',ref_id:jobId})}
    catch{error('INVALID_OPENING_BALANCE',column)}
   }
  }
 }
 const binary=(a:string,b:string)=>a<b?-1:a>b?1:0
 rows.sort((a,b)=>binary(a.table,b.table)||binary(a.id,b.id))
 idMap.sort((a,b)=>binary(a.table,b.table)||binary(a.legacyId,b.legacyId))
 const totals:Record<string,string>={}
 for(const [table,definition] of Object.entries(registry))for(const [column,type] of Object.entries(definition.columns))if(type.type==='money')totals[`${table}.${column}`]='0'
 const chunks:SeedRow[][]=[];let chunk:SeedRow[]=[];let bytes=2
 for(const row of rows){
  convertedCounts[row.table]++
  for(const [column,value] of Object.entries(row.data))if(`${row.table}.${column}` in totals)totals[`${row.table}.${column}`]=String(BigInt(totals[`${row.table}.${column}`])+BigInt(String(value??0)))
  const size=Buffer.byteLength(canonical(row),'utf8')+1
  if(size>1_500_000){issues.push({level:'error',code:'SOURCE_ROW_TOO_LARGE',table:row.table});continue}
  if(chunk.length>=500 || bytes+size>1_500_000){chunks.push(chunk);chunk=[];bytes=2}
  chunk.push(row);bytes+=size
 }
 if(chunk.length)chunks.push(chunk)
 if(chunks.length>25_000)issues.push({level:'error',code:'TOO_MANY_CHUNKS',table:'manifest'})
 const manifest:SeedManifest={version:1,jobId,sourceSha256:options.sourceSha256,contractHash:seedContractHash,cutoverAt:options.cutoverAt,expectedCounts:convertedCounts,expectedMoneyTotals:totals,chunks:chunks.map((batch,index)=>({index,sha256:digest(canonical(batch)),rowCount:batch.length}))}
 return {manifest,chunks,idMap,report:{sourceCounts,excludedCounts,convertedCounts,issueCount:issues.length,issues,canStage:!issues.some(issue=>issue.level==='error'),activationEnabled:false as const,naiveTimestampPolicy:options.naiveTimestampPolicy??'reject',openingPolicy:'snapshot_only_no_history_replay'}}
}


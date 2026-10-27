import { z } from 'zod'
import { canonical,digest,registry,validateOperation } from './domain.ts'
import { seedContractHash,seedManifestSchema,seedRowSchema } from './seedContract.ts'
import type { SeedManifest,SeedRow } from './seedContract.ts'

export type SeedProgress={stage:'checking'|'uploading'|'verifying'|'verified';jobId:string;receivedChunks:number;totalChunks:number;receivedRows:number;totalRows:number;activationEnabled:false}
export type SeedTransport=(path:string,body?:unknown,signal?:AbortSignal)=>Promise<unknown>
const bundleSchema=z.object({manifest:seedManifestSchema,chunks:z.array(z.array(seedRowSchema).min(1).max(500)).max(25_000),report:z.object({canStage:z.literal(true),activationEnabled:z.literal(false),issues:z.array(z.object({level:z.enum(['error','review'])}).passthrough())}).passthrough()}).passthrough()
const statusSchema=z.object({id:z.string(),manifest_hash:z.string(),status:z.enum(['approved','uploading','verified','cancelled']),activationEnabled:z.literal(false),chunks:z.array(z.object({chunk_index:z.number().int().nonnegative(),payload_hash:z.string(),row_count:z.number().int().positive()}))})
const receiptSchema=z.object({ok:z.literal(true),replayed:z.boolean()})

export function validateSeedBundle(value:unknown):{manifest:SeedManifest;chunks:SeedRow[][]}{
 const bundle=bundleSchema.parse(value)
 if(bundle.report.issues.some(issue=>issue.level==='error'))throw new Error('Le plan contient des anomalies bloquantes')
 const {manifest,chunks}=bundle
 if(manifest.contractHash!==seedContractHash)throw new Error('Le contrat de migration a changé : recréez le plan')
 if(chunks.length!==manifest.chunks.length)throw new Error('Le plan est incomplet')
 const counts=Object.fromEntries(Object.keys(registry).map(table=>[table,0]))
 const totals:Record<string,string>={}
 for(const [table,definition] of Object.entries(registry))for(const [column,kind] of Object.entries(definition.columns))if(kind.type==='money')totals[`${table}.${column}`]='0'
 const ids=new Set<string>()
 for(let index=0;index<chunks.length;index++){
  const chunk=chunks[index];const expected=manifest.chunks[index]
  if(expected.index!==index || expected.sha256!==digest(canonical(chunk)) || expected.rowCount!==chunk.length || Buffer.byteLength(JSON.stringify(chunk),'utf8')>1_500_000)throw new Error('Un lot du plan est invalide ou a été modifié')
  for(const row of chunk){
   validateOperation({op:'PUT',table:row.table,id:row.id,data:row.data},'admin','seed')
   const key=`${row.table}:${row.id}`;if(ids.has(key))throw new Error('Une ligne apparaît plusieurs fois dans le plan');ids.add(key)
   counts[row.table]++
   for(const [column,amount] of Object.entries(row.data))if(`${row.table}.${column}` in totals)totals[`${row.table}.${column}`]=String(BigInt(totals[`${row.table}.${column}`])+BigInt(String(amount??0)))
  }
 }
 if(canonical(counts)!==canonical(manifest.expectedCounts) || canonical(totals)!==canonical(manifest.expectedMoneyTotals))throw new Error('Les nombres de lignes ou les totaux du plan ne correspondent pas')
 return {manifest,chunks}
}

/** Every resume asks the server for durable receipts; local progress is never
 * used as proof of delivery. A lost response is recovered by an identical retry.
 * This routine stops at staged verification and has no activation operation. */
export async function uploadSeedBundle(value:unknown,options:{transport:SeedTransport;signal?:AbortSignal;onProgress?:(progress:SeedProgress)=>void;checkSource?:()=>void|Promise<void>}){
 const {manifest,chunks}=validateSeedBundle(value);const {signal,transport}=options
 const check=async()=>{signal?.throwIfAborted();await options.checkSource?.();signal?.throwIfAborted()}
 const base={jobId:manifest.jobId,totalChunks:chunks.length,totalRows:Object.values(manifest.expectedCounts).reduce((sum,n)=>sum+n,0),activationEnabled:false as const}
 let receivedChunks=0,receivedRows=0
 const progress=(stage:SeedProgress['stage'])=>options.onProgress?.({...base,stage,receivedChunks,receivedRows})
 progress('checking');await check()
 const health=z.object({ok:z.literal(true),seedStagingEnabled:z.literal(true),seedingEnabled:z.literal(false)}).safeParse(await transport('/health',undefined,signal))
 if(!health.success)throw new Error('La préparation serveur est désactivée. Aucun envoi effectué.')
 await check()
 const created=z.object({ok:z.literal(true),jobId:z.string(),status:z.enum(['approved','uploading','verified'])}).parse(await transport('/seed/jobs',manifest,signal))
 if(created.jobId!==manifest.jobId)throw new Error('Le serveur a retourné une autre préparation')
 const status=statusSchema.parse(await transport(`/seed/jobs/${manifest.jobId}`,undefined,signal))
 if(status.id!==manifest.jobId || status.manifest_hash!==digest(canonical(manifest)) || status.status==='cancelled')throw new Error('La préparation serveur ne correspond pas au plan local')
 const received=new Set<number>()
 for(const receipt of status.chunks){
  const expected=manifest.chunks[receipt.chunk_index]
  if(received.has(receipt.chunk_index) || !expected || receipt.payload_hash!==expected.sha256 || receipt.row_count!==expected.rowCount)throw new Error('Les reçus du serveur ne correspondent pas au plan')
  received.add(receipt.chunk_index);receivedChunks++;receivedRows+=expected.rowCount
 }
 if(status.status==='verified' && received.size!==chunks.length)throw new Error('La préparation vérifiée est incomplète')
 progress('uploading')
 for(let index=0;index<chunks.length;index++){
  if(received.has(index))continue
  await check()
  receiptSchema.parse(await transport(`/seed/jobs/${manifest.jobId}/chunks/${index}`,chunks[index],signal))
  receivedChunks++;receivedRows+=chunks[index].length;progress('uploading')
 }
 await check();progress('verifying')
 const result=z.object({ok:z.literal(true),status:z.literal('verified'),activationEnabled:z.literal(false)}).parse(await transport(`/seed/jobs/${manifest.jobId}/verify`,{},signal))
 progress('verified')
 return {...result,jobId:manifest.jobId}
}


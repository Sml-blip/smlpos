import type { Hono } from 'hono'
import type { Pool, PoolClient } from 'pg'
import { z } from 'zod'
import { ApiError, canonical, digest, registry, uuid7, validateOperation } from './domain.ts'
import references from '../schema/references.json' with { type: 'json' }

type Identity={userId:string;deviceId:string;role:string}
type Variables={identity:Identity}
export { seedRowSchema,seedManifestSchema,seedContractHash } from './seedContract.ts'
export type { SeedRow,SeedManifest } from './seedContract.ts'
import { seedRowSchema,seedManifestSchema,seedContractHash } from './seedContract.ts'
import type { SeedManifest } from './seedContract.ts'
const quote=(s:string)=>`"${s}"` // All callers use registry or generated reference identifiers.
const moneyColumns=Object.entries(registry).flatMap(([table,definition])=>Object.entries(definition.columns).filter(([,column])=>column.type==='money').map(([column])=>`${table}.${column}`))

function validateManifest(manifest:SeedManifest){
 if(manifest.contractHash!==seedContractHash)throw new ApiError(409,'SEED_CONTRACT_CHANGED','Le contrat de migration a changé : régénérez la préparation')
 if(canonical(Object.keys(manifest.expectedCounts).sort())!==canonical(Object.keys(registry).sort()))throw new ApiError(422,'SEED_TABLE_COVERAGE','Toutes les tables doivent figurer dans le manifeste')
 if(canonical(Object.keys(manifest.expectedMoneyTotals).sort())!==canonical([...moneyColumns].sort()))throw new ApiError(422,'SEED_MONEY_COVERAGE','Tous les totaux monétaires doivent figurer dans le manifeste')
 if(manifest.chunks.some((chunk,index)=>chunk.index!==index))throw new ApiError(422,'SEED_CHUNK_SEQUENCE','Séquence de lots invalide')
 const count=Object.values(manifest.expectedCounts).reduce((sum,n)=>sum+n,0)
 if(count!==manifest.chunks.reduce((sum,chunk)=>sum+chunk.rowCount,0))throw new ApiError(422,'SEED_ROW_COUNT','Le nombre de lignes ne correspond pas aux lots')
}

async function transaction<T>(pool:Pool,work:(client:PoolClient)=>Promise<T>):Promise<T>{
 const client=await pool.connect()
 try{await client.query('BEGIN');const result=await work(client);await client.query('COMMIT');return result}
 catch(error){await client.query('ROLLBACK');throw error}
 finally{client.release()}
}
async function ownedJob(client:PoolClient,id:string,identity:Identity,allowCancelled=false){
 const job=(await client.query('SELECT * FROM seed_jobs WHERE id=$1 FOR UPDATE',[id])).rows[0]
 if(!job || job.device_id!==identity.deviceId)throw new ApiError(404,'SEED_JOB_MISSING','Préparation introuvable pour ce poste')
 if(job.status==='cancelled' && !allowCancelled)throw new ApiError(409,'SEED_CANCELLED','Préparation annulée')
 return job as {id:string;status:string;manifest:SeedManifest;device_id:string}
}

/** Stages and verifies a seed, but never writes into the published business tables.
 * Publication/activation is a separate release gate, even after verification. */
export function registerSeedRoutes(app:Hono<{Variables:Variables}>,pool:Pool,enabled:boolean){
 app.use('/seed/*',async(c,next)=>{
  if(c.get('identity').role!=='admin')throw new ApiError(403,'ROLE_FORBIDDEN','Administrateur requis')
  if(!enabled)throw new ApiError(503,'SEED_STAGING_DISABLED','Préparation serveur non activée')
  await next()
 })
 app.get('/seed/contract',c=>c.json({version:1,contractHash:seedContractHash,tables:Object.keys(registry),moneyColumns,activationEnabled:false}))
 app.post('/seed/jobs',async c=>{
  const identity=c.get('identity');const manifest=seedManifestSchema.parse(await c.req.json());validateManifest(manifest)
  const hash=digest(canonical(manifest))
  const result=await transaction(pool,async client=>{
   await client.query('SELECT pg_advisory_xact_lock(7311044)')
   const previous=(await client.query('SELECT device_id,manifest_hash,status FROM seed_jobs WHERE id=$1',[manifest.jobId])).rows[0]
   if(previous){
    if(previous.device_id!==identity.deviceId || previous.manifest_hash!==hash || previous.status==='cancelled')throw new ApiError(409,'SEED_MANIFEST_CONFLICT','Cette préparation existe avec un autre contenu ou un autre poste')
    return {ok:true,replayed:true,jobId:manifest.jobId,status:previous.status}
   }
   if((await client.query("SELECT 1 FROM seed_jobs WHERE status<>'cancelled' LIMIT 1")).rowCount)throw new ApiError(409,'SEED_ALREADY_EXISTS','Une préparation source existe déjà')
   // Refuse accidental replacement of any existing business history.
   for(const name of Object.keys(registry))if((await client.query(`SELECT 1 FROM ${quote(name)} LIMIT 1`)).rowCount)throw new ApiError(409,'BUSINESS_NOT_EMPTY','Le serveur contient déjà des données métier')
   await client.query('UPDATE devices SET importer=true WHERE id=$1',[identity.deviceId])
   await client.query("INSERT INTO seed_jobs(id,device_id,manifest_hash,status,approved_by,expected_counts,manifest) VALUES($1,$2,$3,'approved',$4,$5,$6)",[manifest.jobId,identity.deviceId,hash,identity.userId,manifest.expectedCounts,manifest])
   return {ok:true,replayed:false,jobId:manifest.jobId,status:'approved'}
  })
  return c.json(result)
 })
 app.get('/seed/jobs/:id',async c=>{
  const id=uuid7.parse(c.req.param('id'));const identity=c.get('identity')
  const job=(await pool.query('SELECT id,status,manifest_hash,expected_counts,created_at,verified_at FROM seed_jobs WHERE id=$1 AND device_id=$2',[id,identity.deviceId])).rows[0]
  if(!job)throw new ApiError(404,'SEED_JOB_MISSING','Préparation introuvable pour ce poste')
  const chunks=(await pool.query('SELECT chunk_index,payload_hash,row_count FROM seed_chunks WHERE job_id=$1 ORDER BY chunk_index',[id])).rows
  return c.json({...job,chunks,activationEnabled:false})
 })
 app.post('/seed/jobs/:id/chunks/:index',async c=>{
  const id=uuid7.parse(c.req.param('id'));const index=z.coerce.number().int().nonnegative().max(24_999).parse(c.req.param('index'))
  const rows=z.array(seedRowSchema).min(1).max(500).parse(await c.req.json());const hash=digest(canonical(rows));const identity=c.get('identity')
  const result=await transaction(pool,async client=>{
   const job=await ownedJob(client,id,identity);const expected=job.manifest.chunks[index]
   if(!expected || expected.sha256!==hash || expected.rowCount!==rows.length)throw new ApiError(409,'SEED_CHUNK_MISMATCH','Le lot ne correspond pas au manifeste')
   const previous=(await client.query('SELECT payload_hash FROM seed_chunks WHERE job_id=$1 AND chunk_index=$2',[id,index])).rows[0]
   if(previous){if(previous.payload_hash!==hash)throw new ApiError(409,'SEED_CHUNK_CONFLICT','Lot déjà reçu avec un autre contenu');return {ok:true,replayed:true}}
   if(job.status==='verified')throw new ApiError(409,'SEED_ALREADY_VERIFIED','Préparation déjà vérifiée')
   for(const row of rows){
    validateOperation({op:'PUT',table:row.table,id:row.id,data:row.data},'admin','seed')
    if(row.table==='stock_movements' && row.data.qty_delta===0)throw new ApiError(422,'ZERO_MOVEMENT','Mouvement nul')
    if(row.table==='account_movements' && !['customer_credit','supplier_debt','loyalty','staff_advance','staff_credit'].includes(String(row.data.account_kind)))throw new ApiError(422,'SEED_OPENING_POLICY_REQUIRED','Politique de compte à définir avant migration')
    if(row.table.endsWith('_movements') && (row.data.ref_type!=='seed_opening' || row.data.ref_id!==id || row.data.reason!=='legacy_snapshot_cutover'))throw new ApiError(422,'SEED_OPENING_POLICY_REQUIRED','Les mouvements initiaux doivent correspondre à cette préparation')
   }
   await client.query('INSERT INTO seed_chunks(job_id,chunk_index,payload_hash,row_count) VALUES($1,$2,$3,$4)',[id,index,hash,rows.length])
   for(const row of rows){
    const inserted=await client.query('INSERT INTO seed_rows(job_id,table_name,row_id,chunk_index,data,source_created_at,source_updated_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(job_id,table_name,row_id) DO NOTHING RETURNING row_id',[id,row.table,row.id,index,row.data,row.sourceCreatedAt,row.sourceUpdatedAt])
    if(!inserted.rowCount)throw new ApiError(422,'SEED_DUPLICATE_ROW','La même ligne apparaît dans plusieurs lots')
   }
   await client.query("UPDATE seed_jobs SET status='uploading' WHERE id=$1",[id])
   return {ok:true,replayed:false}
  })
  return c.json(result)
 })
 app.post('/seed/jobs/:id/verify',async c=>{
  const id=uuid7.parse(c.req.param('id'));const identity=c.get('identity')
  const result=await transaction(pool,async client=>{
   const job=await ownedJob(client,id,identity)
   if(job.status==='verified')return {ok:true,replayed:true,status:'verified',activationEnabled:false}
   const chunks=(await client.query('SELECT chunk_index,payload_hash,row_count FROM seed_chunks WHERE job_id=$1 ORDER BY chunk_index',[id])).rows
   if(chunks.length!==job.manifest.chunks.length || chunks.some((chunk,i)=>chunk.chunk_index!==i || chunk.payload_hash!==job.manifest.chunks[i].sha256 || chunk.row_count!==job.manifest.chunks[i].rowCount))throw new ApiError(409,'SEED_INCOMPLETE','Des lots restent à envoyer')
   const counts=Object.fromEntries(Object.keys(registry).map(name=>[name,0]))
   for(const row of (await client.query('SELECT table_name,count(*)::integer n FROM seed_rows WHERE job_id=$1 GROUP BY table_name',[id])).rows)counts[row.table_name]=row.n
   if(canonical(counts)!==canonical(job.manifest.expectedCounts))throw new ApiError(422,'SEED_COUNTS_MISMATCH','Les nombres de lignes ne correspondent pas')
   // SUM numeric in Postgres, read as strings; never round a floating-point aggregate.
   for(const key of moneyColumns){
    const [table,column]=key.split('.')
    const value=(await client.query("SELECT COALESCE(sum((data->>$3)::numeric),0)::text total FROM seed_rows WHERE job_id=$1 AND table_name=$2",[id,table,column])).rows[0].total
    if(BigInt(value)!==BigInt(job.manifest.expectedMoneyTotals[key]))throw new ApiError(422,'SEED_TOTAL_MISMATCH',`Total de migration différent : ${key}`)
   }
   for(const reference of references){
    const missing=await client.query(`SELECT 1 FROM seed_rows s WHERE s.job_id=$1 AND s.table_name=$2 AND s.data->>$3 IS NOT NULL AND NOT EXISTS(SELECT 1 FROM seed_rows t WHERE t.job_id=s.job_id AND t.table_name=$4 AND t.row_id::text=s.data->>$3) LIMIT 1`,[id,reference.table,reference.column,reference.target])
    if(missing.rowCount)throw new ApiError(422,'SEED_REFERENCE_MISSING',`Référence absente : ${reference.table}.${reference.column}`)
   }
   const missingAccountOwner=await client.query(`SELECT 1 FROM seed_rows s WHERE s.job_id=$1 AND s.table_name='account_movements' AND NOT EXISTS(SELECT 1 FROM seed_rows t WHERE t.job_id=s.job_id AND t.table_name=CASE s.data->>'account_kind' WHEN 'customer_credit' THEN 'clients' WHEN 'loyalty' THEN 'clients' WHEN 'supplier_debt' THEN 'fournisseurs' ELSE 'personnels' END AND t.row_id::text=s.data->>'owner_id') LIMIT 1`,[id])
   if(missingAccountOwner.rowCount)throw new ApiError(422,'SEED_REFERENCE_MISSING','Titulaire de compte absent')
   // Check uniqueness before marking a staged import as structurally verified.
   const uniqueColumns=[['produits','reference'],['produits','code_barre'],['categories','nom'],['operateurs','identifiant'],['ventes','numero'],['documents','numero'],['factures_clients','numero'],['reparations','numero'],['avances_clients','numero'],['app_settings','key']]
   for(const [table,column] of uniqueColumns){
    const duplicates=await client.query("SELECT 1 FROM seed_rows WHERE job_id=$1 AND table_name=$2 AND data->>$3 IS NOT NULL GROUP BY data->>$3 HAVING count(*)>1 LIMIT 1",[id,table,column])
    if(duplicates.rowCount)throw new ApiError(422,'SEED_UNIQUE_CONFLICT',`Doublon à examiner : ${table}.${column}`)
   }
   const serials=await client.query("SELECT 1 FROM seed_rows WHERE job_id=$1 AND table_name='serial_numbers' AND data->>'produit_id' IS NOT NULL AND data->>'numero_serie' IS NOT NULL GROUP BY data->>'produit_id',lower(trim(data->>'numero_serie')) HAVING count(*)>1 LIMIT 1",[id])
   if(serials.rowCount)throw new ApiError(422,'SEED_SERIAL_CONFLICT','Numéros de série en doublon')
   await client.query("UPDATE seed_jobs SET status='verified',verified_at=now() WHERE id=$1",[id])
   return {ok:true,replayed:false,status:'verified',activationEnabled:false}
  })
  return c.json(result)
 })
 app.post('/seed/jobs/:id/cancel',async c=>{
  const id=uuid7.parse(c.req.param('id'));const identity=c.get('identity')
  await transaction(pool,async client=>{
   await client.query('SELECT pg_advisory_xact_lock(7311044)')
   const job=await ownedJob(client,id,identity,true)
   if(job.status==='cancelled')return
   await client.query("UPDATE seed_jobs SET status='cancelled' WHERE id=$1",[id])
   await client.query('UPDATE devices SET importer=false WHERE id=$1',[identity.deviceId])
  })
  return c.json({ok:true})
 })
}


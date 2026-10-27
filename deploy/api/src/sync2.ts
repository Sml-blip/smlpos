import type { Hono } from 'hono'
import type { Pool,PoolClient } from 'pg'
import { z } from 'zod'
import { ApiError,canonical,digest,newId,uuid7 } from './domain.ts'
import { addStats,contract,counterFields,deltaAllowlist,emptyStats,manifestSchema,rowId,snapshotHash,validateManifest,validateRow } from './sync2Contract.ts'
import type { Manifest } from './sync2Contract.ts'
type Identity={deviceId:string;userId:string;role:string}
type App=Hono<{Variables:{identity:Identity}}>
const jsonRow=z.record(z.string(),z.unknown())
const rowPushOp=z.object({opId:rowId,table:z.string(),rowId,op:z.enum(['INSERT','UPDATE','DELETE']),payload:jsonRow,baseVersion:z.string().regex(/^\d+$/).optional()}).strict()
const deltaPushOp=z.object({opId:rowId,table:z.string(),rowId,op:z.literal('DELTA'),field:z.string().min(1).max(100),value:z.number()}).strict()
const pushOp=z.union([rowPushOp,deltaPushOp])
const immutable=new Set(['ventes','factures_clients','paiements_fournisseurs','credits_clients','mouvements_fidelite','mouvements_personnels','stock_movements','remboursements_ventes'])
async function tx<T>(pool:Pool,work:(client:PoolClient)=>Promise<T>){const client=await pool.connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(7311050)');const value=await work(client);await client.query('COMMIT');return value}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}}
async function seed(client:PoolClient,id:string,identity:Identity){
 const row=(await client.query('SELECT * FROM sync2_seeds WHERE id=$1 AND device_id=$2 FOR UPDATE',[id,identity.deviceId])).rows[0]
 if(!row)throw new ApiError(404,'SEED_NOT_FOUND','Préparation introuvable')
 return row as {id:string;manifest:Manifest;manifest_hash:string;status:string;snapshot_seq:string|null}
}
async function stats(client:PoolClient,seedId:string,table:string){
 const result=emptyStats(table);let cursor=''
 while(true){
  const rows=(await client.query('SELECT row_id,payload FROM sync2_seed_rows WHERE seed_id=$1 AND table_name=$2 AND row_id COLLATE "C">$3 COLLATE "C" ORDER BY row_id COLLATE "C" LIMIT 1000',[seedId,table,cursor])).rows
  for(const row of rows)addStats(result,row.row_id,row.payload)
  if(rows.length<1000)break
  cursor=rows.at(-1)!.row_id
 }
 return result
}
async function publish(client:PoolClient,table:string,id:string,payload:Record<string,unknown>,deleted=false,event:{operation?:'UPSERT'|'DELTA';field?:string;value?:number;payload?:Record<string,unknown>}={}){
 const version=String((await client.query("SELECT nextval('sync2_seq') n")).rows[0].n)
 await client.query('INSERT INTO sync2_records(table_name,row_id,payload,version,deleted) VALUES($1,$2,$3,$4,$5) ON CONFLICT(table_name,row_id) DO UPDATE SET payload=excluded.payload,version=excluded.version,deleted=excluded.deleted',[table,id,payload,version,deleted])
 await client.query('INSERT INTO sync2_changes(seq,table_name,row_id,payload,deleted,operation,delta_field,delta_value) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[version,table,id,event.payload??payload,deleted,event.operation??'UPSERT',event.field??null,event.value??null])
 return version
}
const business=(payload:Record<string,unknown>)=>Object.fromEntries(Object.entries(payload).filter(([key])=>!['updated_at','device_id','deleted_at'].includes(key)))
export function registerSync2Routes(app:App,pool:Pool,enabled:boolean){
 app.use('/sync2/*',async(c,next)=>{if(!enabled)throw new ApiError(503,'SYNC2_DISABLED','Synchronisation VPS en préparation');await next()})
 app.get('/sync2/contract',c=>c.json({schemaVersion:2,tables:contract,seedActivationSupported:true}))
 app.get('/sync2/verification',async c=>{
  const client=await pool.connect()
  try{
   await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
   if(!(await client.query("SELECT 1 FROM sync2_seeds WHERE status='active' LIMIT 1")).rowCount)throw new ApiError(409,'SEED_REQUIRED','Les données de l’entreprise ne sont pas encore prêtes')
   const seq=(await client.query('SELECT COALESCE(MAX(seq),0)::text server_seq FROM sync2_changes')).rows[0].server_seq
   const serverSeq=Number(seq)
   if(!Number.isSafeInteger(serverSeq)||serverSeq<0)throw new ApiError(500,'SYNC_SEQUENCE_RANGE','Position de synchronisation invalide')
   const tables:Record<string,{count:number;moneyTotals:Record<string,string>}>=Object.create(null)
   for(const [table,schema] of Object.entries(contract)){
    const fields=Object.entries(schema.columns).filter(([,kind])=>kind==='money').map(([field])=>field)
    const sums=fields.map((field,index)=>`COALESCE(SUM(COALESCE((payload->>$${index+2})::numeric,0)),0)::text AS "${field.replaceAll('"','""')}"`)
    const result=await client.query(`SELECT COUNT(*)::text AS count${sums.length?`,${sums.join(',')}`:''} FROM sync2_records WHERE table_name=$1 AND deleted=false`,[table,...fields])
    const count=Number(result.rows[0].count)
    if(!Number.isSafeInteger(count)||count<0)throw new ApiError(500,'SYNC_COUNT_RANGE','Nombre de lignes invalide')
    tables[table]={count,moneyTotals:Object.fromEntries(fields.map(field=>[field,String(result.rows[0][field]??'0')]))}
   }
   await client.query('COMMIT')
   return c.json({serverSeq,tables})
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
 })
 app.use('/sync2/seed/*',async(c,next)=>{if(c.get('identity').role!=='admin')throw new ApiError(403,'ROLE_FORBIDDEN','Administrateur requis');await next()})
 app.post('/sync2/seed/validate',async c=>{
  const input=z.object({table:z.string(),rows:z.array(jsonRow).max(500)}).strict().parse(await c.req.json())
  const blocking:Array<{id:string;reason:string}>=[]
  for(const row of input.rows)try{validateRow(input.table,row)}catch(error){blocking.push({id:String(row.id??row.key??''),reason:error instanceof Error?error.message:'Invalid row'})}
  return c.json({blocking,count:input.rows.length,writes:0})
 })
 app.post('/sync2/seed/start',async c=>{
  const identity=c.get('identity');const manifest=manifestSchema.parse(await c.req.json());validateManifest(manifest);const hash=digest(canonical(manifest))
  return c.json(await tx(pool,async client=>{
   const previous=(await client.query('SELECT * FROM sync2_seeds LIMIT 1')).rows[0]
   if(previous){if(previous.device_id!==identity.deviceId||previous.manifest_hash!==hash)throw new ApiError(409,'SEED_CONFLICT','Un autre jeu de données ou poste source existe déjà');return {seedId:previous.id,status:previous.status}}
   if((await client.query('SELECT 1 FROM sync2_records LIMIT 1')).rowCount)throw new ApiError(409,'BUSINESS_NOT_EMPTY','Le serveur contient déjà des données')
   const seedId=newId();await client.query("INSERT INTO sync2_seeds(id,device_id,manifest,manifest_hash,status) VALUES($1,$2,$3,$4,'uploading')",[seedId,identity.deviceId,manifest,hash]);return {seedId,status:'uploading'}
  }))
 })
 app.post('/sync2/seed/batch',async c=>{
  const input=z.object({seedId:uuid7,batchId:snapshotHash,table:z.string(),rows:z.array(jsonRow).min(1).max(500)}).strict().parse(await c.req.json());const identity=c.get('identity');const hash=digest(canonical(input))
  const ids=input.rows.map(row=>validateRow(input.table,row))
  if(new Set(ids).size!==ids.length)throw new ApiError(422,'DUPLICATE_ID','Identifiant répété dans le lot')
  return c.json(await tx(pool,async client=>{
   const job=await seed(client,input.seedId,identity)
   const existing=(await client.query('SELECT payload_hash FROM sync2_batches WHERE seed_id=$1 AND batch_id=$2',[input.seedId,input.batchId])).rows[0]
   if(existing){if(existing.payload_hash!==hash)throw new ApiError(409,'BATCH_CHANGED','Contenu du lot modifié');return {accepted:0,duplicate:input.rows.length}}
   if(job.status!=='uploading')throw new ApiError(409,'SEED_FROZEN','Préparation déjà vérifiée')
   let accepted=0,duplicate=0
   for(let index=0;index<input.rows.length;index++){
    const row=input.rows[index],id=ids[index]
    const old=(await client.query('SELECT payload FROM sync2_seed_rows WHERE seed_id=$1 AND table_name=$2 AND row_id=$3',[input.seedId,input.table,id])).rows[0]
    if(old){if(canonical(old.payload)!==canonical(row))throw new ApiError(409,'ROW_CHANGED','Une ligne de la copie a changé');duplicate++}
    else{await client.query('INSERT INTO sync2_seed_rows(seed_id,table_name,row_id,payload) VALUES($1,$2,$3,$4)',[input.seedId,input.table,id,row]);accepted++}
   }
   await client.query('INSERT INTO sync2_batches(seed_id,batch_id,payload_hash) VALUES($1,$2,$3)',[input.seedId,input.batchId,hash]);return {accepted,duplicate}
  }))
 })
 app.post('/sync2/seed/verify',async c=>{
  const {seedId}=z.object({seedId:uuid7}).strict().parse(await c.req.json());const identity=c.get('identity')
  return c.json(await tx(pool,async client=>{
   const job=await seed(client,seedId,identity);const actual:Record<string,unknown>={};const mismatches:string[]=[]
   for(const table of Object.keys(contract)){actual[table]=await stats(client,seedId,table);if(canonical(actual[table])!==canonical(job.manifest.expected[table]))mismatches.push(table)}
   if(!mismatches.length && job.status==='uploading')await client.query("UPDATE sync2_seeds SET status='verified' WHERE id=$1",[seedId])
   return {ok:!mismatches.length,actual,mismatches,status:mismatches.length?'NEEDS_REVIEW':job.status==='active'?'active':'verified'}
  }))
 })
 app.post('/sync2/seed/activate',async c=>{
  const {seedId,reviewedManifestHash}=z.object({seedId:uuid7,reviewedManifestHash:snapshotHash}).strict().parse(await c.req.json());const identity=c.get('identity')
  return c.json(await tx(pool,async client=>{
   const job=await seed(client,seedId,identity)
   if(job.manifest_hash!==reviewedManifestHash)throw new ApiError(409,'REVIEW_CHANGED','Le rapport approuvé ne correspond pas')
   if(job.status==='active'){
    if(job.snapshot_seq===null)throw new ApiError(409,'SEED_BOUNDARY_REQUIRED','Cette préparation ancienne nécessite une vérification de sa position de synchronisation')
    return {ok:true,replayed:true,snapshotSeq:Number(job.snapshot_seq)}
   }
   if(job.status!=='verified')throw new ApiError(409,'SEED_NOT_VERIFIED','Vérification requise')
   if((await client.query('SELECT 1 FROM sync2_records LIMIT 1')).rowCount)throw new ApiError(409,'BUSINESS_NOT_EMPTY','Activation refusée sur une base non vide')
   await client.query("INSERT INTO sync2_records(table_name,row_id,payload,version) SELECT table_name,row_id,payload,nextval('sync2_seq') FROM sync2_seed_rows WHERE seed_id=$1 ORDER BY table_name,row_id",[seedId])
   await client.query('INSERT INTO sync2_changes(seq,table_name,row_id,payload,deleted) SELECT version,table_name,row_id,payload,deleted FROM sync2_records ORDER BY version')
   const snapshotSeq=Number((await client.query('SELECT COALESCE(MAX(seq),0)::text n FROM sync2_changes')).rows[0].n)
   if(!Number.isSafeInteger(snapshotSeq))throw new ApiError(500,'SYNC_SEQUENCE_RANGE','Position de synchronisation invalide')
   // The verified desktop stock is the opening balance. Any ledger already
   // supplied by the seed is retained; only its difference is established here.
   const products=(await client.query("SELECT row_id,payload FROM sync2_records WHERE table_name='produits' AND deleted=false")).rows
   const totals=new Map((await client.query("SELECT payload->>'produit_id' id, SUM((payload->>'delta')::numeric)::text total FROM sync2_records WHERE table_name='stock_movements' AND deleted=false GROUP BY payload->>'produit_id'")).rows.map(row=>[String(row.id),BigInt(row.total)]))
   for(const product of products){
    const difference=BigInt(product.payload.stock_actuel??0)-(totals.get(product.row_id)??0n)
    if(difference===0n)continue
    const delta=Number(difference)
    if(!Number.isSafeInteger(delta))throw new ApiError(422,'INVALID_STOCK','Solde initial hors limites')
    const id='seed-opening:'+digest(product.row_id)
    const movement={id,produit_id:product.row_id,delta,reason:'OPENING_BALANCE',ref_id:seedId,device_id:identity.deviceId,created_at:new Date().toISOString()}
    validateRow('stock_movements',movement)
    await publish(client,'stock_movements',id,movement)
   }
   await client.query("UPDATE sync2_seeds SET status='active',snapshot_seq=$2 WHERE id=$1",[seedId,snapshotSeq]);return {ok:true,replayed:false,snapshotSeq}
  }))
 })
 app.post('/sync2/push',async c=>{
  const input=z.object({ops:z.array(pushOp).min(1).max(500)}).strict().parse(await c.req.json());const identity=c.get('identity');const results=[]
  for(const op of input.ops){
   results.push(await tx(pool,async client=>{
    const hash=digest(canonical(op));const oldOp=(await client.query('SELECT device_id,payload_hash,result FROM sync2_operations WHERE op_id=$1',[op.opId])).rows[0]
    if(oldOp){if(oldOp.device_id!==identity.deviceId||oldOp.payload_hash!==hash)throw new ApiError(409,'OP_CHANGED','Identifiant opération déjà utilisé');return {...oldOp.result,status:oldOp.result.status==='applied'?'duplicate':oldOp.result.status}}
    const reject=async(code:string,reason:string)=>{const result={opId:op.opId,status:'rejected',code,reason};await client.query('INSERT INTO sync2_operations(op_id,device_id,payload_hash,result) VALUES($1,$2,$3,$4)',[op.opId,identity.deviceId,hash,result]);return result}
    if(!(await client.query("SELECT 1 FROM sync2_seeds WHERE status='active' LIMIT 1")).rowCount)return reject('SEED_REQUIRED','Import initial non activé')
    if(op.op==='DELTA'){
     const kind=deltaAllowlist[op.table]?.[op.field]
     if(!kind)return reject('DELTA_NOT_ALLOWED',`Variation interdite : ${op.table}.${op.field}`)
     if(!Number.isSafeInteger(op.value))return reject('INVALID_DELTA','La variation doit être un entier sûr (unités ou millimes)')
     if(op.value===0)return reject('ZERO_DELTA','Une variation nulle est interdite')
     const target=(await client.query('SELECT payload,deleted FROM sync2_records WHERE table_name=$1 AND row_id=$2 FOR UPDATE',[op.table,op.rowId])).rows[0] as {payload:Record<string,unknown>;deleted:boolean}|undefined
     if(!target||target.deleted)return reject('DELTA_TARGET_MISSING','La ligne à modifier est absente ou supprimée')
     const current=Number(target.payload[op.field]??0)
     if(!Number.isSafeInteger(current))return reject('INVALID_COUNTER_STATE','Le compteur serveur est invalide')
     if(kind==='stock'){
      const product=(await client.query("SELECT payload FROM sync2_records WHERE table_name='produits' AND row_id=$1 AND deleted=false FOR UPDATE",[op.rowId])).rows[0]
      if(!product)return reject('DELTA_TARGET_MISSING','Produit introuvable pour ce mouvement de stock')
      const total=(await client.query("SELECT COALESCE(sum((payload->>'delta')::numeric),0)::text n FROM sync2_records WHERE table_name='stock_movements' AND deleted=false AND payload->>'produit_id'=$1",[op.rowId])).rows[0].n
      const stock=Number(total)+op.value
      if(!Number.isSafeInteger(stock))return reject('STOCK_RANGE','Le stock recalculé dépasse la plage entière sûre')
      const movementId=newId()
      const movement={id:movementId,produit_id:op.rowId,delta:op.value,reason:'SYNC2_DELTA',ref_id:op.opId,device_id:identity.deviceId,created_at:new Date().toISOString()}
      try{validateRow('stock_movements',movement)}catch(error){return reject(error instanceof ApiError?error.code:'INVALID_STOCK',error instanceof Error?error.message:'Mouvement de stock invalide')}
      await publish(client,'stock_movements',movementId,movement)
      const nextProduct={...product.payload,stock_actuel:stock,device_id:identity.deviceId}
      const eventPayload=Object.fromEntries(Object.entries(nextProduct).filter(([field])=>!counterFields('produits').includes(field)))
      const version=await publish(client,'produits',op.rowId,nextProduct,false,{operation:'DELTA',field:op.field,value:op.value,payload:eventPayload})
      const result={opId:op.opId,status:'applied',version};await client.query('INSERT INTO sync2_operations(op_id,device_id,payload_hash,result) VALUES($1,$2,$3,$4)',[op.opId,identity.deviceId,hash,result]);return result
     }
     const nextValue=current+op.value
     if(!Number.isSafeInteger(nextValue))return reject('COUNTER_RANGE','Le compteur dépasse la plage entière sûre')
     const nextPayload={...target.payload,[op.field]:nextValue,device_id:identity.deviceId}
     const eventPayload={...nextPayload};delete eventPayload[op.field]
     const version=await publish(client,op.table,op.rowId,nextPayload,false,{operation:'DELTA',field:op.field,value:op.value,payload:eventPayload})
     const result={opId:op.opId,status:'applied',version};await client.query('INSERT INTO sync2_operations(op_id,device_id,payload_hash,result) VALUES($1,$2,$3,$4)',[op.opId,identity.deviceId,hash,result]);return result
    }
    try{const id=validateRow(op.table,op.payload);if(id!==op.rowId)return reject('ROW_ID_CHANGED','Identifiant de ligne différent')}
    catch(error){return reject(error instanceof ApiError?error.code:'INVALID_ROW',error instanceof Error?error.message:'Ligne invalide')}
    const previous=(await client.query('SELECT * FROM sync2_records WHERE table_name=$1 AND row_id=$2 FOR UPDATE',[op.table,op.rowId])).rows[0]
    if(previous?.deleted && op.op!=='DELETE')return reject('ROW_DELETED','Une ligne supprimée ne peut pas être ressuscitée')
    if(op.baseVersion && previous && BigInt(op.baseVersion)>BigInt(previous.version))return reject('INVALID_VERSION','Version serveur inconnue')
    const frozen=immutable.has(op.table)||(op.table==='documents'&&['FACTURE','AVOIR'].includes(String(previous?.payload.type_document)))
    if(frozen && previous && (op.op==='DELETE'||canonical(business(previous.payload))!==canonical(business(op.payload))))return reject('IMMUTABLE_ROW','Historique immuable : créez une correction')
    if(op.table==='stock_movements' && op.op==='DELETE')return reject('IMMUTABLE_ROW','Un mouvement de stock ne peut pas être supprimé')
    let payload:Record<string,unknown>={...op.payload,device_id:identity.deviceId}
    const fields=counterFields(op.table)
    for(const field of fields){
     if(op.table==='produits')continue
     const stored=previous?.payload[field]
     const requested=op.payload[field]
     if(requested!==undefined&&stored!==undefined&&requested!==stored)return reject('COUNTER_DELTA_REQUIRED',`Utilisez DELTA pour modifier ${op.table}.${field}`)
     if(requested!==undefined&&stored===undefined&&requested!==0)return reject('COUNTER_DELTA_REQUIRED',`Utilisez DELTA pour initialiser ${op.table}.${field}`)
     if(stored===undefined)delete payload[field]
     else payload[field]=stored
    }
    let eventPayload={...payload}
    for(const field of fields)delete eventPayload[field]
    let stockDelta:number|undefined
    let stockProduct:Record<string,unknown>|undefined
    if(op.table==='produits'){
     const qty=(await client.query("SELECT COALESCE(sum((payload->>'delta')::numeric),0)::text n FROM sync2_records WHERE table_name='stock_movements' AND deleted=false AND payload->>'produit_id'=$1",[op.rowId])).rows[0].n
     payload={...payload,stock_actuel:Number(qty)}
     eventPayload={...payload};for(const field of fields)delete eventPayload[field]
    }
    if(op.table==='stock_movements'&&op.op!=='DELETE'){
     if(Number(payload.delta)===0)return reject('ZERO_MOVEMENT','Un mouvement de stock nul est interdit')
     const productId=String(payload.produit_id)
     stockProduct=(await client.query("SELECT payload FROM sync2_records WHERE table_name='produits' AND row_id=$1 AND deleted=false FOR UPDATE",[productId])).rows[0]?.payload
     if(!stockProduct)return reject('PRODUCT_MISSING','Produit du mouvement absent')
     const total=(await client.query("SELECT COALESCE(sum((payload->>'delta')::numeric),0)::text n FROM sync2_records WHERE table_name='stock_movements' AND deleted=false AND payload->>'produit_id'=$1",[productId])).rows[0].n
     stockDelta=Number(payload.delta)
     if(!Number.isSafeInteger(Number(total)+stockDelta))return reject('STOCK_RANGE','Le stock recalculé dépasse la plage entière sûre')
    }
    let version=await publish(client,op.table,op.rowId,payload,op.op==='DELETE',{payload:eventPayload})
    if(op.table==='stock_movements'){
     const qty=(await client.query("SELECT COALESCE(sum((payload->>'delta')::numeric),0)::text n FROM sync2_records WHERE table_name='stock_movements' AND deleted=false AND payload->>'produit_id'=$1",[String(payload.produit_id)])).rows[0].n
     const nextProduct={...stockProduct,stock_actuel:Number(qty),device_id:identity.deviceId}
     const productEvent=Object.fromEntries(Object.entries(nextProduct).filter(([field])=>!counterFields('produits').includes(field)))
     version=await publish(client,'produits',String(payload.produit_id),nextProduct,false,{operation:'DELTA',field:'stock_actuel',value:stockDelta!,payload:productEvent})
    }
    const result={opId:op.opId,status:'applied',version};await client.query('INSERT INTO sync2_operations(op_id,device_id,payload_hash,result) VALUES($1,$2,$3,$4)',[op.opId,identity.deviceId,hash,result]);return result
   }))
  }
  return c.json({results})
 })
 app.get('/sync2/pull',async c=>{
  const since=z.string().regex(/^\d+$/).max(20).parse(c.req.query('since')??'0');const limit=z.coerce.number().int().min(1).max(500).parse(c.req.query('limit')??500)
  if(!(await pool.query("SELECT 1 FROM sync2_seeds WHERE status='active' LIMIT 1")).rowCount)throw new ApiError(409,'SEED_REQUIRED','Import initial non activé')
  const rows=(await pool.query('SELECT seq::text,table_name,row_id,payload,deleted,operation,delta_field,delta_value::text FROM sync2_changes WHERE seq>$1 ORDER BY sync2_changes.seq LIMIT $2',[since,limit])).rows
  const changes=rows.map(row=>({seq:row.seq,table_name:row.table_name,row_id:row.row_id,payload:row.payload,deleted:row.deleted,op:row.deleted?'DELETE':row.operation,...(row.operation==='DELTA'?{field:row.delta_field,value:Number(row.delta_value)}:{})}))
  return c.json({rows:changes,nextSeq:rows.at(-1)?.seq??since,hasMore:rows.length===limit})
 })
}


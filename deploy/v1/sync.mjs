import { Fault,schema,transaction,one,validateRow,text,positive,sha,canonical } from './db.mjs'
const immutableFields={ventes:['numero','total_ttc','sous_total','total_remises'],factures_clients:['numero','total_ht','total_tva','total_ttc'],paiements_fournisseurs:['facture_id','fournisseur_id','montant'],remboursements_ventes:['vente_id','montant'],credits_clients:['client_id','montant'],mouvements_fidelite:['client_id','montant'],mouvements_personnels:['personnel_id','montant']}
const payload=async(db,table,pk)=>one(db,'SELECT * FROM v1_rows WHERE table_name=$1 AND pk=$2',[table,pk])
async function apply(db,device,op){
 const definition=schema.tables[op.table];text(op.pk);text(op.at,128)
 if(!definition)throw new Fault(422,'unknown_table')
 let pk=op.pk
 if(op.table==='caisse_interne'){
  const alias=await one(db,'SELECT canonical FROM v1_aliases WHERE table_name=$1 AND alias=$2',[op.table,pk]);if(alias)pk=alias.canonical
  if(op.op==='UPSERT'&&op.row?.date_journal){
   const existing=await one(db,"SELECT pk FROM v1_rows WHERE table_name='caisse_interne' AND NOT deleted AND payload->>'date_journal'=$1",[op.row.date_journal])
   if(existing&&existing.pk!==pk){pk=existing.pk;await db.query('INSERT INTO v1_aliases VALUES($1,$2,$3) ON CONFLICT(table_name,alias) DO UPDATE SET canonical=excluded.canonical',[op.table,op.pk,pk])}
  }
 }
 const old=await payload(db,op.table,pk),change={table:op.table,pk,op:op.op};let row
 if(op.op==='DELETE'){
  if(immutableFields[op.table]&&old&&!old.deleted)throw new Fault(422,'immutable_financial_record','Use a reversal or credit note')
  if(old)await db.query('UPDATE v1_rows SET deleted=true,deleted_by=$3,deleted_seq=$4 WHERE table_name=$1 AND pk=$2',[op.table,pk,device.id,op.seq])
 }else if(op.op==='DELTA'){
  if(!definition.counters.includes(op.field)||!Number.isSafeInteger(op.value))throw new Fault(422,'invalid_delta')
  if(!old||old.deleted)throw new Fault(422,'delta_target_missing')
  const value=(old.payload[op.field]??0)+op.value
  if(!Number.isSafeInteger(value))throw new Fault(422,'counter_overflow')
  row={...old.payload,[op.field]:value};change.field=op.field;change.value=op.value
 }else if(op.op==='UPSERT'){
  if(validateRow(op.table,op.row,{live:true})!==op.pk)throw new Fault(422,'identity_mismatch')
  if(old?.deleted&&(old.deleted_by!==device.id||Number(old.deleted_seq)!==op.seq-1))throw new Fault(409,'deleted_identity_reused')
  for(const field of immutableFields[op.table]??[])if(old&&!old.deleted&&canonical(old.payload[field]??null)!==canonical(op.row[field]??null))throw new Fault(422,'immutable_financial_record','Use a reversal or credit note')
  row={...op.row,[definition.pk]:pk}
  for(const counter of definition.counters)row[counter]=old?.payload[counter]??0
  if(op.table==='caisse_interne'&&pk!==op.pk&&old)row.solde_ouverture=old.payload.solde_ouverture
  for(const fk of definition.foreignKeys){
   const value=row[fk.from]
   if(value!=null&&schema.tables[fk.table]&&(!old||old.payload[fk.from]!==value)){
    const parent=await payload(db,fk.table,String(value));if(!parent||parent.deleted)throw new Fault(422,'foreign_key_missing',`${op.table}.${fk.from}`)
   }
  }
  change.row=Object.fromEntries(Object.entries(row).filter(([key])=>!definition.counters.includes(key)))
 }else throw new Fault(422,'invalid_operation')
 if(row)await db.query('INSERT INTO v1_rows(table_name,pk,payload) VALUES($1,$2,$3) ON CONFLICT(table_name,pk) DO UPDATE SET payload=excluded.payload,deleted=false,deleted_by=NULL,deleted_seq=NULL',[op.table,pk,row])
 const sequence=Number((await one(db,'INSERT INTO v1_changes(origin_device,change) VALUES($1,$2) RETURNING seq',[device.id,change])).seq)
 positive(sequence)
 return {seq:op.seq,status:'applied'}
}
export function syncRoutes(app,pool){
 app.use('/v1/sync/*',async(c,next)=>{if(!await one(pool,"SELECT 1 FROM v1_seed WHERE state='seeded'"))throw new Fault(409,'seed_required');await next()})
 app.post('/v1/sync/push',async c=>{
  const input=await c.req.json(),device=c.get('device')
  if(input.device_id!==device.id)throw new Fault(403,'device_mismatch')
  if(!Array.isArray(input.ops)||!input.ops.length||input.ops.length>200||Buffer.byteLength(JSON.stringify(input))>900000)throw new Fault(422,'invalid_batch')
  let previous=0
  for(const op of input.ops){positive(op.seq);if(op.seq<=previous)throw new Fault(422,'unordered_operations');previous=op.seq}
  return c.json(await transaction(pool,async db=>{
   const results=[]
   for(const op of input.ops){
    const hash=sha(canonical(op)),receipt=await one(db,'SELECT * FROM v1_receipts WHERE device_id=$1 AND seq=$2',[device.id,op.seq])
    if(receipt){results.push(receipt.hash!==hash?{seq:op.seq,status:'rejected',code:'identity_changed',message:'Sequence payload changed'}:receipt.result.status==='applied'?{seq:op.seq,status:'duplicate'}:receipt.result);continue}
    await db.query('SAVEPOINT live_op');let result
    try{result=await apply(db,device,op);await db.query('RELEASE live_op')}
    catch(error){
     await db.query('ROLLBACK TO live_op; RELEASE live_op')
     if(!(error instanceof Fault)&&error.code!=='23505')throw error
     result={seq:op.seq,status:'rejected',code:error.code==='23505'?'unique_conflict':error.code,message:error.code==='23505'?'Unique value already exists':error.message}
    }
    await db.query('INSERT INTO v1_receipts VALUES($1,$2,$3,$4)',[device.id,op.seq,hash,result]);results.push(result)
   }
   return {results,server_seq:Number((await one(db,'SELECT COALESCE(max(seq),0) n FROM v1_changes')).n)}
  }))
 })
 app.get('/v1/sync/pull',async c=>{
  const since=positive(Number(c.req.query('since')??0),true),limit=positive(Number(c.req.query('limit')??500));if(limit>500)throw new Fault(422,'invalid_limit')
  const rows=(await pool.query('SELECT seq,origin_device,change FROM v1_changes WHERE seq>$1 ORDER BY seq LIMIT $2',[since,limit+1])).rows,selected=rows.slice(0,limit)
  return c.json({changes:selected.map(row=>({...row.change,server_seq:Number(row.seq),origin_device:row.origin_device})),next_seq:selected.length?Number(selected.at(-1).seq):since,has_more:rows.length>limit})
 })
 app.get('/v1/sync/bootstrap',async c=>{
  const device=c.get('device'),table=c.req.query('table'),after=c.req.query('after')??'',limit=positive(Number(c.req.query('limit')??500)),requested=c.req.query('as_of_seq')
  if(!schema.tables[table]||limit>500||after.length>128||device.role!=='replica')throw new Fault(422,'invalid_bootstrap_request')
  return c.json(await transaction(pool,async db=>{
   let snapshot=await one(db,'SELECT * FROM v1_bootstrap WHERE device_id=$1 AND expires_at>now()',[device.id])
   if(!snapshot){
    if(requested!==undefined)throw new Fault(409,'bootstrap_expired')
    await db.query('DELETE FROM v1_bootstrap WHERE device_id=$1',[device.id])
    const anchor=Number((await one(db,'SELECT COALESCE(max(seq),0) n FROM v1_changes')).n)
    snapshot=await one(db,"INSERT INTO v1_bootstrap VALUES($1,$2,now()+interval '7 days') RETURNING *",[device.id,anchor])
    await db.query('INSERT INTO v1_bootstrap_rows SELECT $1,table_name,pk,payload FROM v1_rows WHERE NOT deleted',[device.id])
   }
   if(requested!==undefined&&positive(Number(requested),true)!==Number(snapshot.anchor))throw new Fault(409,'bootstrap_expired')
   const rows=(await db.query('SELECT payload FROM v1_bootstrap_rows WHERE device_id=$1 AND table_name=$2 AND pk COLLATE "C">$3 COLLATE "C" ORDER BY pk COLLATE "C" LIMIT $4',[device.id,table,after,limit+1])).rows
   return {rows:rows.slice(0,limit).map(row=>row.payload),as_of_seq:Number(snapshot.anchor),has_more:rows.length>limit}
  }))
 })
}

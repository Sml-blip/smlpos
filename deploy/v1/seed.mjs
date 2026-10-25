import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import { Fault,schema,transaction,one,validateRow,text,sha,canonical } from './db.mjs'
export const wireHash=(table,row)=>sha(JSON.stringify([table,Object.fromEntries(Object.keys(row).sort((a,b)=>a.localeCompare(b)).map(key=>[key,row[key]]))]))
export function checkExpected(expected){
 if(!expected||canonical(Object.keys(expected).sort())!==canonical(Object.keys(schema.tables).sort()))throw new Fault(422,'table_coverage')
 for(const [table,value] of Object.entries(expected)){
  const money=schema.tables[table].columns.filter(column=>column.kind==='money').map(column=>column.name).sort()
  if(!Number.isSafeInteger(value.rows)||value.rows<0||!/^[a-f0-9]{64}$/.test(value.digest)||canonical(Object.keys(value.money_sums_millimes??{}).sort())!==canonical(money)||Object.values(value.money_sums_millimes).some(n=>!Number.isSafeInteger(n)))throw new Fault(422,'invalid_expected')
 }
}
export async function seedJob(db,device,id){
 const job=await one(db,'SELECT * FROM v1_seed WHERE singleton=1')
 if(device.role!=='seed'||!job||job.id!==id||job.device_id!==device.id)throw new Fault(403,'seed_not_owned')
 return job
}
export function seedRoutes(app,pool){
 app.get('/v1/seed/preflight',async c=>{
  const job=await one(pool,'SELECT state,install_id FROM v1_seed WHERE singleton=1')
  return c.json({contract_version:1,state:job?.state??'empty',install_id:job?.install_id??null,tables:Object.fromEntries(Object.entries(schema.tables).map(([name,table])=>[name,{pk:table.pk,columns:table.columns.map(column=>column.name)}])),max_batch_rows:500,max_batch_bytes:900000})
 })
 app.post('/v1/seed/begin',async c=>{
  const input=await c.req.json(),device=c.get('device');checkExpected(input.expected)
  if(device.role!=='seed'||input.install_id!==device.install_id||!/^[a-f0-9]{64}$/.test(input.report_digest))throw new Fault(403,'seed_not_owned')
  return c.json(await transaction(pool,async db=>{
   const old=await one(db,'SELECT * FROM v1_seed WHERE singleton=1')
   if(old){
    if(old.install_id!==input.install_id||old.device_id!==device.id)throw new Fault(409,'installation_conflict')
    if(old.digest===input.report_digest){if(canonical(old.expected)!==canonical(input.expected))throw new Fault(409,'report_changed');return {seed_id:old.id}}
    // Never overwrite a finalized ledger with a stale snapshot. Live updates
    // must use the outbox after first finalization, including after a restart.
    if(old.state==='seeded')throw new Fault(409,'use_live_sync')
    if(await one(db,'SELECT 1 FROM v1_rows LIMIT 1'))throw new Fault(409,'snapshot_changed')
   }
   const id=randomUUID()
   await db.query("INSERT INTO v1_seed VALUES(1,$1,$2,$3,$4,$5,'seeding') ON CONFLICT(singleton) DO UPDATE SET id=excluded.id,digest=excluded.digest,expected=excluded.expected",[id,device.id,input.install_id,input.report_digest,input.expected])
   return {seed_id:id}
  }))
 })
 app.post('/v1/seed/batches',async c=>{
  const input=await c.req.json(),device=c.get('device'),definition=schema.tables[input.table]
  if(!Object.hasOwn(schema.tables,input.table)||!Array.isArray(input.rows)||!input.rows.length||input.rows.length>500||Buffer.byteLength(JSON.stringify(input))>900000)throw new Fault(422,'invalid_batch')
  const money=definition.columns.filter(column=>column.kind==='money').map(column=>column.name).sort()
  if(canonical([...(input.money_columns??[])].sort())!==canonical(money))throw new Fault(422,'money_coverage')
  return c.json(await transaction(pool,async db=>{
   const job=await seedJob(db,device,input.seed_id),result={accepted:0,duplicates:0,rejected:[]}
   for(const item of input.rows){
    await db.query('SAVEPOINT seed_row')
    try{
     const pk=validateRow(input.table,item.row),hash=wireHash(input.table,item.row)
     if(item.op_id!==sha(`${device.install_id}|${input.table}|${pk}|${hash}`))throw new Fault(422,'invalid_op_id')
     const old=await one(db,'SELECT * FROM v1_seed_ops WHERE op_id=$1',[item.op_id])
     if(old){if(old.hash!==hash)throw new Fault(409,'identity_changed');result.duplicates++;await db.query('RELEASE seed_row');continue}
     if(job.state!=='seeding')throw new Fault(409,'seed_frozen')
     const existing=await one(db,'SELECT payload FROM v1_rows WHERE table_name=$1 AND pk=$2',[input.table,pk])
     if(existing&&wireHash(input.table,existing.payload)!==hash)throw new Fault(409,'snapshot_changed')
     await db.query('INSERT INTO v1_rows(table_name,pk,payload) VALUES($1,$2,$3) ON CONFLICT(table_name,pk) DO NOTHING',[input.table,pk,item.row])
     await db.query('INSERT INTO v1_seed_ops VALUES($1,$2,$3,$4)',[item.op_id,input.table,pk,hash]);result.accepted++
     await db.query('RELEASE seed_row')
    }catch(error){
     await db.query('ROLLBACK TO seed_row; RELEASE seed_row')
     if(!(error instanceof Fault)&&error.code!=='23505')throw error
     result.rejected.push({op_id:item.op_id,pk:String(item.row?.[definition.pk]??''),code:error.code==='23505'?'unique_conflict':error.code,message:error.code==='23505'?'Unique value already exists':error.message})
    }
   }
   return result
  }))
 })
 app.post('/v1/seed/finalize',async c=>{
  const input=await c.req.json();checkExpected(input.expected)
  return c.json(await transaction(pool,async db=>{
   const job=await seedJob(db,c.get('device'),input.seed_id),diffs=[]
   if(canonical(input.expected)!==canonical(job.expected))throw new Fault(409,'report_changed')
   if(job.state==='seeded')return {ok:true,diffs:[]} // Durable verification receipt survives a lost final ACK and later live writes.
   for(const [table,expected] of Object.entries(job.expected)){
    const sums=Object.fromEntries(Object.keys(expected.money_sums_millimes).map(key=>[key,0n])),digest=createHash('sha256');let count=0,after=''
    while(true){
     const rows=(await db.query('SELECT pk,payload FROM v1_rows WHERE table_name=$1 AND NOT deleted AND pk COLLATE "C">$2 COLLATE "C" ORDER BY pk COLLATE "C" LIMIT 1000',[table,after])).rows
     for(const row of rows){count++;digest.update(wireHash(table,row.payload));for(const field of Object.keys(sums))sums[field]+=BigInt(row.payload[field]??0)}
     if(rows.length<1000)break
     after=rows.at(-1).pk
    }
    const actual={rows:count,digest:digest.digest('hex'),...Object.fromEntries(Object.entries(sums).map(([key,value])=>[key,value.toString()]))}
    for(const [field,value] of Object.entries({rows:expected.rows,digest:expected.digest,...expected.money_sums_millimes}))if(String(value)!==String(actual[field]))diffs.push({table,field,expected:value,actual:actual[field]})
   }
   if(!diffs.length)await db.query("UPDATE v1_seed SET state='seeded' WHERE singleton=1")
   return {ok:!diffs.length,diffs}
  }))
 })
}

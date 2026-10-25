import pg from 'pg'
import { createHash, randomBytes } from 'node:crypto'
import schema from './schema.json' with {type:'json'}
export { schema }
export const sha = value => createHash('sha256').update(value).digest('hex')
export const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key,item[key]])) : item)
export class Fault extends Error { constructor(status,code,message=code){super(message);this.status=status;this.code=code} }
export const poolFor = url => new pg.Pool({connectionString:url,max:8,connectionTimeoutMillis:5000,statement_timeout:30000})
export async function transaction(pool,work){
 const db=await pool.connect()
 try {await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(7311061)');const result=await work(db);await db.query('COMMIT');return result}
 catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
}
export const one = async (db,sql,args=[]) => (await db.query(sql,args)).rows[0]
export async function migrate(pool){
 await transaction(pool,async db=>{
  await db.query(`CREATE SEQUENCE IF NOT EXISTS v1_device_number_seq;
   CREATE TABLE IF NOT EXISTS v1_devices(id uuid PRIMARY KEY,number_code text UNIQUE NOT NULL DEFAULT ('PC'||nextval('v1_device_number_seq')::text),install_id text UNIQUE NOT NULL,name text NOT NULL,platform text NOT NULL,app_version text NOT NULL,role text NOT NULL CHECK(role IN ('seed','replica')),revoked boolean NOT NULL DEFAULT false,last_seen_at timestamptz DEFAULT now());
   CREATE TABLE IF NOT EXISTS v1_enrollment(hash text PRIMARY KEY,role text NOT NULL CHECK(role IN ('seed','replica')),expires_at timestamptz NOT NULL,used_by text);
   CREATE TABLE IF NOT EXISTS v1_sessions(access_hash text PRIMARY KEY,refresh_hash text UNIQUE NOT NULL,device_id uuid NOT NULL REFERENCES v1_devices(id),access_until timestamptz NOT NULL,refresh_until timestamptz NOT NULL);
   CREATE TABLE IF NOT EXISTS v1_seed(singleton integer PRIMARY KEY CHECK(singleton=1),id uuid NOT NULL,device_id uuid NOT NULL REFERENCES v1_devices(id),install_id text NOT NULL,digest text NOT NULL,expected jsonb NOT NULL,state text NOT NULL CHECK(state IN ('seeding','seeded')));
   CREATE TABLE IF NOT EXISTS v1_seed_ops(op_id text PRIMARY KEY,table_name text NOT NULL,pk text NOT NULL,hash text NOT NULL);
   CREATE TABLE IF NOT EXISTS v1_rows(table_name text NOT NULL,pk text NOT NULL,payload jsonb NOT NULL,deleted boolean NOT NULL DEFAULT false,deleted_by uuid,deleted_seq bigint,PRIMARY KEY(table_name,pk));
   CREATE TABLE IF NOT EXISTS v1_aliases(table_name text NOT NULL,alias text NOT NULL,canonical text NOT NULL,PRIMARY KEY(table_name,alias));
   CREATE TABLE IF NOT EXISTS v1_changes(seq bigserial PRIMARY KEY,origin_device uuid NOT NULL,change jsonb NOT NULL);
   CREATE TABLE IF NOT EXISTS v1_receipts(device_id uuid NOT NULL,seq bigint NOT NULL,hash text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(device_id,seq));
   CREATE TABLE IF NOT EXISTS v1_bootstrap(device_id uuid PRIMARY KEY,anchor bigint NOT NULL,expires_at timestamptz NOT NULL);
   CREATE TABLE IF NOT EXISTS v1_bootstrap_rows(device_id uuid NOT NULL REFERENCES v1_bootstrap(device_id) ON DELETE CASCADE,table_name text NOT NULL,pk text NOT NULL,payload jsonb NOT NULL,PRIMARY KEY(device_id,table_name,pk));`)
  for(const [table,definition] of Object.entries(schema.tables))for(const [index,columns] of definition.unique.entries()){
   if(columns.some(column=>!column||!/^[a-z_][a-z0-9_]*$/.test(column)))throw new Error('Unsupported audited unique index')
   const expressions=columns.map(column=>`(payload->>'${column}')`).join(',')
   await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS v1_unique_${table}_${index} ON v1_rows(${expressions}) WHERE table_name='${table}' AND NOT deleted`)
  }
 })
}
export async function issueSession(db,deviceId){
 const access=randomBytes(40).toString('base64url'),refresh=randomBytes(48).toString('base64url'),expires=new Date(Date.now()+15*60_000)
 await db.query("INSERT INTO v1_sessions VALUES($1,$2,$3,$4,now()+interval '30 days')",[sha(access),sha(refresh),deviceId,expires])
 return {access_token:access,refresh_token:refresh,expires_at:expires.toISOString()}
}
export function positive(value,zero=false){if(!Number.isSafeInteger(value)||value<(zero?0:1))throw new Fault(422,'invalid_sequence');return value}
export function text(value,max=128){if(typeof value!=='string'||!value.length||value.length>max)throw new Fault(422,'invalid_text');return value}
export function privateSetting(key){return schema.localSettings.includes(key)||schema.secretFragments.some(part=>key.toLowerCase().includes(part))}
export function validateRow(table,row,{live=false}={}){
 const definition=schema.tables[table]
 if(!Object.hasOwn(schema.tables,table)||!row||typeof row!=='object'||Array.isArray(row))throw new Fault(422,'invalid_row')
 const pk=text(row[definition.pk])
 if(table==='app_settings'&&privateSetting(pk))throw new Fault(422,'private_setting')
 for(const [key,value] of Object.entries(row)){
  const column=definition.columns.find(column=>column.name===key)
  if(!column||live&&definition.counters.includes(key))throw new Fault(422,'invalid_column')
  if(value===null)continue
  if(column.type.toUpperCase().includes('TEXT')&&typeof value!=='string')throw new Fault(422,'text_required')
  if(['money','integer'].includes(column.kind)&&!Number.isSafeInteger(value))throw new Fault(422,'integer_units_required')
  if(column.kind==='rate'&&(typeof value!=='number'||!Number.isFinite(value)))throw new Fault(422,'invalid_rate')
  if(column.kind==='real_unclassified')throw new Fault(422,'unclassified_column')
  if(!['string','number'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value)||typeof value==='string'&&value.length>500_000)throw new Fault(422,'invalid_value')
 }
 for(const required of definition.required)if((!live||!definition.counters.includes(required))&&row[required]==null)throw new Fault(422,'required_column',`${table}.${required}`)
 return pk
}

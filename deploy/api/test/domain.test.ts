import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canonical,digest,newId,uuid7,requireVersion,validateOperation,uploadSchema } from '../src/domain.ts'

test('UUIDv7 identifiers and canonical request hashes are stable',()=>{
 assert.equal(uuid7.safeParse(newId()).success,true)
 assert.equal(digest(canonical({b:2,a:{z:0,c:1}})),digest(canonical({a:{c:1,z:0},b:2})))
})
test('version comparison handles numeric components and fails closed',()=>{
 assert.doesNotThrow(()=>requireVersion('1.10.0','1.9.1038'))
 assert.throws(()=>requireVersion('1.9.9','1.9.1038'))
 assert.throws(()=>requireVersion('','1.10.0'))
})
test('whitelists reject identifiers, actor spoofing, fractional money and history edits',()=>{
 const id=newId()
 assert.throws(()=>validateOperation({op:'PUT',id,table:'produits;DROP TABLE app_users',data:{}},'admin'))
 assert.throws(()=>validateOperation({op:'PATCH',id,table:'produits',data:{updated_by:newId()}},'admin'))
 assert.throws(()=>validateOperation({op:'PATCH',id,table:'produits',data:{prix_vente:1.5}},'admin'))
 assert.throws(()=>validateOperation({op:'PATCH',id,table:'ventes',data:{total_ttc:500}},'admin'))
 assert.throws(()=>validateOperation({op:'DELETE',id,table:'stock_movements'},'admin'))
 assert.throws(()=>validateOperation({op:'PUT',id,table:'categories',data:{nom:'Test'}},'cashier'))
 assert.throws(()=>validateOperation({op:'PUT',id,table:'app_settings',data:{key:'r2_secret_access_key',value:'test'}},'admin'))
 assert.doesNotThrow(()=>validateOperation({op:'PUT',id,table:'categories',data:{nom:'Test'}},'admin'))
})
test('upload boundary rejects empty, unbounded and unknown request fields',()=>{
 assert.equal(uploadSchema.safeParse({transactionId:newId(),ops:[]}).success,false)
 assert.equal(uploadSchema.safeParse({transactionId:newId(),ops:[{op:'PUT',table:'categories',id:newId(),data:{nom:'Test'}}],userId:newId()}).success,false)
})


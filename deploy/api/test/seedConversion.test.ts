import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSeedBundle,toMillimes,sourceTimestamp } from '../src/seedConversion.ts'
import type { LegacySnapshot } from '../src/seedConversion.ts'
import { digest,uuid7 } from '../src/domain.ts'
import { seedManifestSchema } from '../src/seed.ts'
import legacy from '../schema/legacy-contract.json' with {type:'json'}

const empty=():LegacySnapshot=>Object.fromEntries(legacy.tables.map(table=>[table.name,[]]))
const options={sourceSha256:digest('verified synthetic source copy'),cutoverAt:'2026-10-24T15:00:00.000Z'}
const find=(result:ReturnType<typeof buildSeedBundle>,table:string)=>result.chunks.flat().filter(row=>row.table===table)

test('money conversion rounds each decimal exactly, handles exponents and rejects unsafe amounts',()=>{
 for(const [value,expected] of [[12.345,12345],['1.2345',1235],['-1.2345',-1235],['1e-3',1],['1e-4',0],['9.9995',10000],[-0.0005,-1],['0',0]] as const)assert.equal(toMillimes(value),expected)
 for(const value of [NaN,Infinity,null,'','oops','1e999',9_007_199_254_741])assert.throws(()=>toMillimes(value))
})
test('source timestamps use the explicit Tunis timezone and reject impossible calendar values',()=>{
 assert.equal(sourceTimestamp('2026-10-24 15:12:34','Africa/Tunis'),'2026-10-24T14:12:34.000Z')
 assert.equal(sourceTimestamp('2026-10-24T15:12:34+01:00'),'2026-10-24T14:12:34.000Z')
 assert.equal(sourceTimestamp('2026-10-24 15:12:34.7','Africa/Tunis'),'2026-10-24T14:12:34.700Z')
 assert.equal(sourceTimestamp('2026-10-24 15:12:34','UTC'),'2026-10-24T15:12:34.000Z')
 assert.throws(()=>sourceTimestamp('2026-10-24 15:12:34'),/NAIVE_TIMESTAMP_POLICY_REQUIRED/)
 assert.equal(sourceTimestamp(null),null)
 for(const value of ['2026-02-30 12:00:00','2026-02-30T12:00:00Z','2026-10-24 24:12:00','yesterday'])assert.throws(()=>sourceTimestamp(value))
})
test('all 43 source tables are accounted for; IDs, chunk hashes and totals survive retries and source order changes',()=>{
 const snapshot=empty()
 snapshot.categories=[{id:'old-cat',nom:'Category'}]
 snapshot.produits=[{id:'old-product-b',nom:'Product B',reference:'B',categorie_id:'old-cat',prix_vente:12.345,stock_actuel:2},{id:'old-product-a',nom:'Product A',reference:'A',prix_vente:1.001,stock_actuel:0}]
 snapshot.clients=[{id:'old-client',nom:'Client',solde_credit:12.345,solde_fidelite:0.5}]
 snapshot.credits_clients=[{id:'old-credit',client_id:'old-client',client_nom:'Client',type:'CREDIT',montant:12.345}]
 snapshot.sync_queue=[{id:'local-only',payload:'not uploaded'}]
 snapshot.app_settings=[{key:'company_name',value:'Synthetic shop'},{key:'r2_secret_access_key',value:'synthetic-secret-omitted'}]
 const before=JSON.stringify(snapshot)
 const first=buildSeedBundle(snapshot,options)
 assert.equal(JSON.stringify(snapshot),before)
 assert.equal(first.report.canStage,true,JSON.stringify(first.report.issues))
 assert.equal(Object.keys(first.report.sourceCounts).length,43)
 assert.equal(first.report.excludedCounts.sync_queue,1);assert.equal(first.report.excludedCounts.app_settings,1)
 assert.equal(JSON.stringify(first).includes('synthetic-secret-omitted'),false)
 assert.ok(first.idMap.every(entry=>uuid7.safeParse(entry.id).success))
 const category=find(first,'categories')[0];const products=find(first,'produits')
 assert.equal(products.find(row=>row.data.reference==='B')?.data.categorie_id,category.id)
 assert.equal(first.manifest.expectedMoneyTotals['produits.prix_vente'],'13346')
 assert.equal(find(first,'stock_movements').length,1);assert.equal(find(first,'stock_movements')[0].data.qty_delta,2)
 assert.equal(find(first,'account_movements').length,2)
 // Historical credits remain history; opening balances are not added twice.
 assert.equal(first.manifest.expectedMoneyTotals['account_movements.amount_millimes'],'12845')
 assert.equal(first.manifest.expectedMoneyTotals['credits_clients.montant'],'12345')
 assert.equal(first.report.activationEnabled,false)
 assert.doesNotThrow(()=>seedManifestSchema.parse(first.manifest))
 const second=buildSeedBundle({...snapshot,produits:[...snapshot.produits].reverse()},options)
 assert.deepEqual(second.manifest,first.manifest);assert.deepEqual(second.idMap,first.idMap)
 assert.deepEqual(second.chunks,first.chunks)
})
test('missing relationships, unaudited columns and unmapped links block staging without repairs',()=>{
 const snapshot=empty()
 snapshot.produits=[{id:'missing-ref',reference:'BAD',nom:'Bad',categorie_id:'does-not-exist',new_unaudited_column:1}]
 snapshot.avances_clients=[{id:'deposit',numero:'DEP',client_nom:'Synthetic client',montant:1,dossier_id:'missing-root'}]
 const result=buildSeedBundle(snapshot,options)
 assert.equal(result.report.canStage,false)
 assert.ok(result.report.issues.some(issue=>issue.code==='UNKNOWN_SOURCE_COLUMN'))
 assert.ok(result.report.issues.some(issue=>issue.code==='SOURCE_REFERENCE_MISSING'))
 assert.equal(find(result,'produits').length,0)
 const missing=empty();delete missing.ventes
 assert.ok(buildSeedBundle(missing,options).report.issues.some(issue=>issue.code==='SOURCE_TABLE_MISSING'))
})
test('historical JSON is preserved and explicitly marked for adapter review',()=>{
 const snapshot=empty();const json=' {"kind":"legacy","vente_ids":["old-sale"]} '
 snapshot.documents=[{id:'old-doc',numero:'DOC',type_document:'FACTURE',client_nom:'Client',contenu_json:json,total_ttc:1}]
 const result=buildSeedBundle(snapshot,options)
 assert.equal(find(result,'documents')[0]?.data.contenu_json,json)
 assert.ok(result.report.issues.some(issue=>issue.level==='review' && issue.code==='HISTORICAL_JSON_PRESERVED'))
 assert.equal(result.report.activationEnabled,false)
})
test('large batches split deterministically below the API row and body limits',()=>{
 const snapshot=empty()
 snapshot.categories=Array.from({length:501},(_,i)=>({id:`category-${i}`,nom:`Category ${i}`}))
 const result=buildSeedBundle(snapshot,options)
 assert.equal(result.report.canStage,true)
 assert.deepEqual(result.chunks.map(chunk=>chunk.length),[500,1])
 assert.ok(result.chunks.every(chunk=>Buffer.byteLength(JSON.stringify(chunk))<1_500_000))
})


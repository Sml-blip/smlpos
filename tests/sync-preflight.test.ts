import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { inspectSeedCopy } from '../src/main/seedPreflight.ts'

test('seed preflight is read-only, preserves counts and uses exact integer totals',()=>{
 const sqlite=new DatabaseSync(':memory:')
 const schema=JSON.parse(readFileSync(new URL('../docs/data-audit/source-inventory.json',import.meta.url),'utf8'))
 for(const table of schema.tables)sqlite.exec(table.ddl)
 sqlite.exec(`INSERT INTO ventes(id,numero,total_ttc) VALUES('sale-fixture','FIXTURE',12.345);
 INSERT INTO clients(id,nom,solde_credit) VALUES('customer-fixture','Synthetic customer',10);
 INSERT INTO produits(id,reference,nom) VALUES('product-fixture','FIXTURE','Synthetic product');
 INSERT INTO serial_numbers(id,produit_id,numero_serie) VALUES('sn-a','product-fixture','SAME'),('sn-b','product-fixture','SAME');
 PRAGMA query_only=ON;`)
 const adapter={
  pragma(sql:string){return sqlite.prepare(`PRAGMA ${sql}`).all()},
  prepare(sql:string){
   const statement=sqlite.prepare(sql)
   return {get:()=>statement.get(),all:()=>statement.all(),safeIntegers(value:boolean){statement.setReadBigInts(value);return this}}
  },
 }
 const result=inspectSeedCopy(adapter as unknown as Parameters<typeof inspectSeedCopy>[0])
 assert.equal(result.tableCount,43)
 assert.equal(result.rowCounts.ventes,1)
 assert.equal(result.moneyTotalsMillimes['ventes.total_ttc'],'12345')
 assert.equal(result.integrityOk,true)
 assert.equal(result.importEnabled,false)
 assert.equal(result.stage,'preflight_only')
 assert.ok(result.warnings.some(w=>w.includes('doublon')))
 assert.ok(result.warnings.some(w=>w.includes('solde')))
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM ventes').get()?.n,1)
 assert.throws(()=>sqlite.exec('DELETE FROM ventes'))
 sqlite.close()
})


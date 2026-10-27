import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorkload } from './workload.mjs'

test('workload generation is reproducible and covers requested operation types', () => {
  const a=generateWorkload(42)
  assert.deepEqual(a,generateWorkload(42))
  assert.notDeepEqual(a,generateWorkload(43))
  assert.equal(a.length,200)
  assert.equal(a.filter(x=>x.device==='A').length,100)
  assert.equal(a.filter(x=>x.device==='B').length,100)
  assert.deepEqual([...new Set(a.map(x=>x.kind))].sort(),['delete','price','return','sale','stock'])
  for(const key of ['offline','restart','duplicate','reorder']) assert.ok(a.some(x=>x[key]))
  assert.throws(()=>generateWorkload(0))
})

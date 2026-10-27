/** Synthetic authentication gates against the one approved staging tunnel. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { newId } from '../../deploy/api/src/domain.ts'

const base='http://127.0.0.1:23001'
const data=JSON.parse(readFileSync(0,'utf8'))
if(data.username!=='desktop-proof'||typeof data.password!=='string'||data.password.length<12)throw new Error('Invalid synthetic admin input')
const deviceId=newId(),body={username:data.username,password:data.password,deviceId,deviceName:'Synthetic gate test',platform:'development'}
const headers={'content-type':'application/json','X-Client-Version':'1.9.1039'}
const login=version=>fetch(base+'/auth/login',{method:'POST',headers:{...headers,'X-Client-Version':version},body:JSON.stringify(body)})
let passed=0
assert.equal((await login('0.0.1')).status,426);console.log('PASS: old client rejected with HTTP 426');passed++
const response=await login('1.9.1039');assert.equal(response.status,200)
const {accessToken}=await response.json();assert.ok(accessToken)
const authenticated={...headers,authorization:`Bearer ${accessToken}`}
assert.equal((await fetch(base+'/devices',{headers:authenticated})).status,200);console.log('PASS: synthetic device authenticates');passed++
assert.equal((await fetch(base+`/devices/${deviceId}/revoke`,{method:'POST',headers:authenticated,body:'{}'})).status,200)
assert.equal((await fetch(base+'/devices',{headers:authenticated})).status,403);console.log('PASS: revoked device rejected with HTTP 403');passed++
console.log(`RESULT HTTP gates passed=${passed} failed=0`)

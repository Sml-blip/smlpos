import { app, ipcMain, safeStorage } from 'electron'
import Database from 'better-sqlite3'
import { randomBytes,createHash } from 'node:crypto'
import { existsSync,readFileSync,writeFileSync,mkdirSync } from 'node:fs'
import { cp } from 'node:fs/promises'
import { join } from 'node:path'
import { hostname } from 'node:os'
import { db,dbFilePath } from './db'
import { getArchiveDir } from './dataPaths'
import { inspectSeedCopy } from './seedPreflight'
import { buildSeedBundle } from '../../deploy/api/src/seedConversion'
import type { LegacySnapshot } from '../../deploy/api/src/seedConversion'
import { TEST_BUILD } from './buildFlags'

export const HETZNER_API=TEST_BUILD?'http://127.0.0.1:23001':'https://api.pos.sml.boutique'
const API=HETZNER_API
type Session={accessToken:string;refreshToken:string;expiresAt:number;role:string}
let refreshInFlight:Promise<Session>|null=null
let preflightRunning=false
function newDeviceId(){const b=randomBytes(16);b.writeUIntBE(Date.now(),0,6);b[6]=(b[6]&15)|112;b[8]=(b[8]&63)|128;const h=b.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`}
function device(){
 const path=join(app.getPath('userData'),'hetzner-device.json')
 if(existsSync(path)){const value=JSON.parse(readFileSync(path,'utf8'));if(typeof value.id==='string'&&/^[0-9a-f-]{36}$/.test(value.id))return value as {id:string;name:string}}
 const value={id:newDeviceId(),name:hostname().slice(0,80)};writeFileSync(path,JSON.stringify(value),{mode:0o600});return value
}
function sessionPath(){return join(app.getPath('userData'),'hetzner-session.bin')}
function readSession():Session|null{
 if(!existsSync(sessionPath()))return null
 if(!safeStorage.isEncryptionAvailable())throw new Error('Le stockage sécurisé Windows est indisponible')
 try{return JSON.parse(safeStorage.decryptString(readFileSync(sessionPath())))}catch{throw new Error('Session sécurisée illisible : reconnectez cet appareil')}
}
function saveSession(value:Session){
 if(!safeStorage.isEncryptionAvailable())throw new Error('Le stockage sécurisé Windows est indisponible')
 writeFileSync(sessionPath(),safeStorage.encryptString(JSON.stringify(value)),{mode:0o600})
}
async function request(path:string,body?:unknown,token?:string){
 const response=await fetch(`${API}${path}`,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Client-Version':app.getVersion(),...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12_000),redirect:'error'})
 const result=await response.json() as Record<string,any>
 if(!response.ok)throw new Error(String(result.message??result.code??`Service indisponible (${response.status})`))
 return result
}
function sessionFromResponse(data:Record<string,any>):Session{
 if(typeof data.accessToken!=='string'||typeof data.refreshToken!=='string'||typeof data.expiresIn!=='number')throw new Error('Réponse de connexion invalide')
 return {accessToken:data.accessToken,refreshToken:data.refreshToken,expiresAt:Date.now()+data.expiresIn*1000,role:String(data.role)}
}
async function currentSession(){
 const session=readSession();if(!session)return null
 if(session.expiresAt>Date.now()+60_000)return session
 if(!refreshInFlight)refreshInFlight=request('/auth/refresh',{refreshToken:session.refreshToken}).then(data=>{const next=sessionFromResponse(data);saveSession(next);return next}).finally(()=>{refreshInFlight=null})
 return refreshInFlight
}
export function registerHetznerSyncIpc(){
 ipcMain.handle('hetzner:login',async(_e,input:unknown)=>{
  if(!input||typeof input!=='object')throw new Error('Identifiants requis')
  const {username,password}=input as {username?:unknown;password?:unknown}
  if(typeof username!=='string'||typeof password!=='string'||username.length>80||password.length>256)throw new Error('Identifiants invalides')
  const local=device()
  const data=await request('/auth/login',{username,password,deviceId:local.id,deviceName:local.name,platform:app.isPackaged?'windows':'development'})
  const session=sessionFromResponse(data);saveSession(session)
  return {ok:true,role:session.role}
 })
 ipcMain.handle('hetzner:overview',async()=>{
  const local=device()
  let localQueue=0
  try{localQueue=Number((db.prepare('SELECT COUNT(*) n FROM sync_queue WHERE synced_at IS NULL').get() as {n:number}).n)}catch{/* Older DB has no legacy queue. */}
  const base={deviceId:local.id,deviceName:local.name,endpoint:API,localQueue,importEnabled:false,devices:[] as unknown[],rejections:[] as unknown[],authenticated:false,serverReachable:false,stage:'preparation'}
  try{
   const health=await request('/health');base.serverReachable=health.ok===true
   const session=await currentSession();if(!session)return {...base,message:'Connectez cet appareil pour afficher les autres postes.'}
   await request('/devices/heartbeat',{},session.accessToken)
   const [devices,status]=await Promise.all([request('/devices',undefined,session.accessToken),request('/sync/status',undefined,session.accessToken)])
   return {...base,authenticated:true,role:session.role,devices:devices.devices,rejections:status.rejections,message:'Serveur joignable. Import et synchronisation métier en préparation.'}
  }catch(error){return {...base,message:error instanceof Error?error.message:'Serveur indisponible'}}
 })
 ipcMain.handle('hetzner:preflight',async()=>{
  if(preflightRunning)throw new Error('Une préparation est déjà en cours')
  const active=db.prepare('SELECT id FROM shifts WHERE ended_at IS NULL LIMIT 1').get()
  if(active)throw new Error('Fermez la caisse avant de préparer le PC source')
  preflightRunning=true
  try{
   // Row counts alone miss updates to existing records. Track both this
   // connection's writes and commits made by other SQLite connections.
   const changesBefore=(db.prepare('SELECT total_changes() n').get() as {n:number}).n
   const versionBefore=db.pragma('data_version',{simple:true})
   const directory=join(getArchiveDir(),'sync-preflight',new Date().toISOString().replace(/[:.]/g,'-'))
   mkdirSync(directory,{recursive:true})
   // Copy the whole app-data folder outside userData before inspecting a backup.
   await cp(app.getPath('userData'),join(directory,'app-data'),{recursive:true,errorOnExist:true,force:false})
   const backupPath=join(directory,'smlpos-verified-copy.db')
   await db.backup(backupPath)
   const copy=new Database(backupPath,{readonly:true,fileMustExist:true})
   try{
    copy.pragma('query_only=ON')
    const report=inspectSeedCopy(copy)
    const changesAfter=(db.prepare('SELECT total_changes() n').get() as {n:number}).n
    const versionAfter=db.pragma('data_version',{simple:true})
    if(changesBefore!==changesAfter || versionBefore!==versionAfter)throw new Error('Les données ont changé pendant la préparation. Recommencez hors activité. Aucun import effectué.')
    const sourceCounts=db.transaction(()=>Object.fromEntries(Object.keys(report.rowCounts).map(table=>[table,Number((db.prepare(`SELECT COUNT(*) n FROM "${table}"`).get() as {n:number}).n)])))()
    if(JSON.stringify(sourceCounts)!==JSON.stringify(report.rowCounts))throw new Error('Les données ont changé pendant la copie. Recommencez la préparation hors activité.')
    if(!report.integrityOk)throw new Error('La copie SQLite n’a pas passé la vérification d’intégrité. Aucun import effectué.')
    const sha256=createHash('sha256').update(readFileSync(backupPath)).digest('hex')
    // Keep conversion artifacts next to this immutable source copy. No source
    // writes, automatic repair or network calls occur during conversion.
    const rowCount=Object.values(report.rowCounts).reduce((sum,n)=>sum+n,0)
    let conversion:{canStage:boolean;planPath:string;convertedRows:number;openingStockRows:number;openingAccountRows:number;blockingIssues:number;reviewIssues:number;issueCodes:string[]}
    if(rowCount>250_000){
     conversion={canStage:false,planPath:'',convertedRows:0,openingStockRows:0,openingAccountRows:0,blockingIssues:1,reviewIssues:0,issueCodes:['STREAMING_CONVERSION_REQUIRED']}
    }else{
     const snapshot:LegacySnapshot={}
     for(const table of Object.keys(report.rowCounts))snapshot[table]=copy.prepare(`SELECT * FROM "${table}"`).all() as Array<Record<string,unknown>>
     const bundle=buildSeedBundle(snapshot,{sourceSha256:sha256,cutoverAt:report.createdAt})
     for(const [key,total] of Object.entries(report.moneyTotalsMillimes)){
      if(bundle.manifest.expectedMoneyTotals[key]!==total){
       const [table,column]=key.split('.')
       bundle.report.issues.push({level:'error',code:'AMOUNT_RECONCILIATION_FAILED',table,column})
       bundle.report.canStage=false
      }
     }
     bundle.report.issueCount=bundle.report.issues.length
     const planPath=join(directory,'seed-plan.json')
     writeFileSync(planPath,JSON.stringify(bundle),{mode:0o600})
     conversion={canStage:bundle.report.canStage,planPath,convertedRows:Object.values(bundle.report.convertedCounts).reduce((sum,n)=>sum+n,0),openingStockRows:bundle.report.convertedCounts.stock_movements,openingAccountRows:bundle.report.convertedCounts.account_movements,blockingIssues:bundle.report.issues.filter(issue=>issue.level==='error').length,reviewIssues:bundle.report.issues.filter(issue=>issue.level==='review').length,issueCodes:[...new Set(bundle.report.issues.map(issue=>issue.code))].slice(0,20)}
    }
    const result={...report,backupPath,sourcePath:dbFilePath,sha256,countsMatch:true,conversion}
    writeFileSync(join(directory,'preflight-report.json'),JSON.stringify(result,null,2),{mode:0o600})
    return result
   }finally{copy.close()}
  }finally{preflightRunning=false}
 })
}


import type Database from 'better-sqlite3'
import { captureState } from './gate'
export const CORRECTION_MESSAGE='Synchronisation multi-postes : corrigez un enregistrement validé par un avoir ou une contrepassation, puis créez le nouvel enregistrement.'
export function requireReversal(db:Database.Database){
  if(captureState(db,'sync_backend')==='vps')throw new Error(CORRECTION_MESSAGE)
}
export function guardInvoiceEdit(db:Database.Database,id:string,patch?:Record<string,unknown>){
  if(captureState(db,'sync_backend')!=='vps')return
  const row=db.prepare('SELECT * FROM documents WHERE id=?').get(id) as Record<string,unknown>|undefined
  if(!row||!['FACTURE_VENTE','FACTURE_JOURNALIERE_F','FACTURE_ACHAT','AVOIR'].includes(String(row.type_document)))return
  const fields=['total_ht','total_tva','total_ttc','timbre','total_remise','ht_7','tva_7','ht_19','tva_19']
  if(!patch||fields.some(field=>Object.hasOwn(patch,field)&&Number(patch[field]??0)!==Number(row[field]??0)))throw new Error(CORRECTION_MESSAGE)
}

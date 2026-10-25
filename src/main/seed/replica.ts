import type Database from 'better-sqlite3'
import { syncedTableNames } from './tables'
import { isSeedableSetting } from './dryRun'
import { captureState,setCaptureState } from './gate'
const quote=(value:string)=>`"${value.replaceAll('"','""')}"`
const initialTables=new Set(['produits','categories','operateurs','services_pos','app_settings'])

/** Called only after verified backup, replica-role check and explicit JOIN.
 * Refuses business history. The backup retains the initial catalogue/settings. */
export function prepareEmptyReplica(db:Database.Database){
 const names=syncedTableNames((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name:string}[]).map(row=>row.name))
 if(captureState(db,'replica_join_pending')==='1')return
 if(captureState(db,'bootstrap_complete')==='1'||captureState(db,'verified_digest'))throw new Error('This PC already owns synchronized data')
 for(const table of names)if(!initialTables.has(table)&&db.prepare(`SELECT 1 FROM ${quote(table)} LIMIT 1`).get())throw new Error(`This PC contains business history (${table}); joining will not erase it`)
 if(db.prepare('SELECT 1 FROM outbox WHERE sent_at IS NULL LIMIT 1').get()||db.prepare('SELECT 1 FROM pull_rejects LIMIT 1').get())throw new Error('Review pending local changes before joining')
 db.transaction(()=>{
  setCaptureState(db,'apply_mute','1')
  for(const table of [...names].reverse())if(table!=='app_settings')db.prepare(`DELETE FROM ${quote(table)}`).run()
  for(const {key} of db.prepare('SELECT key FROM app_settings').all() as {key:string}[])if(isSeedableSetting(key))db.prepare('DELETE FROM app_settings WHERE key=?').run(key)
  setCaptureState(db,'sync_backend','vps');setCaptureState(db,'replica_join_pending','1')
  for(const table of names)if(table!=='app_settings')for(const op of ['INSERT','UPDATE','DELETE'])db.exec(`CREATE TRIGGER IF NOT EXISTS ${quote(`join_lock_${table}_${op}`)} BEFORE ${op} ON ${quote(table)} WHEN (SELECT v FROM sync_state WHERE k='replica_join_pending')='1' AND (SELECT v FROM sync_state WHERE k='apply_mute')='0' BEGIN SELECT RAISE(ABORT,'Finish joining this PC before making business changes'); END;`)
  setCaptureState(db,'apply_mute','0')
 })()
}

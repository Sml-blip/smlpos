import type Database from 'better-sqlite3'
import { captureState, canDrainOutbox, setCaptureState } from './gate'

export interface LiveIssue { source: 'push' | 'pull'; seq: number; table: string; pk: string; reason: string; at: string }
export function liveStatus(db: Database.Database) {
  const ready = captureState(db, 'apply_mute') !== null
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n
  const cursor = Number(captureState(db, 'pull_cursor') ?? 0)
  const head = captureState(db, 'server_seq')
  return {
    prepared: ready, enabled: canDrainOutbox(db),
    joining: captureState(db, 'replica_join_pending') === '1',
    backend: captureState(db, 'sync_backend') === 'vps' ? 'vps' as const : 'legacy' as const,
    pending: ready ? count("SELECT count(*) n FROM outbox WHERE sent_at IS NULL AND (last_error IS NULL OR last_error NOT LIKE 'rejected:%')") : 0,
    rejected: ready ? count("SELECT count(*) n FROM outbox WHERE sent_at IS NULL AND last_error LIKE 'rejected:%'") : 0,
    pullRejected: ready ? count('SELECT count(*) n FROM pull_rejects') : 0,
    cursor, serverSeq: head === null ? null : Number(head),
    lag: head === null ? null : Math.max(0, Number(head) - cursor),
    lastPush: captureState(db, 'last_push_at'), lastPull: captureState(db, 'last_pull_at'),
    pushError: captureState(db, 'live_last_error'), pullError: captureState(db, 'pull_last_error'),
    retryAt: Number(captureState(db, 'live_retry_after') ?? 0),
  }
}
export function liveIssues(db: Database.Database): LiveIssue[] {
  if (captureState(db, 'apply_mute') === null) return []
  const push = db.prepare("SELECT 'push' source,seq,table_name AS 'table',pk,last_error reason,at FROM outbox WHERE sent_at IS NULL AND last_error LIKE 'rejected:%' ORDER BY seq LIMIT 100").all() as LiveIssue[]
  const pull = db.prepare("SELECT 'pull' source,server_seq seq,table_name AS 'table',pk,reason,at FROM pull_rejects ORDER BY server_seq LIMIT 100").all() as LiveIssue[]
  return [...push, ...pull]
}
/** Manual retry retains identities and payloads; it never marks anything sent. */
export function retryPush(db: Database.Database): void {
  if (captureState(db, 'apply_mute') === null) throw new Error('Prepare a verified backup first')
  db.transaction(() => {
    db.prepare('UPDATE outbox SET last_error=NULL WHERE sent_at IS NULL').run()
    setCaptureState(db, 'live_retry_after', '0')
    setCaptureState(db, 'live_failures', '0')
  })()
}

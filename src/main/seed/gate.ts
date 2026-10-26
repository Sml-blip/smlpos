import type Database from 'better-sqlite3'

export function captureState(db: Database.Database, key: string): string | null {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sync_state'").get()) return null
  return (db.prepare('SELECT v FROM sync_state WHERE k=?').get(key) as { v: string } | undefined)?.v ?? null
}
export function setCaptureState(db: Database.Database, key: string, value: string): void {
  db.prepare('INSERT INTO sync_state(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(key, value)
}
export function closeSeedGate(db: Database.Database): void {
  if (captureState(db, 'apply_mute') === null) return
  db.transaction(() => {
    setCaptureState(db, 'outbox_drain_enabled', '0')
    setCaptureState(db, 'seed_finalized_at', '')
    setCaptureState(db, 'verified_digest', '')
  })()
}
export function canDrainOutbox(db: Database.Database): boolean {
  return captureState(db, 'outbox_drain_enabled') === '1' && !!captureState(db, 'seed_finalized_at')
    && ((!!captureState(db, 'verified_digest') && !!captureState(db, 'snapshot_hash'))
      || (captureState(db, 'bootstrap_complete') === '1' && captureState(db, 'bootstrap_as_of') !== null))
}
export function openVerifiedGate(db: Database.Database, digest: string, snapshotHash: string): void {
  if (captureState(db, 'snapshot_hash') !== snapshotHash) throw new Error('Snapshot does not match the verified seed')
  const fence = Number(captureState(db, 'snapshot_fence'))
  if (!Number.isSafeInteger(fence) || fence < 0) throw new Error('Invalid snapshot boundary')
  db.transaction(() => {
    const at = new Date().toISOString()
    // The verified snapshot acknowledges the covered prefix, including counter
    // changes already present in its opening balances. Retain every audit row.
    db.prepare('UPDATE outbox SET sent_at=? WHERE seq<=? AND sent_at IS NULL').run(at, fence)
    setCaptureState(db, 'verified_digest', digest)
    setCaptureState(db, 'seed_finalized_at', at)
    setCaptureState(db, 'outbox_drain_enabled', '1')
  })()
}
export function pendingLiveRows(db: Database.Database, limit = 200): Record<string, unknown>[] {
  if (!canDrainOutbox(db)) return []
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Invalid outbox page size')
  return db.prepare("SELECT * FROM outbox WHERE sent_at IS NULL AND (last_error IS NULL OR last_error NOT LIKE 'rejected:%') ORDER BY seq LIMIT ?").all(limit) as Record<string, unknown>[]
}

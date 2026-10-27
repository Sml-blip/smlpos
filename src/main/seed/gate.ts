import type Database from 'better-sqlite3'
import { randomBytes } from 'node:crypto'

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function newDeviceUuidV7(): string {
  const bytes = randomBytes(16)
  bytes.writeUIntBE(Date.now(), 0, 6)
  bytes[6] = (bytes[6] & 15) | 112
  bytes[8] = (bytes[8] & 63) | 128
  const value = bytes.toString('hex')
  return `${value.slice(0,8)}-${value.slice(8,12)}-${value.slice(12,16)}-${value.slice(16,20)}-${value.slice(20)}`
}

export function captureState(db: Database.Database, key: string): string | null {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sync_state'").get()) return null
  return (db.prepare('SELECT v FROM sync_state WHERE k=?').get(key) as { v: string } | undefined)?.v ?? null
}
export function setCaptureState(db: Database.Database, key: string, value: string): void {
  db.prepare('INSERT INTO sync_state(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(key, value)
}
/** Stable server device identity. Never silently replace a previously assigned non-v7 identity. */
export function ensureDeviceId(db: Database.Database, preferredId?: string | null): string {
  db.exec('CREATE TABLE IF NOT EXISTS sync_state(k TEXT PRIMARY KEY,v TEXT)')
  const current = captureState(db, 'device_id')
  if (current && UUID_V7.test(current)) return current
  if (current) throw new Error('Stored device ID is not a UUIDv7; refusing to change this device identity')
  if (preferredId && !UUID_V7.test(preferredId)) throw new Error('Existing device ID is not a UUIDv7; refusing to replace this device identity')
  const id = preferredId || newDeviceUuidV7()
  setCaptureState(db, 'device_id', id)
  return id
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

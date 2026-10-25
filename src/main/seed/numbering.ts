import type Database from 'better-sqlite3'
import { captureState, setCaptureState } from './gate'
const tables = new Set(['ventes', 'reparations', 'factures_clients', 'documents', 'ventes_en_ligne', 'rapports_caisse', 'avances_clients'])

/** Reservations may leave gaps after cancellation, but can never reuse a number.
 * Device UUID is kept in full: shortening it without server allocation can collide. */
export function reserveNumber(db: Database.Database, table: string, proposed: string): string {
  if (!tables.has(table) || typeof proposed !== 'string' || !proposed.length || proposed.length > 100 || /[\x00-\x1f]/.test(proposed)) throw new Error('Invalid document numbering request')
  if (captureState(db, 'sync_backend') !== 'vps') return proposed
  const device = captureState(db, 'device_id')
  if (!device || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(device)) throw new Error('Register this PC before creating synchronized documents')
  return db.transaction(() => {
    const key = `number:${table}`, current = Number(captureState(db, key) ?? 0)
    if (!Number.isSafeInteger(current) || current < 0 || current >= Number.MAX_SAFE_INTEGER) throw new Error('Document sequence exhausted')
    let next = current, number: string
    do {
      next++
      if (!Number.isSafeInteger(next)) throw new Error('Document sequence exhausted')
      number = `${proposed.replace(/\d+$/, '')}${device.toLowerCase()}-${String(next).padStart(6, '0')}`
    } while (db.prepare(`SELECT 1 FROM "${table}" WHERE numero=?`).get(number))
    setCaptureState(db, key, String(next))
    return number
  }).immediate()
}

export const newCashId = (db: Database.Database, date: string) =>
  `${captureState(db, 'sync_backend') === 'vps' ? 'caisse:' : 'ci-'}${date}`

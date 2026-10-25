import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { captureState, canDrainOutbox } from './gate'

/** Close admission before waiting: an existing legacy request may finish, but
 * no second sync backend can start while any legacy operation is in flight. */
export class LegacySyncGate {
  private closing = false
  private leases = new Set<string>()
  constructor(private readonly db: () => Database.Database) {}
  allowed() { return !this.closing && captureState(this.db(), 'sync_backend') !== 'vps' }
  begin(): string | null {
    if (!this.allowed()) return null
    const token = randomUUID(); this.leases.add(token); return token
  }
  end(token: string) { this.leases.delete(token) }
  async quiesce(timeout = 60_000): Promise<void> {
    this.closing = true
    const deadline = Date.now() + timeout
    while (this.leases.size) {
      if (Date.now() >= deadline) throw new Error('Old sync is still running. Restart the app, then retry backup before seeding.')
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }
}

/** Restarts live sync only for a previously verified seed/join. Never runs seed. */
export function startLiveRuntime(db: () => Database.Database, operations: {
  drain: () => Promise<unknown>; pull: () => Promise<unknown>
}, interval = 2_000) {
  let stopped = false, timer: ReturnType<typeof setTimeout> | null = null, nextPull = 0
  const tick = async () => {
    try {
      const connection = db()
      if (captureState(connection, 'sync_backend') === 'vps' && canDrainOutbox(connection)) {
        await operations.drain()
        if (Date.now() >= nextPull) { nextPull = Date.now() + 15_000; await operations.pull() }
      }
    } catch { /* Persisted operation errors are displayed by the monitor. */ }
    finally { if (!stopped) { timer = setTimeout(tick, interval); timer.unref?.() } }
  }
  timer = setTimeout(tick, interval); timer.unref?.()
  return () => { stopped = true; if (timer) clearTimeout(timer) }
}

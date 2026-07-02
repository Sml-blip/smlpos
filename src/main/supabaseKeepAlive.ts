import { getDb } from './db'

declare const __SML_SUPABASE_URL__: string | undefined
declare const __SML_SUPABASE_ANON_KEY__: string | undefined

/** Ping Supabase at least every 12h while the app runs (prevents free-tier pause when shop is open). */
const KEEPALIVE_INTERVAL_MS = 12 * 60 * 60 * 1000

function getSupabaseCredentials(): { url: string; key: string } | null {
  const url = (typeof __SML_SUPABASE_URL__ === 'string' ? __SML_SUPABASE_URL__ : '').trim()
  const key = (typeof __SML_SUPABASE_ANON_KEY__ === 'string' ? __SML_SUPABASE_ANON_KEY__ : '').trim()
  if (!url || !key || url.includes('your-project')) return null
  return { url, key }
}

function recordKeepAlive(ok: boolean, error?: string): void {
  try {
    const db = getDb()
    const stmt = db.prepare(`
      INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `)
    if (ok) {
      stmt.run('supabase_keepalive_at', new Date().toISOString())
      db.prepare(`DELETE FROM app_settings WHERE key = 'supabase_keepalive_error'`).run()
    } else if (error) {
      stmt.run('supabase_keepalive_error', error.slice(0, 500))
    }
  } catch {
    // DB may not be ready yet
  }
}

export async function pingSupabaseKeepAlive(): Promise<boolean> {
  const creds = getSupabaseCredentials()
  if (!creds) return false

  try {
    const res = await fetch(`${creds.url}/rest/v1/app_settings?select=key&limit=1`, {
      headers: {
        apikey: creds.key,
        Authorization: `Bearer ${creds.key}`,
      },
    })
    if (!res.ok) {
      recordKeepAlive(false, `HTTP ${res.status}`)
      console.warn('[supabase] Keep-alive ping failed:', res.status)
      return false
    }
    recordKeepAlive(true)
    console.log('[supabase] Keep-alive ping OK')
    return true
  } catch (e) {
    const msg = String(e)
    recordKeepAlive(false, msg)
    console.warn('[supabase] Keep-alive error:', e)
    return false
  }
}

let _timer: ReturnType<typeof setInterval> | null = null

export function startSupabaseKeepAlive(): void {
  if (_timer || !getSupabaseCredentials()) return

  const tick = () => { void pingSupabaseKeepAlive() }
  setTimeout(tick, 45_000)
  _timer = setInterval(tick, KEEPALIVE_INTERVAL_MS)
}

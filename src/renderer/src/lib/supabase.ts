/**
 * Supabase client for SMLPOS renderer (browser/Electron).
 * When VITE_SUPABASE_ENABLED is false or credentials are missing,
 * all methods return null/noop so the app works fully offline.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const enabled = import.meta.env.VITE_SUPABASE_ENABLED !== 'false'

let _supabase: SupabaseClient | null = null

if (enabled && url && key && !url.includes('your-project')) {
  _supabase = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
    realtime: {
      params: { eventsPerSecond: 5 },
    },
  })
}

export const supabase = _supabase
export const isSupabaseEnabled = _supabase !== null

/** Sign in with email + password (SuperAdmin from web panel). */
export async function signIn(email: string, password: string) {
  if (!_supabase) return { error: new Error('Supabase non configuré') }
  return _supabase.auth.signInWithPassword({ email, password })
}

/** Sign out the current session. */
export async function signOut() {
  if (!_supabase) return
  await _supabase.auth.signOut()
}

/** Get current session (null if offline or not signed in). */
export async function getSession() {
  if (!_supabase) return null
  const { data } = await _supabase.auth.getSession()
  return data.session
}

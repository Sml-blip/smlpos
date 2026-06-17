#!/usr/bin/env node
/**
 * Validates VITE_SUPABASE_* env vars before packaging.
 * Skips check when SKIP_SUPABASE_CHECK=1 (offline-only builds).
 */
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

if (process.env.SKIP_SUPABASE_CHECK === '1') {
  console.info('[check-env] SKIP_SUPABASE_CHECK=1 — Supabase validation skipped')
  process.exit(0)
}

function loadEnvFile(name) {
  const path = join(root, name)
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 0) continue
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  }
  return out
}

const env = { ...loadEnvFile('.env'), ...loadEnvFile('.env.local'), ...process.env }
const enabled = env.VITE_SUPABASE_ENABLED !== 'false'
const url = env.VITE_SUPABASE_URL ?? ''
const key = env.VITE_SUPABASE_ANON_KEY ?? ''

if (!enabled) {
  console.warn('[check-env] VITE_SUPABASE_ENABLED=false — packaged app will run offline-only')
  process.exit(0)
}

if (!url || url.includes('your-project') || !key) {
  console.error('[check-env] Missing Supabase credentials for packaged build.')
  console.error('  Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local')
  console.error('  Or set SKIP_SUPABASE_CHECK=1 for offline-only builds')
  process.exit(1)
}

console.info('[check-env] Supabase credentials OK for build')

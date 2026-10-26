import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'

const sourceEnv = 'C:\\Users\\moote\\Documents\\SMLSITE\\.env.local'
const env = Object.fromEntries(readFileSync(sourceEnv, 'utf8').split(/\r?\n/).map(line => {
  const i = line.indexOf('=')
  return i > 0 ? [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^["']|["']$/g, '')] : []
}).filter(row => row.length === 2))

const supabaseUrl = env.SUPABASE_URL
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceKey) throw new Error('Configuration Supabase SMLSITE manquante')

const allowedTables = new Set([
  'ventes', 'lignes_vente', 'reparations', 'documents', 'produits',
  'clients', 'organisations', 'personnels', 'factures_fournisseurs',
  'credits_clients', 'sorties_caisse', 'shifts', 'avances_clients',
])

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Boss-Pin',
  'Content-Type': 'application/json; charset=utf-8',
}

function send(res, status, body) {
  res.writeHead(status, headers)
  res.end(JSON.stringify(body))
}

async function supabaseGet(path) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  })
  const text = await response.text()
  if (!response.ok) throw new Error(text || `Supabase HTTP ${response.status}`)
  return text ? JSON.parse(text) : []
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, headers); res.end(); return }
  if (req.method !== 'GET') { send(res, 405, { message: 'Lecture seule: méthode interdite' }); return }
  if (req.headers['x-boss-pin'] !== '11223344') { send(res, 401, { message: 'PIN invalide' }); return }
  const url = new URL(req.url ?? '/', 'http://localhost')
  try {
    if (url.pathname === '/health') { send(res, 200, { ok: true, mode: 'read-only' }); return }
    if (url.pathname === '/product') {
      const barcode = url.searchParams.get('barcode') ?? ''
      const rows = await supabaseGet(`produits?select=*&code_barre=eq.${encodeURIComponent(barcode)}&limit=1`)
      send(res, 200, rows[0] ?? null)
      return
    }
    if (url.pathname === '/rows') {
      const table = url.searchParams.get('table') ?? ''
      if (!allowedTables.has(table)) { send(res, 403, { message: 'Table non autorisée' }); return }
      const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get('limit')) || 100))
      const order = (url.searchParams.get('order') ?? '').replace(/[^a-zA-Z0-9_]/g, '')
      const ascending = url.searchParams.get('ascending') === 'true'
      const filters = JSON.parse(url.searchParams.get('filters') || '{}')
      const gte = JSON.parse(url.searchParams.get('gte') || '{}')
      const lte = JSON.parse(url.searchParams.get('lte') || '{}')
      const params = new URLSearchParams({ select: '*', limit: String(limit) })
      if (order) params.set('order', `${order}.${ascending ? 'asc' : 'desc'}`)
      for (const [key, value] of Object.entries(filters)) {
        if (/^[a-zA-Z0-9_]+$/.test(key) && value !== '' && value !== null && value !== undefined) params.set(key, `eq.${value}`)
      }
      for (const [key, value] of Object.entries(gte)) {
        if (/^[a-zA-Z0-9_]+$/.test(key) && value !== '' && value !== null && value !== undefined) params.set(key, `gte.${value}`)
      }
      for (const [key, value] of Object.entries(lte)) {
        if (/^[a-zA-Z0-9_]+$/.test(key) && value !== '' && value !== null && value !== undefined) params.set(key, `lte.${value}`)
      }
      send(res, 200, await supabaseGet(`${table}?${params}`))
      return
    }
    send(res, 404, { message: 'Route inconnue' })
  } catch (error) {
    send(res, 502, { message: error instanceof Error ? error.message : String(error) })
  }
})

server.listen(8787, '0.0.0.0', () => console.log('SMLPOS Boss gateway read-only: http://0.0.0.0:8787'))


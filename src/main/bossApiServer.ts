import { createServer, type Server, type ServerResponse } from 'node:http'
import { db } from './db'

const PORT = 8787
const BOSS_PIN = '11223344'
const ALLOWED_TABLES = new Set([
  'ventes', 'lignes_vente', 'reparations', 'documents', 'produits',
  'clients', 'organisations', 'personnels', 'factures_fournisseurs',
  'credits_clients', 'sorties_caisse', 'shifts', 'avances_clients',
])

let server: Server | null = null

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Boss-Pin',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
}

function send(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, headers)
  response.end(JSON.stringify(value))
}

function cleanColumn(value: string) {
  return /^[a-zA-Z0-9_]+$/.test(value) ? value : ''
}

function parseObject(value: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function startBossApiServer() {
  if (server) return
  server = createServer((request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, headers)
      response.end()
      return
    }
    if (request.method !== 'GET') {
      send(response, 405, { message: 'SMLBOSS est strictement en lecture seule' })
      return
    }
    if (request.headers['x-boss-pin'] !== BOSS_PIN) {
      send(response, 401, { message: 'PIN SMLBOSS invalide' })
      return
    }
    const url = new URL(request.url ?? '/', 'http://localhost')
    try {
      if (url.pathname === '/health') {
        send(response, 200, { ok: true, source: 'smlpos-local', mode: 'read-only', at: new Date().toISOString() })
        return
      }
      if (url.pathname === '/product') {
        const barcode = url.searchParams.get('barcode')?.trim() ?? ''
        const row = barcode ? db.prepare('SELECT * FROM produits WHERE code_barre = ? LIMIT 1').get(barcode) : null
        send(response, 200, row ?? null)
        return
      }
      if (url.pathname !== '/rows') {
        send(response, 404, { message: 'Route SMLBOSS inconnue' })
        return
      }

      const table = url.searchParams.get('table') ?? ''
      if (!ALLOWED_TABLES.has(table)) {
        send(response, 403, { message: 'Table non autorisée' })
        return
      }
      const limit = Math.min(2500, Math.max(1, Number(url.searchParams.get('limit')) || 100))
      const order = cleanColumn(url.searchParams.get('order') ?? '')
      const ascending = url.searchParams.get('ascending') === 'true'
      const clauses: string[] = []
      const parameters: unknown[] = []
      const addConditions = (values: Record<string, unknown>, operator: '=' | '>=' | '<=') => {
        for (const [rawKey, value] of Object.entries(values)) {
          const key = cleanColumn(rawKey)
          if (!key || value === '' || value === null || value === undefined) continue
          clauses.push(`${key} ${operator} ?`)
          parameters.push(value)
        }
      }
      addConditions(parseObject(url.searchParams.get('filters')), '=')
      addConditions(parseObject(url.searchParams.get('gte')), '>=')
      addConditions(parseObject(url.searchParams.get('lte')), '<=')
      const sql = [
        `SELECT * FROM ${table}`,
        clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
        order ? `ORDER BY ${order} ${ascending ? 'ASC' : 'DESC'}` : '',
        'LIMIT ?',
      ].filter(Boolean).join(' ')
      parameters.push(limit)
      send(response, 200, db.prepare(sql).all(...parameters))
    } catch (error) {
      send(response, 500, { message: error instanceof Error ? error.message : String(error) })
    }
  })
  server.on('error', error => {
    console.warn('[SMLBOSS API] Local read-only server unavailable:', error.message)
    server = null
  })
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[SMLBOSS API] Direct SQLite read-only endpoint active on port ${PORT}`)
  })
}

export function stopBossApiServer() {
  server?.close()
  server = null
}

import { isCloudConfigured, supabase } from './supabase'
import AsyncStorage from '@react-native-async-storage/async-storage'

export type Row = Record<string, unknown>
const gatewayUrl = process.env.EXPO_PUBLIC_BOSS_API_URL?.replace(/\/$/, '') ?? ''
const GATEWAY_KEY = 'smlboss:gateway-url'
export const dataMode = gatewayUrl ? 'gateway' : isCloudConfigured ? 'cloud' : 'unconfigured'

export type ReadOptions = {
  limit?: number
  order?: string
  ascending?: boolean
  filters?: Record<string, unknown>
  gte?: Record<string, string | number>
  lte?: Record<string, string | number>
}

async function gatewayGet(path: string) {
  const baseUrl = await getGatewayUrl()
  const response = await fetch(`${baseUrl}${path}`, { headers: { 'X-Boss-Pin': '11223344' } })
  const data = await response.json()
  if (!response.ok) throw data
  return data
}

export async function getGatewayUrl() {
  return (await AsyncStorage.getItem(GATEWAY_KEY))?.replace(/\/$/, '') || gatewayUrl
}

export async function setGatewayUrl(value: string) {
  const normalized = value.trim().replace(/\/$/, '')
  if (!/^https?:\/\/[^/]+(?::\d+)?$/i.test(normalized)) throw new Error('Adresse invalide. Exemple : http://192.168.0.126:8787')
  await AsyncStorage.setItem(GATEWAY_KEY, normalized)
}

export async function testGateway() {
  return await gatewayGet('/health') as { ok?: boolean; source?: string; mode?: string; at?: string }
}

export async function readRows(table: string, options: ReadOptions = {}) {
  if (gatewayUrl) {
    const query = new URLSearchParams({
      table,
      limit: String(options.limit ?? 100),
      order: options.order ?? '',
      ascending: String(options.ascending ?? false),
      filters: JSON.stringify(options.filters ?? {}),
      gte: JSON.stringify(options.gte ?? {}),
      lte: JSON.stringify(options.lte ?? {}),
    })
    return await gatewayGet(`/rows?${query}`) as Row[]
  }
  if (!isCloudConfigured) throw new Error('Connexion Supabase non configurée. Ajoutez EXPO_PUBLIC_SUPABASE_URL et EXPO_PUBLIC_SUPABASE_ANON_KEY dans mobile/.env, puis redémarrez Expo.')
  let query = supabase.from(table).select('*')
  for (const [key, value] of Object.entries(options.filters ?? {})) {
    if (value !== undefined && value !== null && value !== '') query = query.eq(key, value)
  }
  for (const [key, value] of Object.entries(options.gte ?? {})) query = query.gte(key, value)
  for (const [key, value] of Object.entries(options.lte ?? {})) query = query.lte(key, value)
  if (options.order) query = query.order(options.order, { ascending: options.ascending ?? false })
  const { data, error } = await query.limit(options.limit ?? 100)
  if (error) throw error
  return (data ?? []) as Row[]
}

export function subscribeToTable(table: string, onChange: () => void) {
  if (dataMode !== 'cloud') return () => {}
  const channel = supabase
    .channel(`smlboss:${table}:${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table }, onChange)
    .subscribe()
  return () => { void supabase.removeChannel(channel) }
}

export async function countRows(table: string, filters: Record<string, unknown> = {}) {
  if (!isCloudConfigured) throw new Error('Connexion Supabase non configurée dans mobile/.env')
  let query = supabase.from(table).select('*', { count: 'exact', head: true })
  for (const [key, value] of Object.entries(filters)) query = query.eq(key, value)
  const { count, error } = await query
  if (error) throw error
  return count ?? 0
}

export async function findProductByBarcode(code: string) {
  if (gatewayUrl) return await gatewayGet(`/product?barcode=${encodeURIComponent(code)}`) as Row | null
  if (!isCloudConfigured) throw new Error('Connexion Supabase non configurée dans mobile/.env')
  const { data, error } = await supabase.from('produits').select('*').eq('code_barre', code).maybeSingle()
  if (error) throw error
  return data as Row | null
}


import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useFocusEffect } from 'expo-router'
import { dataMode, readRows, subscribeToTable, type Row } from '@/lib/data'
import { errorMessage } from '@/lib/format'

export function useRows(table: string, options: Parameters<typeof readRows>[1] = {}) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [usingCache, setUsingCache] = useState(false)
  const mounted = useRef(true)
  const cacheKey = `smlboss:cache:${table}:${JSON.stringify(options)}`
  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    try {
      const next = await readRows(table, options)
      if (!mounted.current) return
      setRows(previous => {
        const fingerprint = (items: Row[]) => items.map(item => `${item.id}:${item.updated_at ?? item.created_at ?? ''}:${item.stock_actuel ?? ''}:${item.total_ttc ?? ''}:${item.statut ?? ''}`).join('|')
        return fingerprint(previous) === fingerprint(next) ? previous : next
      })
      setUsingCache(false)
      setLastUpdated(new Date())
      void AsyncStorage.setItem(cacheKey, JSON.stringify({ rows: next, at: Date.now() }))
    } catch (cause) {
      const cached = await AsyncStorage.getItem(cacheKey)
      if (!mounted.current) return
      if (cached) {
        const parsed = JSON.parse(cached) as { rows?: Row[]; at?: number }
        setRows(parsed.rows ?? [])
        setLastUpdated(parsed.at ? new Date(parsed.at) : null)
        setUsingCache(true)
      }
      setError(errorMessage(cause))
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [table, JSON.stringify(options), cacheKey])
  useFocusEffect(useCallback(() => {
    void refresh()
    const interval = dataMode === 'gateway' ? setInterval(() => void refresh(true), 8_000) : undefined
    return () => { if (interval) clearInterval(interval) }
  }, [refresh]))
  useEffect(() => {
    mounted.current = true
    const unsubscribe = subscribeToTable(table, () => void refresh(true))
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh(true)
    })
    return () => {
      mounted.current = false
      unsubscribe()
      appState.remove()
    }
  }, [table, refresh])
  return { rows, loading, error, refresh: () => refresh(false), lastUpdated, usingCache, online: !error }
}


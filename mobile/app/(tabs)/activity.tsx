import { useMemo, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import * as Haptics from 'expo-haptics'
import { Card, EmptyState, ErrorState, LoadingState, PageTitle, Pill, Screen } from '@/components/ui'
import { useRows } from '@/hooks/useRows'
import { dateTime, localDateKey, money } from '@/lib/format'

type Period = 'today' | '7days' | '30days' | 'all'

export default function ActivityScreen() {
  const [mode, setMode] = useState<'sales'|'repairs'>('sales')
  const [period, setPeriod] = useState<Period>('7days')
  const sales = useRows('ventes', { limit: 1000, order: 'created_at' })
  const repairs = useRows('reparations', { limit: 500, order: 'updated_at' })
  const current = mode === 'sales' ? sales : repairs
  const periodOptions: Array<{ id: Period; label: string; days?: number }> = [
    { id: 'today', label: 'Aujourd’hui', days: 0 },
    { id: '7days', label: '7 jours', days: 7 },
    { id: '30days', label: '30 jours', days: 30 },
    { id: 'all', label: 'Tout' },
  ]
  const rows = useMemo(() => {
    const selected = periodOptions.find(item => item.id === period)
    if (selected?.days === undefined) return current.rows
    const threshold = new Date()
    threshold.setDate(threshold.getDate() - selected.days)
    const thresholdKey = localDateKey(threshold)
    return current.rows.filter(row => localDateKey(mode === 'sales' ? row.created_at : row.updated_at) >= thresholdKey)
  }, [current.rows, mode, period])
  const total = mode === 'sales' ? rows.filter(row => row.statut !== 'ANNULEE').reduce((sum, row) => sum + Number(row.total_ttc || 0), 0) : 0

  return <Screen refreshing={current.loading} onRefresh={current.refresh}>
    <PageTitle title="Activité" subtitle="Par date, mise à jour automatiquement"/>
    <View className="mb-3 flex-row rounded-2xl bg-muted p-1">
      {(['sales', 'repairs'] as const).map(value => <Pressable key={value} onPress={() => { setMode(value); void Haptics.selectionAsync() }} className={`flex-1 rounded-xl py-3 ${mode === value ? 'bg-brand' : ''}`}><Text className="text-center font-bold text-ink">{value === 'sales' ? 'Ventes' : 'Réparations'}</Text></Pressable>)}
    </View>
    <View className="mb-4 flex-row gap-2">
      {periodOptions.map(item => <Pressable key={item.id} onPress={() => { setPeriod(item.id); void Haptics.selectionAsync() }} className={`flex-1 rounded-xl border px-2 py-2 ${period === item.id ? 'border-brand-dark bg-brand-soft' : 'border-line bg-white'}`}><Text className="text-center text-[11px] font-bold text-ink">{item.label}</Text></Pressable>)}
    </View>
    <View className="mb-4 flex-row items-center justify-between rounded-2xl bg-ink px-4 py-3">
      <View><Text className="text-xs font-semibold text-white/60">{rows.length} résultat{rows.length > 1 ? 's' : ''}</Text><Text className="mt-0.5 font-bold text-white">{periodOptions.find(item => item.id === period)?.label}</Text></View>
      {mode === 'sales' ? <Text className="text-xl font-black text-brand">{money(total)}</Text> : null}
    </View>
    {current.loading && !current.rows.length ? <LoadingState/> : current.error && !current.rows.length ? <ErrorState message={current.error} retry={current.refresh}/> : !rows.length ? <EmptyState label="Aucune donnée pour cette période"/> : <Card className="p-0">{rows.map(row => mode === 'sales' ? <View key={String(row.id)} className="flex-row items-center justify-between border-b border-line px-4 py-3"><View className="flex-1 pr-3"><View className="flex-row items-center gap-2"><Text className="font-bold text-ink">{String(row.numero)}</Text><Pill tone={row.statut === 'ANNULEE' ? 'red' : 'green'}>{String(row.statut ?? 'ACTIVE')}</Pill></View><Text className="mt-1 text-xs text-secondary">{String(row.client_nom ?? 'Client passager')} · {String(row.mode_paiement ?? '—')}</Text><Text className="mt-1 text-[11px] text-subtle">{dateTime(row.created_at)}</Text></View><Text className="font-extrabold text-ink">{money(row.total_ttc)}</Text></View> : <View key={String(row.id)} className="border-b border-line px-4 py-3"><View className="flex-row items-center justify-between"><Text className="font-bold text-ink">{String(row.numero)} · {String(row.client_nom)}</Text><Pill tone="yellow">{String(row.statut).replaceAll('_',' ')}</Pill></View><Text className="mt-2 text-sm text-secondary">{String(row.type_appareil ?? '')} {String(row.marque ?? '')} {String(row.modele ?? '')}</Text><Text className="mt-1 text-xs text-subtle">{String(row.description_panne ?? '')} · {dateTime(row.updated_at)}</Text></View>)}</Card>}
  </Screen>
}


import { useMemo } from 'react'
import { Pressable, Text, View } from 'react-native'
import * as Haptics from 'expo-haptics'
import { CalendarDays, ChevronRight, Clock3, TrendingUp } from 'lucide-react-native'
import Animated, { FadeInDown } from 'react-native-reanimated'
import { Card, ErrorState, LoadingState, MetricCard, PageTitle, Pill, Screen, StatusBadge } from '@/components/ui'
import { useRows } from '@/hooks/useRows'
import { dateTime, dayLabel, localDateKey, money } from '@/lib/format'
import { colors } from '@/theme/tokens'

type DaySummary = { key: string; total: number; count: number; cash: number; card: number }

export default function DashboardScreen() {
  const sales = useRows('ventes', { limit: 750, order: 'created_at' })
  const repairs = useRows('reparations', { limit: 200, order: 'updated_at' })
  const documents = useRows('documents', { limit: 100, order: 'created_at' })
  const products = useRows('produits', { limit: 2000, order: 'nom', ascending: true })
  const loading = sales.loading || repairs.loading || documents.loading || products.loading
  const error = sales.error || repairs.error || documents.error || products.error
  const refresh = async () => {
    await Haptics.selectionAsync()
    await Promise.all([sales.refresh(), repairs.refresh(), documents.refresh(), products.refresh()])
  }

  const activeSales = useMemo(() => sales.rows.filter(row => row.statut !== 'ANNULEE'), [sales.rows])
  const summaries = useMemo(() => {
    const byDay = new Map<string, DaySummary>()
    for (const row of activeSales) {
      const key = localDateKey(row.created_at)
      if (!key) continue
      const current = byDay.get(key) ?? { key, total: 0, count: 0, cash: 0, card: 0 }
      const amount = Number(row.total_ttc || 0)
      current.total += amount
      current.count += 1
      if (row.mode_paiement === 'ESPECES') current.cash += amount
      if (row.mode_paiement === 'CARTE') current.card += amount
      byDay.set(key, current)
    }
    return [...byDay.values()].sort((a, b) => b.key.localeCompare(a.key)).slice(0, 8)
  }, [activeSales])

  const todayKey = localDateKey()
  const today = summaries.find(day => day.key === todayKey) ?? { key: todayKey, total: 0, count: 0, cash: 0, card: 0 }
  const todaySales = activeSales.filter(row => localDateKey(row.created_at) === todayKey)
  const activeRepairs = repairs.rows.filter(row => !['TERMINE', 'LIVRE', 'ANNULE', 'NON_REPARABLE'].includes(String(row.statut)))
  const lowStock = products.rows.filter(row => Number(row.actif) !== 0 && Number(row.stock_actuel) <= Number(row.stock_minimum))
  const lastSync = sales.lastUpdated?.toLocaleTimeString('fr-TN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  return <Screen refreshing={loading} onRefresh={() => void refresh()}>
    <PageTitle
      title="SMLBOSS"
      subtitle={`${dayLabel(todayKey)} · pilotage de votre activité`}
      action={<StatusBadge online={!error} label={error ? 'Données en cache' : lastSync ? `À jour ${lastSync}` : 'Connexion…'}/>}
    />
    {loading && !sales.rows.length ? <LoadingState/> : error && !sales.rows.length ? <ErrorState message={error} retry={refresh}/> : <>
      <Animated.View entering={FadeInDown.duration(400)} className="mb-4 overflow-hidden rounded-[26px] bg-ink p-5">
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-xs font-bold uppercase tracking-[2px] text-brand">Chiffre d’affaires du jour</Text>
            <Text className="mt-2 text-4xl font-black text-white">{money(today.total)}</Text>
          </View>
          <View className="h-12 w-12 items-center justify-center rounded-2xl bg-white/10"><TrendingUp size={25} color={colors.brand}/></View>
        </View>
        <View className="mt-5 flex-row gap-3">
          <View className="flex-1 rounded-2xl bg-white/10 p-3"><Text className="text-xs text-white/60">Ventes</Text><Text className="mt-1 text-xl font-black text-white">{today.count}</Text></View>
          <View className="flex-1 rounded-2xl bg-white/10 p-3"><Text className="text-xs text-white/60">Espèces</Text><Text className="mt-1 font-extrabold text-white">{money(today.cash)}</Text></View>
          <View className="flex-1 rounded-2xl bg-white/10 p-3"><Text className="text-xs text-white/60">Carte</Text><Text className="mt-1 font-extrabold text-white">{money(today.card)}</Text></View>
        </View>
      </Animated.View>

      <View className="flex-row flex-wrap gap-3">
        <MetricCard label="Réparations actives" value={String(activeRepairs.length)} tone="blue"/>
        <MetricCard label="Stock faible" value={String(lowStock.length)} tone={lowStock.length ? 'red' : 'green'}/>
        <MetricCard label="Documents récents" value={String(documents.rows.length)} tone="green"/>
        <MetricCard label="Dernière synchro" value={lastSync ?? '—'} hint={sales.usingCache ? 'Copie hors ligne' : 'Actualisation automatique'}/>
      </View>

      <View className="mb-3 mt-7 flex-row items-center gap-2"><CalendarDays size={19} color={colors.ink}/><Text className="text-lg font-extrabold text-ink">Résumé par journée</Text></View>
      <Card className="p-0">
        {summaries.map((day, index) => <Animated.View key={day.key} entering={FadeInDown.delay(index * 35)} className="flex-row items-center border-b border-line px-4 py-3 last:border-0">
          <View className="h-11 w-11 items-center justify-center rounded-2xl bg-brand-soft"><Text className="text-xs font-black text-brand-dark">{day.key.slice(8)}</Text></View>
          <View className="ml-3 flex-1"><Text className="font-bold text-ink">{dayLabel(day.key)}</Text><Text className="mt-0.5 text-xs text-secondary">{day.count} vente{day.count > 1 ? 's' : ''}</Text></View>
          <Text className="font-extrabold text-ink">{money(day.total)}</Text>
        </Animated.View>)}
        {!summaries.length ? <Text className="p-6 text-center text-secondary">Aucune vente synchronisée</Text> : null}
      </Card>

      <View className="mb-3 mt-7 flex-row items-center justify-between">
        <View className="flex-row items-center gap-2"><Clock3 size={19} color={colors.ink}/><Text className="text-lg font-extrabold text-ink">Ventes d’aujourd’hui</Text></View>
        <Pill tone="blue">{todaySales.length}</Pill>
      </View>
      <Card className="p-0">
        {todaySales.slice(0, 10).map(row => <Pressable key={String(row.id)} onPress={() => void Haptics.selectionAsync()} className="flex-row items-center border-b border-line px-4 py-3 last:border-0">
          <View className="flex-1 pr-3"><Text className="font-bold text-ink">{String(row.numero ?? 'Vente')}</Text><Text className="mt-1 text-xs text-secondary">{String(row.client_nom ?? 'Client passager')} · {dateTime(row.created_at)}</Text></View>
          <Text className="font-extrabold text-ink">{money(row.total_ttc)}</Text><ChevronRight size={15} color={colors.subtle}/>
        </Pressable>)}
        {!todaySales.length ? <Text className="p-6 text-center text-secondary">Aucune vente aujourd’hui</Text> : null}
      </Card>
    </>}
  </Screen>
}


import { Text, View } from 'react-native'
import { Card, EmptyState, ErrorState, LoadingState, PageTitle, Pill, Screen } from '@/components/ui'
import { useRows } from '@/hooks/useRows'
import { dateTime, money } from '@/lib/format'

export default function DocumentsScreen() {
  const data = useRows('documents', { limit: 300, order: 'created_at' })
  return <Screen refreshing={data.loading} onRefresh={data.refresh}><PageTitle title="Documents" subtitle="Factures, devis, bons de livraison et avoirs"/>
    {data.loading ? <LoadingState/> : data.error ? <ErrorState message={data.error} retry={data.refresh}/> : !data.rows.length ? <EmptyState label="Aucun document"/> : <Card>{data.rows.map(row => <View key={String(row.id)} className="flex-row items-center justify-between border-b border-line py-3"><View className="flex-1 pr-3"><View className="flex-row flex-wrap items-center gap-2"><Text className="font-bold text-ink">{String(row.numero)}</Text><Pill tone={row.statut === 'ANNULE' || row.statut === 'REVOQUE' ? 'red' : 'blue'}>{String(row.type_document).replaceAll('_',' ')}</Pill></View><Text className="mt-1 text-xs text-secondary">{String(row.client_nom ?? 'Client passager')} · {String(row.statut_paiement ?? '—')}</Text><Text className="mt-1 text-[11px] text-subtle">{dateTime(row.created_at)}</Text></View><Text className="font-extrabold text-ink">{money(row.total_ttc)}</Text></View>)}</Card>}
  </Screen>
}


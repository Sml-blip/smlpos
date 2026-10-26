import { useEffect, useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { Button, ButtonText } from '@gluestack-ui/themed'
import { Building2, CreditCard, ShoppingCart, Users } from 'lucide-react-native'
import { Card, EmptyState, ErrorState, LoadingState, PageTitle, Pill, Screen } from '@/components/ui'
import { useRows } from '@/hooks/useRows'
import { dateOnly, money } from '@/lib/format'
import { useAuth } from '@/providers/AuthProvider'
import { colors } from '@/theme/tokens'
import { getGatewayUrl, setGatewayUrl, testGateway } from '@/lib/data'

type Mode = 'clients'|'personnel'|'purchases'|'credits'

const modes: Array<{ id: Mode; label: string; icon: typeof Users }> = [
  { id: 'clients', label: 'Clients', icon: Users },
  { id: 'personnel', label: 'Personnel', icon: Building2 },
  { id: 'purchases', label: 'Achats', icon: ShoppingCart },
  { id: 'credits', label: 'Crédits', icon: CreditCard },
]

export default function MoreScreen() {
  const [mode, setMode] = useState<Mode>('clients')
  const [serverUrl, setServerUrl] = useState('')
  const [connectionState, setConnectionState] = useState('')
  const { signOut } = useAuth()
  const table = mode === 'clients' ? 'clients' : mode === 'personnel' ? 'personnels' : mode === 'purchases' ? 'factures_fournisseurs' : 'credits_clients'
  const data = useRows(table, { limit: 500, order: 'created_at' })
  useEffect(() => { void getGatewayUrl().then(setServerUrl) }, [])
  const saveConnection = async () => {
    setConnectionState('Connexion…')
    try {
      await setGatewayUrl(serverUrl)
      const health = await testGateway()
      setConnectionState(health.ok ? 'Connecté directement à SMLPOS ✓' : 'Réponse invalide')
      await data.refresh()
    } catch (error) {
      setConnectionState(error instanceof Error ? error.message : String(error))
    }
  }
  return <Screen refreshing={data.loading} onRefresh={data.refresh}><PageTitle title="Plus" subtitle="Toutes les autres données du POS"/>
    <Card className="mb-4">
      <Text className="font-extrabold text-ink">Connexion au POS</Text>
      <Text className="mt-1 text-xs text-secondary">Adresse locale du PC SMLPOS. Modifiez-la si l’adresse Wi-Fi du PC change.</Text>
      <TextInput value={serverUrl} onChangeText={setServerUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="http://192.168.0.126:8787" className="mt-3 h-12 rounded-xl border border-line bg-muted px-3 text-ink"/>
      <Pressable onPress={() => void saveConnection()} className="mt-2 rounded-xl bg-brand py-3"><Text className="text-center font-extrabold text-ink">Tester et enregistrer</Text></Pressable>
      {connectionState ? <Text className={`mt-2 text-xs font-semibold ${connectionState.includes('✓') ? 'text-success' : 'text-danger'}`}>{connectionState}</Text> : null}
    </Card>
    <View className="mb-4 flex-row flex-wrap gap-2">{modes.map(item => { const Icon = item.icon; return <Pressable key={item.id} onPress={()=>setMode(item.id)} className={`min-w-[46%] flex-1 flex-row items-center gap-2 rounded-2xl border p-3 ${mode===item.id?'border-brand-dark bg-brand-soft':'border-line bg-white'}`}><Icon size={17} color={mode===item.id?colors.brandDark:colors.secondary}/><Text className="font-bold text-ink">{item.label}</Text></Pressable> })}</View>
    {data.loading ? <LoadingState/> : data.error ? <ErrorState message={data.error} retry={data.refresh}/> : !data.rows.length ? <EmptyState label="Aucune donnée"/> : <Card>{data.rows.map(row => <View key={String(row.id)} className="border-b border-line py-3">{mode==='clients'?<View className="flex-row justify-between"><View><Text className="font-bold">{String(row.nom)}</Text><Text className="mt-1 text-xs text-secondary">{String(row.telephone ?? 'Sans téléphone')}</Text></View><Text className="font-bold text-danger">{money(row.solde_credit)}</Text></View>:mode==='personnel'?<View className="flex-row justify-between"><View><Text className="font-bold">{String(row.nom)} {String(row.prenom ?? '')}</Text><Text className="mt-1 text-xs text-secondary">{String(row.poste ?? 'Poste non défini')}</Text></View><Pill tone={Number(row.actif)!==0?'green':'red'}>{Number(row.actif)!==0?'Actif':'Inactif'}</Pill></View>:mode==='purchases'?<View className="flex-row justify-between"><View><Text className="font-bold">{String(row.numero_facture)}</Text><Text className="mt-1 text-xs text-secondary">{dateOnly(row.date_facture)} · {String(row.statut_paiement)}</Text></View><Text className="font-bold">{money(row.montant_ttc)}</Text></View>:<View className="flex-row justify-between"><View><Text className="font-bold">{String(row.client_nom)}</Text><Text className="mt-1 text-xs text-secondary">{dateOnly(row.created_at)}</Text></View><View className="items-end"><Text className="font-bold">{money(row.montant)}</Text><Pill tone={row.type==='PAIEMENT'?'green':'red'}>{String(row.type)}</Pill></View></View>}</View>)}</Card>}
    <Button action="negative" variant="outline" className="mt-6" onPress={()=>void signOut()}><ButtonText>Se déconnecter</ButtonText></Button>
  </Screen>
}


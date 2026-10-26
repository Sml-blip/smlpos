import { useMemo, useState } from 'react'
import { FlatList, Modal, Pressable, Text, TextInput, View } from 'react-native'
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera'
import * as Haptics from 'expo-haptics'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ScanBarcode, Search, X } from 'lucide-react-native'
import { EmptyState, ErrorState, LoadingState, PageTitle, Pill } from '@/components/ui'
import { useRows } from '@/hooks/useRows'
import { findProductByBarcode, type Row } from '@/lib/data'
import { money } from '@/lib/format'
import { errorMessage } from '@/lib/format'
import { colors } from '@/theme/tokens'

export default function InventoryScreen() {
  const data = useRows('produits', { limit: 2000, order: 'nom', ascending: true, filters: { actif: 1 } })
  const [search, setSearch] = useState('')
  const [scanner, setScanner] = useState(false)
  const [permission, requestPermission] = useCameraPermissions()
  const [scanLocked, setScanLocked] = useState(false)
  const [scannedProduct, setScannedProduct] = useState<Row | null | undefined>(undefined)
  const [scanError, setScanError] = useState('')
  const [cameraReady, setCameraReady] = useState(false)
  const insets = useSafeAreaInsets()
  const rows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('fr')
    if (!query) return data.rows
    return data.rows.filter(p => [p.nom, p.reference, p.code_barre].some(v => String(v ?? '').toLocaleLowerCase('fr').includes(query)))
  }, [data.rows, search])
  const openScanner = async () => {
    if (!permission?.granted) {
      const granted = await requestPermission()
      if (!granted.granted) return
    }
    setScanLocked(false); setScannedProduct(undefined); setScanError(''); setCameraReady(false); setScanner(true)
  }
  const scanned = async ({ data: code }: BarcodeScanningResult) => {
    if (scanLocked) return
    setScanLocked(true)
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    try { setScannedProduct(await findProductByBarcode(code)) }
    catch (cause) { setScanError(errorMessage(cause)) }
  }
  const header = <View><PageTitle title="Inventaire" subtitle={`${data.rows.length} produit(s) synchronisé(s)`} action={<Pressable onPress={()=>void openScanner()} className="h-12 w-12 items-center justify-center rounded-2xl bg-brand"><ScanBarcode size={24} color={colors.ink}/></Pressable>}/><View className="mb-4 flex-row items-center rounded-2xl border border-line bg-white px-3"><Search size={17} color={colors.subtle}/><TextInput value={search} onChangeText={setSearch} placeholder="Nom, référence ou code-barres…" className="h-12 flex-1 px-3 text-ink"/></View></View>
  return <View className="flex-1 bg-canvas">
    {data.loading ? <View style={{ paddingTop: insets.top + 20 }}><LoadingState/></View> : data.error ? <View className="px-4" style={{ paddingTop: insets.top + 20 }}><ErrorState message={data.error} retry={data.refresh}/></View> : <FlatList
      data={rows}
      keyExtractor={row => String(row.id)}
      initialNumToRender={18}
      maxToRenderPerBatch={16}
      windowSize={7}
      removeClippedSubviews
      refreshing={data.loading}
      onRefresh={data.refresh}
      contentContainerStyle={{ paddingTop: Math.max(insets.top, 12) + 10, paddingHorizontal: 16, paddingBottom: 110 }}
      ListHeaderComponent={header}
      ListEmptyComponent={<EmptyState label="Aucun produit trouvé"/>}
      renderItem={({ item: row }) => <View className="flex-row items-center justify-between border-b border-line bg-white px-4 py-3"><View className="flex-1 pr-3"><Text className="font-bold text-ink">{String(row.nom)}</Text><Text className="mt-1 text-xs text-secondary">{String(row.reference)} · {String(row.code_barre ?? 'Sans code')}</Text><Text className="mt-1 text-xs text-subtle">{money(row.prix_vente)}</Text></View><View className="items-end"><Text className={`text-lg font-extrabold ${Number(row.stock_actuel) <= Number(row.stock_minimum) ? 'text-danger' : 'text-success'}`}>{String(row.stock_actuel)}</Text><Pill tone={row.type === 'NF' ? 'red' : 'green'}>{String(row.type)}</Pill></View></View>}
    />}
    <Modal visible={scanner} animationType="slide" presentationStyle="fullScreen" onRequestClose={()=>setScanner(false)}><View style={{ flex: 1, backgroundColor: '#000' }}><CameraView style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} facing="back" active={scanner} onCameraReady={()=>setCameraReady(true)} barcodeScannerSettings={{ barcodeTypes: ['ean13','ean8','code128','code39','upc_a','upc_e','qr'] }} onBarcodeScanned={scanLocked ? undefined : scanned}/>
      <View className="absolute inset-0 items-center justify-center"><View className="h-52 w-[85%] rounded-3xl border-2 border-brand"/><Text className="mt-5 rounded-full bg-black/70 px-4 py-2 text-sm font-bold text-white">Cadrez le code-barres</Text></View>
      {!cameraReady ? <View className="absolute inset-0 items-center justify-center bg-black"><LoadingState/><Text className="text-white">Initialisation de la caméra…</Text></View> : null}
      <Pressable onPress={()=>setScanner(false)} className="absolute right-5 top-14 h-12 w-12 items-center justify-center rounded-full bg-black/70"><X size={24} color="white"/></Pressable>
      {scanLocked ? <View className="absolute bottom-10 left-5 right-5 rounded-3xl bg-white p-5">{scanError ? <Text className="text-danger">{scanError}</Text> : scannedProduct === null ? <><Text className="text-lg font-extrabold">Produit introuvable</Text><Text className="mt-1 text-secondary">Ce code-barres n’existe pas dans SMLPOS.</Text></> : scannedProduct ? <><Text className="text-xs font-bold uppercase text-brand-dark">Produit trouvé</Text><Text className="mt-1 text-xl font-extrabold text-ink">{String(scannedProduct.nom)}</Text><Text className="mt-2 text-secondary">{String(scannedProduct.reference)} · Stock: {String(scannedProduct.stock_actuel)}</Text><Text className="mt-2 text-lg font-bold">{money(scannedProduct.prix_vente)}</Text></> : <Text>Recherche…</Text>}<View className="mt-4 flex-row gap-2"><Pressable onPress={()=>{setScanLocked(false);setScannedProduct(undefined);setScanError('')}} className="flex-1 rounded-xl bg-brand py-3"><Text className="text-center font-bold text-ink">Scanner encore</Text></Pressable><Pressable onPress={()=>setScanner(false)} className="rounded-xl bg-muted px-5 py-3"><Text className="font-bold">Fermer</Text></Pressable></View></View> : null}
    </View></Modal>
  </View>
}


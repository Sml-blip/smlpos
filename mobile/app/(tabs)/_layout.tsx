import { Tabs } from 'expo-router'
import { useWindowDimensions } from 'react-native'
import { BarChart3, Boxes, FileText, LayoutGrid, Menu } from 'lucide-react-native'
import { colors } from '@/theme/tokens'
import * as Haptics from 'expo-haptics'

export default function TabsLayout() {
  const { width } = useWindowDimensions()
  const tablet = width >= 768
  const icon = (Icon: typeof BarChart3) => ({ color, size }: { color: string; size: number }) => <Icon color={color} size={size}/>
  return <Tabs screenOptions={{
    headerShown: false,
    tabBarPosition: tablet ? 'left' : 'bottom',
    tabBarActiveTintColor: colors.ink,
    tabBarInactiveTintColor: colors.subtle,
    tabBarActiveBackgroundColor: colors.brandSoft,
    tabBarStyle: tablet ? { width: 220, paddingTop: 24, borderRightColor: colors.line, backgroundColor: colors.surface } : { height: 70, paddingBottom: 8, paddingTop: 7, borderTopColor: colors.line, backgroundColor: colors.surface },
    tabBarItemStyle: tablet ? { height: 58, marginHorizontal: 10, borderRadius: 14 } : undefined,
    tabBarLabelStyle: { fontWeight: '700', fontSize: tablet ? 13 : 10 },
  }} screenListeners={{ tabPress: () => { void Haptics.selectionAsync() } }}>
    <Tabs.Screen name="index" options={{ title: 'Accueil', tabBarIcon: icon(BarChart3) }}/>
    <Tabs.Screen name="activity" options={{ title: 'Activité', tabBarIcon: icon(LayoutGrid) }}/>
    <Tabs.Screen name="inventory" options={{ title: 'Inventaire', tabBarIcon: icon(Boxes) }}/>
    <Tabs.Screen name="documents" options={{ title: 'Documents', tabBarIcon: icon(FileText) }}/>
    <Tabs.Screen name="more" options={{ title: 'Plus', tabBarIcon: icon(Menu) }}/>
  </Tabs>
}


import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { AlertCircle, Cloud, CloudOff } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors } from '@/theme/tokens'
import Animated, { FadeInDown } from 'react-native-reanimated'

export function Screen({ children, refreshing = false, onRefresh }: { children: ReactNode; refreshing?: boolean; onRefresh?: () => void }) {
  const insets = useSafeAreaInsets()
  return <ScrollView className="flex-1 bg-canvas" contentContainerClassName="px-4 pb-28 tablet:px-6" contentContainerStyle={{ paddingTop: Math.max(insets.top, 12) + 10 }} refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandDark} progressViewOffset={insets.top} /> : undefined}>{children}</ScrollView>
}

export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <View className="mb-5 flex-row items-center justify-between"><View className="flex-1"><Text className="text-2xl font-extrabold text-ink">{title}</Text>{subtitle ? <Text className="mt-1 text-sm text-secondary">{subtitle}</Text> : null}</View>{action}</View>
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <View className={`rounded-card border border-line bg-surface p-4 ${className}`}>{children}</View>
}

export function MetricCard({ label, value, hint, tone = 'brand' }: { label: string; value: string; hint?: string; tone?: 'brand'|'green'|'blue'|'red' }) {
  const bg = tone === 'green' ? 'bg-green-50 border-green-200' : tone === 'blue' ? 'bg-blue-50 border-blue-200' : tone === 'red' ? 'bg-red-50 border-red-200' : 'bg-brand-soft border-yellow-200'
  return <Animated.View entering={FadeInDown.duration(350)} className={`min-w-[155px] flex-1 rounded-card border p-4 ${bg}`}><Text className="text-xs font-semibold uppercase tracking-wide text-secondary">{label}</Text><Text className="mt-2 text-2xl font-extrabold text-ink">{value}</Text>{hint ? <Text className="mt-1 text-xs text-secondary">{hint}</Text> : null}</Animated.View>
}

export function StatusBadge({ online, label }: { online: boolean; label?: string }) {
  return <View className={`flex-row items-center gap-1 rounded-full px-2.5 py-1 ${online ? 'bg-green-100' : 'bg-red-100'}`}>{online ? <Cloud size={12} color={colors.success}/> : <CloudOff size={12} color={colors.danger}/>}<Text className={`text-[11px] font-bold ${online ? 'text-green-800' : 'text-red-800'}`}>{label ?? (online ? 'Synchronisé' : 'Hors ligne')}</Text></View>
}

export function LoadingState() {
  return <View className="items-center py-16"><ActivityIndicator color={colors.brandDark}/><Text className="mt-3 text-sm text-secondary">Chargement des données…</Text></View>
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return <View className="items-center rounded-card border border-red-200 bg-red-50 p-6"><AlertCircle size={28} color={colors.danger}/><Text className="mt-2 text-center text-sm text-red-800">{message}</Text>{retry ? <Pressable onPress={retry} className="mt-4 rounded-xl bg-danger px-4 py-2"><Text className="font-bold text-white">Réessayer</Text></Pressable> : null}</View>
}

export function EmptyState({ label }: { label: string }) {
  return <View className="items-center py-12"><Text className="text-sm text-subtle">{label}</Text></View>
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral'|'green'|'red'|'yellow'|'blue' }) {
  const style = tone === 'green' ? 'bg-green-100 text-green-800' : tone === 'red' ? 'bg-red-100 text-red-800' : tone === 'yellow' ? 'bg-yellow-100 text-yellow-800' : tone === 'blue' ? 'bg-blue-100 text-blue-800' : 'bg-muted text-secondary'
  return <View className={`rounded-full px-2.5 py-1 ${style.split(' ')[0]}`}><Text className={`text-[11px] font-bold ${style.split(' ')[1]}`}>{children}</Text></View>
}


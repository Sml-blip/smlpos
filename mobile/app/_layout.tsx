import '../global.css'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Image, View } from 'react-native'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GluestackUIProvider } from '@gluestack-ui/themed'
import { config } from '@gluestack-ui/config'
import { AuthProvider, useAuth } from '@/providers/AuthProvider'
import { colors } from '@/theme/tokens'
import Animated, { FadeIn, FadeInDown, FadeOut, ZoomIn } from 'react-native-reanimated'

function BrandSplash({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 1650)
    return () => clearTimeout(timer)
  }, [onDone])
  return <Animated.View exiting={FadeOut.duration(300)} className="absolute inset-0 z-50 items-center justify-center bg-ink">
    <Animated.View entering={ZoomIn.springify().damping(13)} className="h-28 w-28 items-center justify-center rounded-[32px] bg-brand">
      <Image source={require('../assets/icon.png')} className="h-24 w-24" resizeMode="contain"/>
    </Animated.View>
    <Animated.Text entering={FadeInDown.delay(250).duration(450)} className="mt-6 text-3xl font-black tracking-[3px] text-white">SMLBOSS</Animated.Text>
    <Animated.Text entering={FadeIn.delay(500)} className="mt-2 text-sm font-semibold text-white/60">Votre activité. Maintenant.</Animated.Text>
    <View className="absolute bottom-16 h-1 w-20 overflow-hidden rounded-full bg-white/15"><Animated.View entering={FadeIn.delay(650)} className="h-full w-16 rounded-full bg-brand"/></View>
  </Animated.View>
}

function Gate() {
  const { unlocked, loading } = useAuth()
  const segments = useSegments()
  const router = useRouter()
  useEffect(() => {
    if (loading) return
    const onLogin = segments[0] === 'login'
    if (!unlocked && !onLogin) router.replace('/login')
    if (unlocked && onLogin) router.replace('/(tabs)')
  }, [unlocked, loading, segments, router])
  if (loading) return <View className="flex-1 items-center justify-center bg-canvas"><ActivityIndicator color={colors.brandDark}/></View>
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }} />
}

export default function RootLayout() {
  const [showSplash, setShowSplash] = useState(true)
  return <GluestackUIProvider config={config}><AuthProvider><StatusBar style="dark"/><Gate/>{showSplash ? <BrandSplash onDone={() => setShowSplash(false)}/> : null}</AuthProvider></GluestackUIProvider>
}


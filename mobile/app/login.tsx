import { useState } from 'react'
import { Image, KeyboardAvoidingView, Platform, Text, View } from 'react-native'
import { Button, ButtonText, Input, InputField } from '@gluestack-ui/themed'
import { useAuth } from '@/providers/AuthProvider'
import * as Haptics from 'expo-haptics'

export default function LoginScreen() {
  const { signIn } = useAuth()
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const submit = async () => {
    setLoading(true)
    const result = await signIn(pin)
    setError(result ?? '')
    await Haptics.notificationAsync(result ? Haptics.NotificationFeedbackType.Error : Haptics.NotificationFeedbackType.Success)
    setLoading(false)
  }
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 items-center justify-center bg-canvas p-6"><View className="w-full max-w-md rounded-[28px] border border-line bg-white p-6 shadow-sm">
    <View className="items-center"><Image source={require('../assets/icon.png')} className="h-24 w-24" resizeMode="contain"/><Text className="mt-4 text-2xl font-extrabold text-ink">SMLBOSS</Text><Text className="mt-1 text-center text-sm text-secondary">Suivi sécurisé et lecture seule de votre activité</Text></View>
    {error ? <Text className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</Text> : null}
    <View className="mt-6 gap-3"><Input size="lg"><InputField autoFocus secureTextEntry keyboardType="number-pad" maxLength={8} value={pin} onChangeText={value => setPin(value.replace(/\D/g, ''))} placeholder="Code PIN à 8 chiffres" onSubmitEditing={() => void submit()}/></Input>
      <Button action="primary" size="lg" onPress={() => void submit()} isDisabled={loading} style={{ backgroundColor: '#FFD600' }}><ButtonText style={{ color: '#1A1A1A' }}>{loading ? 'Connexion…' : 'Se connecter'}</ButtonText></Button>
    </View><Text className="mt-5 text-center text-xs text-subtle">Accès responsable local · application en lecture seule</Text>
  </View></KeyboardAvoidingView>
}


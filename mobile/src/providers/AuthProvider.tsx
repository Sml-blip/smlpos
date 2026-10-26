import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

type AuthValue = {
  unlocked: boolean
  loading: boolean
  signIn: (pin: string) => Promise<string | null>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)
const SESSION_KEY = 'smlpos_boss_unlocked'
const BOSS_PIN = '11223344'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(false)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    void AsyncStorage.getItem(SESSION_KEY).then(value => {
      setUnlocked(value === '1')
      setLoading(false)
    })
  }, [])
  const value = useMemo<AuthValue>(() => ({
    unlocked,
    loading,
    signIn: async pin => {
      if (pin !== BOSS_PIN) return 'Code PIN incorrect'
      await AsyncStorage.setItem(SESSION_KEY, '1')
      setUnlocked(true)
      return null
    },
    signOut: async () => {
      await AsyncStorage.removeItem(SESSION_KEY)
      setUnlocked(false)
    },
  }), [unlocked, loading])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('AuthProvider manquant')
  return value
}


import { createClient } from '@supabase/supabase-js'
import Constants from 'expo-constants'
import { Platform } from 'react-native'
import { universalStorage } from './storage'

function resolveHost(url: string): string {
  // Si estamos en un dispositivo nativo o Expo Go y la URL tiene localhost/127.0.0.1,
  // la reemplazamos por la IP de desarrollo de la laptop conectada al celular
  if (Platform.OS !== 'web') {
    const hostUri = Constants.expoConfig?.hostUri
    if (hostUri) {
      const ip = hostUri.split(':')[0]
      return url.replace('127.0.0.1', ip).replace('localhost', ip)
    }
    return url.replace('127.0.0.1', '10.0.0.154').replace('localhost', '10.0.0.154')
  }
  return url
}

const rawSupabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'http://10.0.0.154:54321'

const supabaseUrl = resolveHost(rawSupabaseUrl)

const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: universalStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})

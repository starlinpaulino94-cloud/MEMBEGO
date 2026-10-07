import { createClient } from '@supabase/supabase-js'
import Constants from 'expo-constants'
import { Platform } from 'react-native'
import { universalStorage } from './storage'
import {
  RuntimeUrlConfigurationError,
  resolveSupabaseUrl,
} from './runtimeUrls'

const rawSupabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL

const supabaseUrl = resolveSupabaseUrl({
  configuredUrl: rawSupabaseUrl,
  platform: Platform.OS === 'web' ? 'web' : 'native',
  hostUri: Constants.expoConfig?.hostUri,
  nativeHost: process.env.EXPO_PUBLIC_DEVICE_HOST,
})

const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseAnonKey?.trim()) {
  throw new RuntimeUrlConfigurationError(
    'Missing EXPO_PUBLIC_SUPABASE_ANON_KEY. Configure the public Supabase key before starting the client.'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: universalStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})

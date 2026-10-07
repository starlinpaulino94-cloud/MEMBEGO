import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'

/**
 * Adaptador de almacenamiento universal para sesiones y caché.
 * En plataformas nativas (iOS/Android) utiliza SecureStore cifrado por hardware.
 * En Web utiliza localStorage de forma segura con verificación SSR.
 */
export const universalStorage = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          return window.localStorage.getItem(key)
        }
      } catch (error) {
        console.warn('[universalStorage] Error leyendo de localStorage:', error)
      }
      return null
    }
    try {
      return await SecureStore.getItemAsync(key)
    } catch (error) {
      console.warn('[universalStorage] Error leyendo de SecureStore:', error)
      return null
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(key, value)
        }
      } catch (error) {
        console.warn('[universalStorage] Error escribiendo en localStorage:', error)
      }
      return
    }
    try {
      await SecureStore.setItemAsync(key, value)
    } catch (error) {
      console.warn('[universalStorage] Error escribiendo en SecureStore:', error)
    }
  },

  async removeItem(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.removeItem(key)
        }
      } catch (error) {
        console.warn('[universalStorage] Error eliminando de localStorage:', error)
      }
      return
    }
    try {
      await SecureStore.deleteItemAsync(key)
    } catch (error) {
      console.warn('[universalStorage] Error eliminando de SecureStore:', error)
    }
  },
}

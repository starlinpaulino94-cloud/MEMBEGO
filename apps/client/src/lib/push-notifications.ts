import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { api } from './api'

const PUSH_TOKEN_KEY = 'membego.expoPushToken'

export interface PushPermissionState {
  readonly granted: boolean
  readonly canAskAgain: boolean
}

export type PushActivationResult = 'enabled' | 'denied' | 'unsupported'

function nativePlatform(): 'ANDROID' | 'IOS' | null {
  if (Platform.OS === 'android') return 'ANDROID'
  if (Platform.OS === 'ios') return 'IOS'
  return null
}

async function prepareAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Notificaciones',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#7C3AED',
  })
}

async function registerCurrentDevice(): Promise<void> {
  const platform = nativePlatform()
  if (!platform) return

  await prepareAndroidChannel()
  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId
  if (typeof projectId !== 'string' || projectId.length === 0) {
    throw new Error('No se encontró el ID del proyecto EAS.')
  }

  const result = await Notifications.getExpoPushTokenAsync({ projectId })
  const previousToken = await SecureStore.getItemAsync(PUSH_TOKEN_KEY)
  await api.registrarPushToken(result.data, platform)
  await SecureStore.setItemAsync(PUSH_TOKEN_KEY, result.data)

  if (previousToken && previousToken !== result.data) {
    await api.eliminarPushToken(previousToken).catch(() => {
      console.warn('[push] No se pudo retirar el token anterior del dispositivo.')
    })
  }
}

export async function getPushPermissionState(): Promise<PushPermissionState | null> {
  if (!nativePlatform()) return null
  const permission = await Notifications.getPermissionsAsync()
  return { granted: permission.granted, canAskAgain: permission.canAskAgain }
}

export async function activatePushNotifications(): Promise<PushActivationResult> {
  if (!nativePlatform()) return 'unsupported'
  await prepareAndroidChannel()

  const current = await Notifications.getPermissionsAsync()
  const permission = current.granted ? current : await Notifications.requestPermissionsAsync()
  if (!permission.granted) return 'denied'

  await registerCurrentDevice()
  return 'enabled'
}

export async function syncPushTokenIfGranted(): Promise<void> {
  if (!nativePlatform()) return
  const permission = await Notifications.getPermissionsAsync()
  if (!permission.granted) return
  await registerCurrentDevice()
}

export async function unregisterPushToken(): Promise<void> {
  if (!nativePlatform()) return
  const token = await SecureStore.getItemAsync(PUSH_TOKEN_KEY)
  if (!token) return
  await api.eliminarPushToken(token)
  await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY)
}

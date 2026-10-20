import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Modal } from 'react-native'
import * as Location from 'expo-location'
import * as Notifications from 'expo-notifications'
import { NativePermissionsWizard } from './NativePermissionsWizard'
import { useAuth } from '../../lib/auth-context'
import { universalStorage } from '../../lib/storage'

interface WizardContextValue {
  readonly openWizard: () => void
}

interface ProviderProps {
  readonly children: React.ReactNode
}

const PermissionWizardContext = createContext<WizardContextValue>({ openWizard: () => undefined })
const STORAGE_KEY_PREFIX = 'membego.nativePermissionsWizard.v1.'

export function useNativePermissionsWizard(): WizardContextValue {
  return useContext(PermissionWizardContext)
}

export function NativePermissionsWizardProvider({ children }: ProviderProps) {
  const { user, isCliente, isLoading } = useAuth()
  const [visible, setVisible] = useState(false)
  const [session, setSession] = useState(0)
  const checkedUserId = useRef<string | null>(null)
  const userId = user?.id ?? null

  useEffect(() => {
    if (isLoading) return
    if (!userId || !isCliente) {
      checkedUserId.current = null
      setVisible(false)
      return
    }
    if (checkedUserId.current === userId) return
    checkedUserId.current = userId

    let cancelled = false
    async function checkFirstRun() {
      const storageKey = STORAGE_KEY_PREFIX + userId
      const [completed, location, notifications] = await Promise.all([
        universalStorage.getItem(storageKey),
        Location.getForegroundPermissionsAsync(),
        Notifications.getPermissionsAsync(),
      ])
      if (cancelled || completed === 'done') return
      if (location.granted && notifications.granted) {
        await universalStorage.setItem(storageKey, 'done')
        return
      }
      setSession((current) => current + 1)
      setVisible(true)
    }

    void checkFirstRun().catch((error: unknown) => {
      if (error instanceof Error) console.warn('[permissions] No se pudo revisar el estado inicial.')
      if (!cancelled) {
        setSession((current) => current + 1)
        setVisible(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [isCliente, isLoading, userId])

  const openWizard = useCallback(() => {
    if (!userId || !isCliente) return
    setSession((current) => current + 1)
    setVisible(true)
  }, [isCliente, userId])

  const finishWizard = useCallback(async () => {
    if (userId) {
      await universalStorage.setItem(STORAGE_KEY_PREFIX + userId, 'done')
    }
    setVisible(false)
  }, [userId])

  return (
    <PermissionWizardContext.Provider value={{ openWizard }}>
      {children}
      {visible ? (
        <Modal
          visible
          animationType="slide"
          presentationStyle="fullScreen"
          onRequestClose={() => void finishWizard()}
        >
          <NativePermissionsWizard key={session} onFinish={() => void finishWizard()} />
        </Modal>
      ) : null}
    </PermissionWizardContext.Provider>
  )
}

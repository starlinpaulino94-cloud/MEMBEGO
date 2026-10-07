import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, View, useWindowDimensions } from 'react-native'
import { Stack, usePathname, useRouter } from 'expo-router'
import { HeaderVibe } from './HeaderVibe'
import { TabsEscritorio } from './TabsEscritorio'
import { BottomTabDock } from './BottomTabDock'
import { useAuth } from '../../lib/auth-context'
import {
  getClientRoutePresentation,
  isClientDetailRoute,
  requiresClientAuthentication,
} from '../../lib/client-route-presentation'
import { colors } from '../../theme/tokens'
import { InicioAccentProvider } from './InicioAccentContext'

const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/establecer-contrasena',
  '/bienvenida',
  '/bienvenida-ref',
  '/registro',
  '/eliminar-cuenta',
] as const

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

export function ClientShell() {
  const { width } = useWindowDimensions()
  const pathname = usePathname()
  const previousPathRef = useRef(pathname)
  const [sheetBackgroundPath, setSheetBackgroundPath] = useState<string | null>(null)
  const router = useRouter()
  const { isLoading, isAuthenticated } = useAuth()
  const isDesktop = width >= 1024
  const isDetailSheet = width >= 768 && router.canGoBack() && isClientDetailRoute(pathname)
  const shellPathname = isDetailSheet ? sheetBackgroundPath ?? pathname : pathname
  const showcaseIsPublic = __DEV__ && pathname === '/dev-cardnet-capture-showcase'
  const requiresAuth = !showcaseIsPublic && requiresClientAuthentication(pathname)

  useEffect(() => {
    if (previousPathRef.current === pathname) return
    const previousPath = previousPathRef.current
    if (!isClientDetailRoute(pathname)) {
      setSheetBackgroundPath(pathname)
    } else if (!isClientDetailRoute(previousPath)) {
      setSheetBackgroundPath(previousPath)
    }
    previousPathRef.current = pathname
  }, [pathname])

  const showNavigation =
    !isLoading &&
    isAuthenticated &&
    !isPublicPath(pathname) &&
    pathname !== '/' &&
    getClientRoutePresentation(shellPathname) === 'navigation'
  const isInicio = shellPathname.endsWith('/inicio')

  useEffect(() => {
    if (!requiresAuth || isLoading || isAuthenticated) return
    router.replace('/login')
  }, [isAuthenticated, isLoading, requiresAuth, router])

  if (requiresAuth && (isLoading || !isAuthenticated)) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" color={colors.vibe.violet} />
      </View>
    )
  }

  return (
    <InicioAccentProvider active={isInicio}>
      <View className="flex-1 bg-vibe-fondo">
        {showNavigation && <HeaderVibe />}
        {showNavigation && isDesktop && <TabsEscritorio />}

        <View
          className={
            showNavigation
              ? 'flex-1 w-full self-center md:px-2 lg:max-w-7xl lg:px-2'
              : 'flex-1 w-full'
          }
        >
          <Stack screenOptions={{ headerShown: false }} />
        </View>

        {showNavigation && !isDesktop && <BottomTabDock />}
      </View>
    </InicioAccentProvider>
  )
}

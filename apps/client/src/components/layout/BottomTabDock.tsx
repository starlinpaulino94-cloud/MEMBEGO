import React from 'react'
import { View, Text, TouchableOpacity } from 'react-native'
import { useRouter, usePathname } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Home, User, QrCode, Menu } from 'lucide-react-native'

interface DestinoTab {
  readonly href: string
  readonly label: string
  readonly icon: typeof Home
  /** Prefijos extra que también marcan este destino como activo. */
  readonly match?: readonly string[]
}

/**
 * LOS CUATRO DESTINOS DEL CLIENTE — espejo de `destinos-cliente.ts` del web.
 * Mismo orden, mismos labels, misma lógica de subrutas activas.
 */
const DESTINOS: readonly DestinoTab[] = [
  { href: '/(tabs)/inicio', label: 'Inicio', icon: Home },
  {
    href: '/(tabs)/cuenta',
    label: 'Cuenta',
    icon: User,
    match: ['pagos', 'historial', 'ayuda', 'empresas', 'vehiculos', 'intereses'],
  },
  {
    href: '/(tabs)/qr',
    label: 'Mi QR',
    icon: QrCode,
    match: ['membresia', 'mis-membresias', 'mis-promociones'],
  },
  { href: '/(tabs)/menu', label: 'Menú', icon: Menu },
]

/** Una ruta activa el destino si es él o contiene alguno de sus prefijos. */
function esDestinoActivo(pathname: string, destino: DestinoTab): boolean {
  if (pathname === destino.href || pathname.startsWith(destino.href + '/')) {
    return true
  }
  return (destino.match ?? []).some((prefix) => pathname.includes(prefix))
}

export function BottomTabDock() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const pathname = usePathname()

  return (
    <View
      style={{ paddingBottom: Math.max(insets.bottom, 8) }}
      className="border-t border-border/70 bg-card/95 backdrop-blur-md px-2 pt-2"
    >
      <View className="flex-row items-center justify-around">
        {DESTINOS.map((tab) => {
          const isActive = esDestinoActivo(pathname, tab)
          const Icon = tab.icon

          return (
            <TouchableOpacity
              key={tab.href}
              onPress={() => router.push(tab.href as any)}
              activeOpacity={0.7}
              className="flex-1 items-center justify-center min-h-14 py-1.5"
            >
              <View
                className={`h-7 w-12 items-center justify-center rounded-full mb-1 ${
                  isActive ? 'bg-primary/12' : 'bg-transparent'
                }`}
              >
                <Icon
                  size={20}
                  color={isActive ? '#0284c7' : '#71717a'}
                  strokeWidth={isActive ? 2.4 : 2}
                  style={{ transform: isActive ? [{ scale: 1.1 }] : undefined }}
                />
              </View>
              <Text
                className={`text-[12px] text-center ${
                  isActive
                    ? 'text-primary font-inter-semibold'
                    : 'text-muted-foreground font-inter-medium'
                }`}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>
    </View>
  )
}

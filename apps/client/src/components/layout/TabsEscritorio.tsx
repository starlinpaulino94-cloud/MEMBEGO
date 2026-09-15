import React from 'react'
import { View, Text, TouchableOpacity } from 'react-native'
import { useRouter, usePathname } from 'expo-router'

interface DestinoTab {
  readonly href: string
  readonly label: string
  readonly match?: readonly string[]
}

const DESTINOS: readonly DestinoTab[] = [
  { href: '/(tabs)/inicio', label: 'Inicio' },
  {
    href: '/(tabs)/cuenta',
    label: 'Cuenta',
    match: ['pagos', 'historial', 'ayuda', 'empresas', 'vehiculos', 'intereses'],
  },
  {
    href: '/(tabs)/qr',
    label: 'Mi QR',
    match: ['membresia', 'mis-membresias', 'mis-promociones'],
  },
  { href: '/(tabs)/menu', label: 'Menú' },
]

function esDestinoActivo(pathname: string, destino: DestinoTab): boolean {
  if (pathname === destino.href || pathname.startsWith(destino.href + '/')) {
    return true
  }
  return (destino.match ?? []).some((prefix) => pathname.includes(prefix))
}

export function TabsEscritorio() {
  const router = useRouter()
  const pathname = usePathname()

  return (
    <View className="border-b border-border bg-card">
      <View className="flex-row items-center gap-1 max-w-4xl w-full px-6">
        {DESTINOS.map((tab) => {
          const isActive = esDestinoActivo(pathname, tab)

          return (
            <TouchableOpacity
              key={tab.href}
              onPress={() => router.push(tab.href as any)}
              activeOpacity={0.7}
              className={`px-4 py-3 border-b-2 ${
                isActive
                  ? 'border-primary'
                  : 'border-transparent'
              }`}
            >
              <Text
                className={`text-sm font-inter-semibold ${
                  isActive ? 'text-primary' : 'text-muted-foreground'
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

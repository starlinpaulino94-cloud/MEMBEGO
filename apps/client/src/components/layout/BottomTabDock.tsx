import React from 'react'
import { View, Text, TouchableOpacity } from 'react-native'
import { useRouter, usePathname } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Home, User, QrCode, Sparkles, Menu } from 'lucide-react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { colors } from '../../theme/tokens'
import { useInicioAccent, withAccentOpacity } from './InicioAccentContext'
import {
  DESTINOS_CLIENTE_NATIVE,
  esDestinoClienteActivo,
} from './destinos-cliente'
import type { DestinoClienteNative } from './destinos-cliente'

const ICONOS: Readonly<Record<DestinoClienteNative['id'], typeof Home>> = {
  inicio: Home,
  cuenta: User,
  qr: QrCode,
  beneficios: Sparkles,
  menu: Menu,
} as const

export function BottomTabDock() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const pathname = usePathname()
  const { accent } = useInicioAccent()

  return (
    <View
      testID="client-dock"
      style={{ paddingBottom: Math.max(insets.bottom, 8), overflow: 'visible' }}
      className="border-t border-border/70 bg-card/95 backdrop-blur-md px-2 pt-2"
    >
      <View className="flex-row items-center justify-around" style={{ overflow: 'visible' }}>
        {DESTINOS_CLIENTE_NATIVE.map((tab) => {
          const isActive = esDestinoClienteActivo(pathname, tab)
          const Icon = ICONOS[tab.id]
          const isQr = tab.id === 'qr'
          const iconColor = isQr
            ? colors.surface.background
            : isActive
              ? accent.color
              : colors.surface.mutedForeground

          return (
            <TouchableOpacity
              key={tab.href}
              onPress={() => router.push(tab.href)}
              activeOpacity={0.7}
              hitSlop={isQr ? { top: 24, bottom: 8, left: 8, right: 8 } : undefined}
              className="flex-1 items-center justify-center min-h-14 py-1.5"
              style={{ overflow: 'visible' }}
            >
              {isQr ? (
                <View className="relative mb-1 h-7 w-12 items-center justify-center" style={{ overflow: 'visible' }}>
                  <View style={{ position: 'absolute', bottom: 6, alignItems: 'center', justifyContent: 'center' }}>
                    <LinearGradient
                      colors={accent.gradient}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={{
                        borderRadius: 999,
                        width: 52,
                        height: 52,
                        alignItems: 'center',
                        justifyContent: 'center',
                        shadowColor: accent.shadow,
                        shadowOffset: { width: 0, height: 4 },
                        shadowOpacity: 0.28,
                        shadowRadius: 8,
                        elevation: 6,
                      }}
                    >
                      <Icon size={22} color={iconColor} strokeWidth={2.4} />
                    </LinearGradient>
                  </View>
                </View>
              ) : (
                <View
                  className="mb-1 h-7 w-12 items-center justify-center rounded-full"
                // style={{ backgroundColor: isActive ? withAccentOpacity(accent.color, 0.12) : 'transparent' }}
                >
                  <Icon
                    size={20}
                    color={iconColor}
                    strokeWidth={isActive ? 2.4 : 2}
                    style={{ transform: [{ scale: isActive ? 1.1 : 1 }] }}
                  />
                </View>
              )}
              <Text
                className={`text-label-sm text-center ${isActive ? 'font-inter-semibold' : 'text-muted-foreground font-inter-medium'}`}
                style={isActive ? { color: accent.color } : undefined}
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

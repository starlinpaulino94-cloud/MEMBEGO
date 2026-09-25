import React from 'react'
import { View, Text, TouchableOpacity } from 'react-native'
import { useRouter, usePathname } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import { QrCode } from 'lucide-react-native'
import {
  DESTINOS_CLIENTE_NATIVE,
  esDestinoClienteActivo,
} from './destinos-cliente'
import { colors } from '../../theme/tokens'
import { useInicioAccent } from './InicioAccentContext'

export function TabsEscritorio() {
  const router = useRouter()
  const pathname = usePathname()
  const { accent } = useInicioAccent()

  return (
    <View testID="client-tabs" className="border-b border-border bg-card">
      <View className="flex-row items-center gap-1 max-w-7xl w-full px-4 md:px-6 self-center">
        {DESTINOS_CLIENTE_NATIVE.map((tab) => {
          const isActive = esDestinoClienteActivo(pathname, tab)
          const isQr = tab.id === 'qr'

          return (
            <TouchableOpacity
              key={tab.href}
              onPress={() => router.push(tab.href)}
              activeOpacity={0.7}
              testID={`client-tab-${tab.id}`}
              className={isQr ? 'my-1 rounded-full' : `px-4 py-3 border-b-2 ${isActive
                ? 'border-primary'
                : 'border-transparent'
                }`}
              style={!isQr && isActive ? { borderBottomColor: accent.color } : undefined}
            >
              {isQr ? (
                <LinearGradient
                  colors={accent.gradient}
                  locations={accent.gradient.length === 4 ? [0, 0.35, 0.7, 1] : [0, 1]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  className="flex-row items-center gap-2 rounded-full px-4 py-2 shadow-lg"
                  style={{ borderRadius: 9999, shadowColor: accent.shadow, shadowOpacity: 0.24, shadowRadius: 6, elevation: 3, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}
                >
                  <QrCode size={16} color={colors.surface.background} />
                  <Text className="text-sm font-inter-semibold text-white">{tab.label}</Text>
                </LinearGradient>
              ) : (
                <Text
                    className={`text-sm font-inter-semibold ${isActive ? '' : 'text-muted-foreground'
                    }`}
                    style={isActive ? { color: accent.color } : undefined}
                >
                  {tab.label}
                </Text>
              )}
            </TouchableOpacity>
          )
        })}
      </View>
    </View>
  )
}

import React from 'react'
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native'
import { useRouter } from 'expo-router'
import { Settings, LogOut } from 'lucide-react-native'
import { usePerfil } from '../../src/hooks/usePerfil'
import { useAuth } from '../../src/lib/auth-context'
import { Button } from '../../src/components/ui/Button'

export default function CuentaScreen() {
  const router = useRouter()
  const { user, isAuthenticated, signOut } = useAuth()
  const { data, isLoading } = usePerfil(isAuthenticated)

  // ── Auth gate ──────────────────────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <View className="flex-1 items-center justify-center bg-vibe-fondo p-6">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-brand-primary-soft mb-4">
          <Settings size={32} color="#0284c7" />
        </View>
        <Text className="text-xl font-inter-bold text-foreground mb-2 text-center">
          Inicia sesión para ver tu perfil
        </Text>
        <Text className="text-sm text-muted-foreground mb-6 text-center max-w-xs">
          Gestiona tus membresías, vehículos asociados y datos personales.
        </Text>
        <Button onPress={() => router.push('/(auth)/login')}>Iniciar Sesión</Button>
      </View>
    )
  }

  // ── Loading ────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-vibe-fondo">
        <ActivityIndicator size="large" color="#0284c7" />
        <Text className="mt-3 text-sm text-muted-foreground">Cargando tus datos...</Text>
      </View>
    )
  }

  const cliente = data?.cliente
  const nombre = cliente?.nombre || user?.email?.split('@')[0] || 'Cliente'
  const primerNombre = nombre.split(' ')[0] || 'ti'
  const iniciales = nombre.trim().slice(0, 1).toUpperCase()

  const tiles = [
    { label: 'Membresías', href: '/mis-membresias' },
    { label: 'Citas', href: '/citas' },
    { label: 'Pagos', href: '/pagos' },
    { label: 'Vehículos', href: '/vehiculos' },
    { label: 'Historial', href: '/historial' },
    { label: 'Beneficios', href: '/mis-promociones' },
    { label: 'Intereses', href: '/intereses' },
    { label: 'Referidos', href: '/invita-y-gana' },
  ]

  return (
    <ScrollView className="flex-1 bg-vibe-fondo" contentContainerStyle={{ padding: 16, gap: 20 }}>
      {/* ── 1. Saludo ─────────────────────────────────────────────────── */}
      <View className="flex-row items-center gap-3">
        <View className="h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-primary-soft">
          <Text className="text-h3 font-inter-bold text-primary">{iniciales}</Text>
        </View>
        <Text
          className="min-w-0 flex-1 text-h2 font-inter-bold text-foreground"
          numberOfLines={1}
        >
          Hola, {primerNombre}
        </Text>
        <Pressable
          onPress={() => router.push('/ajustes')}
          className="h-10 w-10 items-center justify-center rounded-full"
          accessibilityLabel="Configuración"
          accessibilityRole="button"
        >
          <Settings size={20} color="#4b5563" />
        </Pressable>
      </View>

      {/* ── 2. Grid de accesos rápidos ───────────────────────────────── */}
      <View className="flex-row flex-wrap gap-2">
        {tiles.map((t) => (
          <Pressable
            key={t.label}
            onPress={() => router.push(t.href as any)}
            className="min-h-14 rounded-lg bg-retail-mist flex-1 items-center justify-center px-3 active:opacity-80"
          >
            <Text className="text-label-lg text-foreground">{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* ── 3. Cerrar sesión ─────────────────────────────────────────── */}
      <Pressable
        onPress={async () => {
          await signOut()
          router.replace('/(tabs)/inicio')
        }}
        className="flex-row items-center gap-3 rounded-xl border border-border bg-card p-4 active:opacity-80"
        accessibilityRole="button"
      >
        <View className="h-10 w-10 items-center justify-center rounded-lg bg-destructive/10">
          <LogOut size={20} color="#e7000b" />
        </View>
        <Text className="flex-1 text-small font-inter-bold text-destructive">Cerrar sesión</Text>
      </Pressable>
    </ScrollView>
  )
}

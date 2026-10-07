import React, { useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import {
  Store,
  WalletCards,
  Percent,
  CalendarDays,
  Ticket,
  ReceiptText,
  LifeBuoy,
  ChevronRight,
  ChevronDown,
  LayoutGrid,
  LogOut,
  Info,
  LogIn,
  type LucideIcon,
} from 'lucide-react-native'
import { useMenu } from '../../src/hooks/useMenu'
import { useAuth } from '../../src/lib/auth-context'
import { cn } from '../../src/lib/cn'
import { rnHref } from '../../src/lib/rutas'

/** Icono por id de fila (contrato Stitch S03). */
const ICON_MAP: Record<string, LucideIcon> = {
  Store,
  WalletCards,
  Percent,
  CalendarDays,
  Ticket,
  ReceiptText,
  LifeBuoy,
}

/**
 * Directorio completo (espejo de `src/app/(cliente)/cliente/menu/page.tsx`).
 * Los hrefs del BFF vienen en formato web (/cliente/...) y se traducen con
 * rnHref() a las rutas RN existentes.
 */
interface Fila {
  id: string
  href: string
  label: string
  icon: string
}

const FILAS: Fila[] = [
  { id: 'empresas', href: '/empresas', label: 'Empresas y negocios cercanos', icon: 'Store' },
  { id: 'membresias', href: '/mis-membresias', label: 'Membresías activas y disponibles', icon: 'WalletCards' },
  { id: 'promociones', href: '/promociones', label: 'Catálogo de beneficios y descuentos', icon: 'Percent' },
  { id: 'citas', href: '/citas', label: 'Mis citas y reservaciones', icon: 'CalendarDays' },
  { id: 'excursiones', href: '/mis-excursiones', label: 'Mis excursiones y boletos', icon: 'Ticket' },
  { id: 'historial', href: '/historial', label: 'Historial de visitas y canjes', icon: 'ReceiptText' },
  { id: 'pagos', href: '/pagos', label: 'Mis pagos y facturación', icon: 'WalletCards' },
  { id: 'ayuda', href: '/ayuda', label: 'Servicio de atención al cliente y soporte', icon: 'LifeBuoy' },
]

export default function MenuScreen() {
  const router = useRouter()
  const { user, isAuthenticated, signOut } = useAuth()
  const { data, isLoading } = useMenu()
  const [categoriasAbiertas, setCategoriasAbiertas] = useState(false)

  const filas = data?.items ?? FILAS
  const categorias = data?.categorias ?? []
  const nombre = data?.usuario?.nombre || user?.email?.split('@')[0] || 'Cliente'

  return (
    <ScrollView
      className="flex-1 bg-background"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ padding: 16 }}
    >
      <Text className="text-[22px] font-inter-bold tracking-tight text-foreground mb-3 px-1">
        Explora Membego
      </Text>

      <View className="rounded-xl border border-border bg-card mb-3 overflow-hidden">
        <TouchableOpacity
          onPress={() => setCategoriasAbiertas(!categoriasAbiertas)}
          activeOpacity={0.7}
          className="flex-row items-center gap-3 p-4"
          accessibilityRole="button"
          accessibilityState={{ expanded: categoriasAbiertas }}
        >
          <View className="h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <LayoutGrid size={20} className='text-primary' />
          </View>
          <Text className="flex-1 text-[15px] font-inter-semibold text-foreground">
            Explorar por categorías
          </Text>
          <View style={{ transform: [{ rotate: categoriasAbiertas ? '180deg' : '0deg' }] }}>
            <ChevronDown size={20} color="#71717a" />
          </View>
        </TouchableOpacity>

        {categoriasAbiertas && (
          <View className="border-t border-border">
            {isLoading ? (
              <ActivityIndicator size="small" className="text-primary" style={{ padding: 12 }} />
            ) : categorias.length === 0 ? (
              <Text className="text-sm text-muted-foreground p-4">
                No hay categorías disponibles por ahora.
              </Text>
            ) : (
              categorias.map((c: any, idx: number) => (
                <TouchableOpacity
                  key={c.id}
                  onPress={() =>
                    router.push(
                      c.slug
                        ? `/explorar?category=${encodeURIComponent(c.slug)}`
                        : '/explorar',
                    )
                  }
                  activeOpacity={0.7}
                  className={cn(
                    'flex-row items-center justify-between px-4 py-3',
                    idx < categorias.length - 1 && 'border-b border-border',
                  )}
                >
                  <Text className="text-sm font-inter-medium text-foreground flex-1">
                    {c.name}
                  </Text>
                  <ChevronRight size={16} color="#a1a1aa" />
                </TouchableOpacity>
              ))
            )}
          </View>
        )}
      </View>

      <View className="gap-2 mb-4">
        {filas.map((item: any) => {
          const Icon = ICON_MAP[item.icon] || Store

          return (
            <TouchableOpacity
              key={item.id}
              onPress={() => router.push(rnHref(item.href) as any)}
              activeOpacity={0.7}
              className="flex-row items-center gap-3 rounded-xl border border-border bg-card p-4"
              accessibilityRole="link"
            >
              <View className="h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                <Icon size={20} className='text-primary' />
              </View>
              <Text className="flex-1 text-[15px] font-inter-semibold text-foreground">
                {item.label}
              </Text>
              <ChevronRight size={16} color="#a1a1aa" />
            </TouchableOpacity>
          )
        })}
      </View>

      {isAuthenticated ? (
        <TouchableOpacity
          onPress={async () => {
            await signOut()
            router.replace('/(tabs)/inicio')
          }}
          activeOpacity={0.7}
          className="flex-row items-center gap-3 rounded-xl border border-border bg-card p-4 mb-4"
          accessibilityRole="button"
        >
          <View className="h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
            <LogOut size={20} color="#e7000b" />
          </View>
          <Text className="flex-1 text-[15px] font-inter-semibold text-foreground">
            ¿No eres {nombre}? Cerrar sesión
          </Text>
          <ChevronRight size={16} color="#a1a1aa" />
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          onPress={() => router.push('/(auth)/login')}
          activeOpacity={0.7}
          className="flex-row items-center gap-3 rounded-xl border border-primary/30 bg-card p-4 mb-4"
          accessibilityRole="link"
        >
          <View className="h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <LogIn size={20} color="#0284c7" />
          </View>
          <Text className="flex-1 text-[15px] font-inter-semibold text-foreground">
            Iniciar sesión en tu cuenta
          </Text>
          <ChevronRight size={16} color="#0284c7" />
        </TouchableOpacity>
      )}

      <View className="flex flex-row items-start gap-2 rounded-xl bg-muted/60 p-4">
        <Info size={16} className='text-primary' />
        <Text className="flex-1 text-[13px] text-muted-foreground leading-relaxed">
          ¿Buscas la configuración? Vive en{' '}
          <Text
            className="font-inter-semibold text-primary"
            onPress={() => router.push('/(tabs)/cuenta')}
          >
            Configuración
          </Text>
        </Text>
      </View>
    </ScrollView>
  )
}

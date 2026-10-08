import React, { useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  Pressable,
  Switch,
  Alert,
  Linking,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AlertCircle, User, ShieldCheck, Settings, Lock, Trash2 } from 'lucide-react-native'
import { useAuth } from '../src/lib/auth-context'
import { goBackOr } from '../src/lib/navigation'
import { useAjustes, useActualizarAjustes } from '../src/hooks/useAjustes'
import { supabase } from '../src/lib/supabase'
import { Button } from '../src/components/ui/Button'
import { Card } from '../src/components/ui/Card'
import { Input } from '../src/components/ui/Input'
import { EmptyState } from '../src/components/ui/EmptyState'
import { SectionHeader } from '../src/components/ui/SectionHeader'
import { Skeleton } from '../src/components/ui/Skeleton'
import { BackHeader } from '../src/components/ui/BackHeader'
import { fetchBff } from '../src/lib/api'

export default function AjustesScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user, isLoading: authLoading, signOut } = useAuth()
  const { data, isLoading, isError, refetch } = useAjustes(!!user)
  const actualizar = useActualizarAjustes()

  // Perfil form state
  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [fechaNacimiento, setFechaNacimiento] = useState('')
  const [ciudad, setCiudad] = useState('')
  const [genero, setGenero] = useState('')
  const [notifPromos, setNotifPromos] = useState(false)
  const [notifRecordatorios, setNotifRecordatorios] = useState(false)

  // Password form state
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [deletingAccount, setDeletingAccount] = useState(false)

  // Hydrate form when data loads (state adjustment during render, no extra commit)
  const [hydratedData, setHydratedData] = useState<typeof data | null>(null)
  if (data && data !== hydratedData && data.cliente) {
    setHydratedData(data)
    setNombre(data.cliente.nombre ?? '')
    setTelefono(data.cliente.telefono ?? '')
    setFechaNacimiento(data.cliente.fechaNacimiento ?? '')
    setCiudad(data.cliente.ciudad ?? '')
    setGenero(data.cliente.genero ?? '')
    setNotifPromos(data.cliente.notifPromos)
    setNotifRecordatorios(data.cliente.notifRecordatorios)
  }

  // Auth gate
  if (authLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-vibe-fondo" style={{ paddingBottom: insets.bottom }}>
        <ActivityIndicator color="#0284c7" size="large" />
      </View>
    )
  }

  if (!user) {
    return (
      <View className="flex-1 bg-vibe-fondo" style={{ paddingBottom: insets.bottom }}>
        <EmptyState
          icon={<User size={40} color="#0284c7" />}
          title="Inicia sesión"
          description="Necesitas una cuenta para ver tus ajustes."
          action={
            <Button onPress={() => router.push('/(auth)/login')}>
              Iniciar Sesión
            </Button>
          }
        />
      </View>
    )
  }

  const handleGuardar = () => {
    if (!nombre.trim()) {
      Alert.alert('Nombre requerido', 'El nombre no puede estar vacío.')
      return
    }
    actualizar.mutate(
      {
        nombre: nombre.trim(),
        telefono: telefono.trim() || undefined,
        fechaNacimiento: fechaNacimiento.trim() || undefined,
        ciudad: ciudad.trim() || undefined,
        genero: genero.trim() || undefined,
        notifPromos,
        notifRecordatorios,
      },
      {
        onSuccess: () => Alert.alert('Guardado', 'Tus ajustes se guardaron correctamente.'),
        onError: () => Alert.alert('Error', 'No pudimos guardar tus ajustes. Intenta de nuevo.'),
      },
    )
  }

  const handleCambiarPassword = async () => {
    if (!newPassword || !confirmPassword) {
      Alert.alert('Campos incompletos', 'Completa ambos campos de contraseña.')
      return
    }
    if (newPassword.length < 6) {
      Alert.alert('Contraseña corta', 'Mínimo 6 caracteres.')
      return
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('No coinciden', 'Las contraseñas no coinciden.')
      return
    }
    setChangingPassword(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setChangingPassword(false)
    if (error) {
      Alert.alert('Error', error.message)
    } else {
      Alert.alert('Listo', 'Contraseña actualizada.')
      setNewPassword('')
      setConfirmPassword('')
    }
  }

  const handleEliminarCuenta = () => {
    Alert.alert(
      'Eliminar cuenta',
      'Se eliminarán tus fichas de cliente, membresías y datos asociados. Los registros contables que deban conservarse por ley quedarán desvinculados de tu perfil. Esta acción no se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar cuenta',
          style: 'destructive',
          onPress: () => {
            setDeletingAccount(true)
            void fetchBff<{ success: boolean }>('/api/v1/auth/cuenta', { method: 'DELETE' })
              .then(async () => {
                await signOut()
                router.replace('/(auth)/login')
              })
              .catch((error: unknown) => {
                Alert.alert('No se pudo eliminar', error instanceof Error ? error.message : 'Intenta de nuevo o usa membego.com/eliminar-cuenta.')
              })
              .finally(() => setDeletingAccount(false))
          },
        },
      ],
    )
  }

  return (
    <View className="flex-1 bg-vibe-fondo">
      {/* Back bar */}
      <BackHeader
        title='Configuración'
        leftInset={insets.left}
        onBack={() => goBackOr(router, '/(tabs)/cuenta')}
      />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: insets.bottom + 32,
        }}
      >
        <SectionHeader
          title="Ajustes"
          description="Tus datos, seguridad y preferencias."
          className="mb-5"
        />

        {/* Loading */}
        {isLoading && (
          <View className="gap-3">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <View className="gap-2">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </View>
              </Card>
            ))}
          </View>
        )}

        {/* Error */}
        {isError && (
          <EmptyState
            icon={<AlertCircle size={40} color="#e7000b" />}
            title="No pudimos cargar tus ajustes"
            description="Revisa tu conexión e inténtalo de nuevo."
            action={
              <Button variant="outline" onPress={() => refetch()}>
                Reintentar
              </Button>
            }
          />
        )}

        {/* Content */}
        {data?.cliente && (
          <View className="gap-5">
            {/* Perfil */}
            <Card>
              <View className="mb-3 flex-row items-center gap-2">
                <User size={16} color="#6b7280" />
                <Text className="text-h4 font-inter-semibold text-foreground">Perfil</Text>
              </View>
              <View className="gap-3">
                <View>
                  <Text className="mb-1 text-small font-inter-medium text-muted-foreground">
                    Nombre completo *
                  </Text>
                  <Input
                    value={nombre}
                    onChangeText={setNombre}
                    placeholder="Tu nombre"
                    autoCapitalize="words"
                  />
                </View>
                <View>
                  <Text className="mb-1 text-small font-inter-medium text-muted-foreground">
                    Correo electrónico
                  </Text>
                  <Input value={data.cliente.email ?? ''} editable={false} className="bg-muted" />
                </View>
                <View>
                  <Text className="mb-1 text-small font-inter-medium text-muted-foreground">
                    Teléfono
                  </Text>
                  <Input
                    value={telefono}
                    onChangeText={setTelefono}
                    placeholder="Tu teléfono"
                    keyboardType="phone-pad"
                  />
                </View>
                <View>
                  <Text className="mb-1 text-small font-inter-medium text-muted-foreground">
                    Fecha de nacimiento
                  </Text>
                  <Input
                    value={fechaNacimiento}
                    onChangeText={setFechaNacimiento}
                    placeholder="YYYY-MM-DD"
                  />
                </View>
                <View>
                  <Text className="mb-1 text-small font-inter-medium text-muted-foreground">
                    Ciudad
                  </Text>
                  <Input
                    value={ciudad}
                    onChangeText={setCiudad}
                    placeholder="Tu ciudad"
                    autoCapitalize="words"
                  />
                </View>
                <View>
                  <Text className="mb-1 text-small font-inter-medium text-muted-foreground">
                    Género (opcional)
                  </Text>
                  <Input
                    value={genero}
                    onChangeText={setGenero}
                    placeholder="Opcional"
                    autoCapitalize="words"
                  />
                </View>
                <View className="gap-2 pt-1">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-small text-foreground">Recibir promociones</Text>
                    <Switch value={notifPromos} onValueChange={setNotifPromos} />
                  </View>
                  <View className="flex-row items-center justify-between">
                    <Text className="text-small text-foreground">Recordatorios</Text>
                    <Switch value={notifRecordatorios} onValueChange={setNotifRecordatorios} />
                  </View>
                </View>
              </View>
            </Card>

            <Card>
              <View className="mb-2 flex-row items-center gap-2">
                <Trash2 size={16} color="#b91c1c" />
                <Text className="text-h4 font-inter-semibold text-foreground">Eliminar cuenta</Text>
              </View>
              <Text className="mb-3 text-small text-muted-foreground">
                Elimina tu acceso y las fichas de cliente asociadas. Los registros contables que deban conservarse por ley quedarán desvinculados de tu perfil.
              </Text>
              <Button variant="destructive" onPress={handleEliminarCuenta} loading={deletingAccount}>
                Eliminar mi cuenta
              </Button>
            </Card>

            <Pressable
              accessibilityRole="link"
              onPress={() => void Linking.openURL('https://membego.com/privacy')}
              className="items-center py-2"
            >
              <Text className="text-small font-inter-medium" style={{ color: '#0284c7' }}>
                Política de privacidad
              </Text>
            </Pressable>

            {/* Preferencias */}
            {data.prefs && (
              <Card>
                <View className="mb-3 flex-row items-center gap-2">
                  <Settings size={16} color="#6b7280" />
                  <Text className="text-h4 font-inter-semibold text-foreground">Preferencias</Text>
                </View>
                <View className="gap-2">
                  <View className="flex-row justify-between">
                    <Text className="text-small text-muted-foreground">Moneda</Text>
                    <Text className="text-small font-inter-medium text-foreground">
                      {data.prefs.moneda}
                    </Text>
                  </View>
                  <View className="flex-row justify-between">
                    <Text className="text-small text-muted-foreground">Idioma</Text>
                    <Text className="text-small font-inter-medium text-foreground">
                      {data.prefs.idioma}
                    </Text>
                  </View>
                  <View className="flex-row justify-between">
                    <Text className="text-small text-muted-foreground">Zona horaria</Text>
                    <Text className="text-small font-inter-medium text-foreground">
                      {data.prefs.zonaHoraria}
                    </Text>
                  </View>
                </View>
              </Card>
            )}

            {/* Seguridad */}
            <Card>
              <View className="mb-3 flex-row items-center gap-2">
                <ShieldCheck size={16} color="#6b7280" />
                <Text className="text-h4 font-inter-semibold text-foreground">Seguridad</Text>
              </View>
              <View className="gap-3">
                <View>
                  <Text className="mb-1 text-small font-inter-medium text-muted-foreground">
                    Nueva contraseña
                  </Text>
                  <Input
                    value={newPassword}
                    onChangeText={setNewPassword}
                    placeholder="Mínimo 6 caracteres"
                    secureTextEntry
                  />
                </View>
                <View>
                  <Text className="mb-1 text-small font-inter-medium text-muted-foreground">
                    Confirmar contraseña
                  </Text>
                  <Input
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    placeholder="Repite la contraseña"
                    secureTextEntry
                  />
                </View>
                <Button
                  variant="outline"
                  onPress={handleCambiarPassword}
                  loading={changingPassword}
                  icon={<Lock size={16} color="#111827" />}
                >
                  Cambiar contraseña
                </Button>
              </View>
            </Card>

            {/* Guardar */}
            <Button
              onPress={handleGuardar}
              loading={actualizar.isPending}
              disabled={!nombre.trim()}
            >
              Guardar cambios
            </Button>
          </View>
        )}

        {/* No client data */}
        {data && !data.cliente && !isLoading && (
          <EmptyState
            icon={<User size={40} color="#0284c7" />}
            title="Sin información"
            description="No se encontró tu información de cliente."
          />
        )}
      </ScrollView>
    </View>
  )
}

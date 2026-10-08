import React from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Sparkles, AlertCircle } from 'lucide-react-native';
import { useAuth } from '../src/lib/auth-context';
import { useBienvenida } from '../src/hooks/useBienvenida';
import { WizardCliente } from '../src/components/onboarding/WizardCliente';
import { Button } from '../src/components/ui/Button';

/**
 * Pantalla de bienvenida (onboarding post-registro).
 * Equivalente RN de src/app/(cliente)/cliente/bienvenida/page.tsx.
 *
 * Muestra el WizardCliente con el checklist de onboarding, progreso y
 * navegación de pasos. Usa useBienvenida() para obtener los datos.
 */
export default function BienvenidaScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { data, isLoading, isError, refetch } = useBienvenida(isAuthenticated);

  /* ── Auth loading ────────────────────────────────────────────────── */
  if (authLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" color="#0284c7" />
      </View>
    );
  }

  /* ── Auth gate ───────────────────────────────────────────────────── */
  if (!isAuthenticated) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <View className="h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 mb-4">
          <Sparkles size={32} color="#0284c7" />
        </View>
        <Text className="text-xl font-inter-bold text-foreground mb-2 text-center">
          Inicia sesión para continuar
        </Text>
        <Text className="text-sm text-muted-foreground mb-6 text-center max-w-xs">
          Completa tu configuración en unos pasos rápidos.
        </Text>
        <Button onPress={() => router.push('/(auth)/login')}>
          Iniciar Sesión
        </Button>
      </View>
    );
  }

  /* ── Data loading ────────────────────────────────────────────────── */
  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" color="#0284c7" />
      </View>
    );
  }

  /* ── Error ───────────────────────────────────────────────────────── */
  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <View className="h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10 mb-4">
          <AlertCircle size={32} color="#e7000b" />
        </View>
        <Text className="text-lg font-inter-bold text-foreground mb-2 text-center">
          No se pudo cargar la bienvenida
        </Text>
        <Text className="text-sm text-muted-foreground mb-6 text-center max-w-xs">
          Revisa tu conexión e intenta de nuevo.
        </Text>
        <Button variant="outline" onPress={() => refetch()}>
          Reintentar
        </Button>
      </View>
    );
  }

  const { onboarding, nombre } = data ?? {
    onboarding: { items: [], completados: 0, total: 0 },
    nombre: '',
  };

  /* ── Content ─────────────────────────────────────────────────────── */
  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: insets.bottom + 32,
      }}
    >
      <View className="mx-auto w-full max-w-lg">
        <WizardCliente onboarding={onboarding} nombre={nombre} />
      </View>
    </ScrollView>
  );
}

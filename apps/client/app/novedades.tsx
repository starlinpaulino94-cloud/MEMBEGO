import React from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Bell, AlertCircle } from 'lucide-react-native';
import { useAuth } from '../src/lib/auth-context';
import { useNovedades } from '../src/hooks/useNovedades';
import { Button } from '../src/components/ui/Button';
import { EmptyState } from '../src/components/ui/EmptyState';
import { Skeleton } from '../src/components/ui/Skeleton';
import { FeedNovedades } from '../src/components/cliente/FeedNovedades';

/**
 * NOVEDADES — feed de las empresas que el cliente sigue.
 *
 * Paridad con `src/app/(cliente)/cliente/novedades/page.tsx` (web).
 * Auth gate + loading + error + empty + feed.
 */
export default function NovedadesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { data, isLoading, isError, refetch } = useNovedades(!!isAuthenticated);

  /* ── Auth gate ─────────────────────────────────────────────────────── */
  if (authLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" color="#0284c7" />
      </View>
    );
  }

  if (!isAuthenticated) {
    return (
      <View className="flex-1 bg-background">
        {/* ── Back bar ──────────────────────────────────────────────── */}
        <View
          className="flex-row items-center gap-2 bg-background border-b border-border"
          style={{
            paddingLeft: insets.left + 16,
            paddingRight: 16,
            paddingTop: 12,
            paddingBottom: 12,
          }}
        >
          <Pressable
            onPress={() => router.back()}
            className="p-2 rounded-lg active:bg-muted"
            accessibilityRole="button"
            accessibilityLabel="Volver"
          >
            <ArrowLeft size={20} color="#111827" />
          </Pressable>
          <Text className="text-lg font-inter-bold text-foreground">
            Novedades
          </Text>
        </View>

        <View className="flex-1 items-center justify-center px-6">
          <EmptyState
            icon={<Bell size={32} color="#0284c7" />}
            title="Inicia sesión"
            description="Necesitas una cuenta para ver las novedades de tus empresas."
            action={
              <Button onPress={() => router.push('/(auth)/login')}>
                Iniciar Sesión
              </Button>
            }
          />
        </View>
      </View>
    );
  }

  const novedades = data?.novedades ?? [];

  return (
    <View className="flex-1 bg-background">
      {/* ── Back bar ────────────────────────────────────────────────── */}
      <View
        className="flex-row items-center gap-2 bg-background border-b border-border"
        style={{
          paddingLeft: insets.left + 16,
          paddingRight: 16,
          paddingTop: 12,
          paddingBottom: 12,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          className="p-2 rounded-lg active:bg-muted"
          accessibilityRole="button"
          accessibilityLabel="Volver"
        >
          <ArrowLeft size={20} color="#111827" />
        </Pressable>
        <Text className="text-lg font-inter-bold text-foreground">
          Novedades
        </Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16 }}
      >
        {/* ── Loading ───────────────────────────────────────────────── */}
        {isLoading ? (
          <View className="gap-3">
            <Skeleton className="h-22 w-22 rounded-lg" />
            <Skeleton className="h-22 w-full rounded-lg" />
            <Skeleton className="h-22 w-full rounded-lg" />
            <Skeleton className="h-22 w-full rounded-lg" />
          </View>
        ) : isError ? (
          /* ── Error ──────────────────────────────────────────────── */
          <View className="border border-destructive/30 rounded-2xl bg-destructive/5">
            <View className="py-10 items-center">
              <AlertCircle size={24} color="#e7000b" />
              <Text className="font-inter-medium text-foreground mt-3 text-center">
                No pudimos cargar tus novedades.
              </Text>
              <Button variant="outline" onPress={() => refetch()} className="mt-4">
                Reintentar
              </Button>
            </View>
          </View>
        ) : novedades.length === 0 ? (
          /* ── Empty ──────────────────────────────────────────────── */
          <EmptyState
            icon={<Bell size={32} color="#0284c7" />}
            title="Sin novedades por ahora"
            description="Sigue a tus negocios favoritos y aquí verás sus promociones, eventos y noticias."
            action={
              <Button onPress={() => router.push('/(tabs)/inicio')}>
                Explorar empresas
              </Button>
            }
          />
        ) : (
          /* ── Feed ───────────────────────────────────────────────── */
          <FeedNovedades novedades={novedades} />
        )}
      </ScrollView>
    </View>
  );
}

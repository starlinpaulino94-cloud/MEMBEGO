import React from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  CalendarDays,
  Clock,
  Users,
  Ticket,
  Compass,
  ChevronRight,
  AlertCircle,
} from 'lucide-react-native';
import { useAuth } from '../src/lib/auth-context';
import { goBackOr } from '../src/lib/navigation';
import { useMisExcursiones } from '../src/hooks/useExcursiones';
import { formatDate, formatMoney } from '../src/lib/format';
import { Button } from '../src/components/ui/Button';
import { Card } from '../src/components/ui/Card';
import { Badge } from '../src/components/ui/Badge';
import { EmptyState } from '../src/components/ui/EmptyState';
import { Skeleton } from '../src/components/ui/Skeleton';
import { cn } from '../src/lib/cn';
import {
  ESTADO_RESERVA_LABEL,
  TONO_RESERVA,
  type EstadoReserva,
} from '../src/lib/reservas-nucleo';

interface ReservaItem {
  id: string;
  numero: string;
  estado: string;
  fecha: string;
  hora: string | null;
  adultos: number;
  ninos: number;
  total: number;
  moneda: string;
  excursion: {
    id: string;
    nombre: string;
    slug: string;
    portadaUrl: string | null;
  };
}

// Mapeo TONO_RESERVA → Badge variant
const TONO_TO_VARIANT: Record<string, 'success' | 'warning' | 'info' | 'secondary' | 'destructive'> = {
  success: 'success',
  warning: 'warning',
  info: 'info',
  neutral: 'secondary',
  danger: 'destructive',
};

export default function MisExcursionesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { data, isLoading, isError, refetch } = useMisExcursiones(isAuthenticated);

  // Auth gate
  if (authLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#0284c7" size="large" />
      </View>
    );
  }

  if (!isAuthenticated) {
    return (
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
        <View className="px-4 py-3 border-b border-border bg-card">
          <Pressable
            onPress={() => goBackOr(router, '/(tabs)/inicio')}
            className="flex-row items-center gap-1.5"
          >
            <ArrowLeft size={16} color="#71717a" />
            <Text className="text-sm font-inter-semibold text-muted-foreground">
              Mis excursiones
            </Text>
          </Pressable>
        </View>
        <EmptyState
          icon={<Ticket size={40} color="#0284c7" />}
          title="Inicia sesión"
          description="Accede a tus reservas de excursiones y pases de embarque."
          action={
            <Button onPress={() => router.push('/(auth)/login')}>
              Iniciar Sesión
            </Button>
          }
        />
      </View>
    );
  }

  const reservas: ReservaItem[] = data?.reservas ?? [];
  const ahora = new Date();
  const proximas = reservas.filter((r) => new Date(r.fecha) >= ahora);
  const pasadas = reservas.filter((r) => new Date(r.fecha) < ahora);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      {/* Back bar */}
      <View className="px-4 py-3 border-b border-border bg-card">
        <Pressable
            onPress={() => goBackOr(router, '/(tabs)/inicio')}
          className="flex-row items-center gap-1.5"
        >
          <ArrowLeft size={16} color="#71717a" />
          <Text className="text-sm font-inter-semibold text-muted-foreground">
            Mis excursiones
          </Text>
        </Pressable>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
      >
        <View className="px-4 py-6 gap-6">
          {/* Page header */}
          <View>
            <Text className="text-xs font-inter-bold uppercase tracking-widest text-primary">
              Actividad
            </Text>
            <Text className="mt-1 text-2xl font-inter-extrabold text-foreground">
              Mis excursiones
            </Text>
            <Text className="mt-1.5 text-sm text-muted-foreground">
              {reservas.length} reserva{reservas.length !== 1 ? 's' : ''} registrada
              {reservas.length !== 1 ? 's' : ''}. Accede a tus pases y códigos QR de embarque.
            </Text>
          </View>

          {/* Loading */}
          {isLoading && (
            <View className="gap-3">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="p-4">
                  <View className="flex-row gap-4">
                    <Skeleton className="h-32 w-28 rounded-xl" />
                    <View className="flex-1 gap-2">
                      <Skeleton className="h-5 w-3/4" />
                      <Skeleton className="h-4 w-1/2" />
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-6 w-20" />
                    </View>
                  </View>
                </Card>
              ))}
            </View>
          )}

          {/* Error */}
          {isError && (
            <EmptyState
              icon={<AlertCircle size={40} color="#e7000b" />}
              title="No pudimos cargar tus excursiones"
              description="Intenta de nuevo en unos momentos."
              action={
                <Button variant="outline" onPress={() => refetch()}>
                  Reintentar
                </Button>
              }
            />
          )}

          {/* Empty */}
          {!isLoading && !isError && reservas.length === 0 && (
            <EmptyState
              icon={<Ticket size={40} color="#0284c7" />}
              title="Sin reservas todavía"
              description="Cuando reserves una excursión o tour, tus pases y tickets de embarque con código QR aparecerán aquí."
              action={
                <Button onPress={() => router.push('/explorar')}>
                  Explorar excursiones disponibles
                </Button>
              }
            />
          )}

          {/* Próximas */}
          {!isLoading && !isError && proximas.length > 0 && (
            <View>
              <View className="flex-row items-center gap-2 mb-3">
                <View className="h-2.5 w-2.5 rounded-full bg-success" />
                <Text className="text-lg font-inter-bold text-foreground">
                  Próximas salidas ({proximas.length})
                </Text>
              </View>
              <View className="gap-3">
                {proximas.map((r) => (
                  <ReservaCard
                    key={r.id}
                    reserva={r}
                    ahora={ahora}
                    onPress={() => router.push(`/mis-excursiones/${r.id}`)}
                  />
                ))}
              </View>
            </View>
          )}

          {/* Pasadas */}
          {!isLoading && !isError && pasadas.length > 0 && (
            <View>
              <Text className="text-lg font-inter-bold text-muted-foreground mb-3">
                Historial de pasadas ({pasadas.length})
              </Text>
              <View className="gap-3">
                {pasadas.map((r) => (
                  <ReservaCard
                    key={r.id}
                    reserva={r}
                    ahora={ahora}
                    onPress={() => router.push(`/mis-excursiones/${r.id}`)}
                  />
                ))}
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function ReservaCard({
  reserva,
  ahora,
  onPress,
}: {
  reserva: ReservaItem;
  ahora: Date;
  onPress: () => void;
}) {
  const esPasada = new Date(reserva.fecha) < ahora;
  const tono = TONO_RESERVA[reserva.estado as EstadoReserva] ?? 'neutral';
  const badgeVariant = TONO_TO_VARIANT[tono] ?? 'secondary';
  const estadoLabel =
    ESTADO_RESERVA_LABEL[reserva.estado as EstadoReserva] ?? reserva.estado;

  return (
    <Card onPress={onPress} className="p-3.5">
      <View className="flex-row gap-3.5">
        {/* Thumbnail */}
        <View className="relative h-32 w-28 flex-shrink-0 overflow-hidden rounded-xl bg-muted">
          {reserva.excursion.portadaUrl ? (
            <Image
              source={{ uri: reserva.excursion.portadaUrl }}
              className="h-full w-full"
              resizeMode="cover"
            />
          ) : (
            <View className="h-full w-full items-center justify-center bg-primary/5">
              <CalendarDays size={32} color="#0284c7" opacity={0.4} />
            </View>
          )}
          {esPasada && (
            <View className="absolute inset-0 bg-black/50 items-center justify-center">
              <View className="rounded-full bg-background/90 px-2.5 py-0.5">
                <Text className="text-xs font-inter-semibold text-muted-foreground">
                  Finalizada
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* Info */}
        <View className="flex-1 justify-between">
          <View>
            {/* Nombre + Badge */}
            <View className="flex-row items-start justify-between gap-2">
              <View className="flex-1">
                <Text className="text-sm font-inter-bold text-foreground" numberOfLines={1}>
                  {reserva.excursion.nombre}
                </Text>
                <Text className="text-xs text-muted-foreground mt-0.5">
                  Reserva:{' '}
                  <Text className="font-mono font-inter-semibold">{reserva.numero}</Text>
                </Text>
              </View>
              <Badge variant={badgeVariant}>
                <Text className="text-xs font-inter-bold">{estadoLabel}</Text>
              </Badge>
            </View>

            {/* Meta row */}
            <View className="mt-2.5 flex-row flex-wrap items-center gap-x-3 gap-y-1.5">
              <View className="flex-row items-center gap-1">
                <CalendarDays size={14} color="#0284c7" />
                <Text className="text-xs font-inter-medium text-muted-foreground">
                  {formatDate(reserva.fecha, { moneda: reserva.moneda })}
                </Text>
              </View>
              {reserva.hora && (
                <View className="flex-row items-center gap-1">
                  <Clock size={14} color="#0284c7" />
                  <Text className="text-xs font-inter-medium text-muted-foreground">
                    {reserva.hora}
                  </Text>
                </View>
              )}
              <View className="flex-row items-center gap-1">
                <Users size={14} color="#71717a" />
                <Text className="text-xs text-muted-foreground">
                  {reserva.adultos} ad.{reserva.ninos > 0 ? `, ${reserva.ninos} niñ.` : ''}
                </Text>
              </View>
            </View>
          </View>

          {/* Precio + CTA */}
          <View className="mt-2.5 pt-2 border-t border-border/50 flex-row items-center justify-between">
            <View>
              <Text className="text-xs font-inter-bold uppercase text-muted-foreground">
                Total pagado
              </Text>
              <Text
                className="text-sm font-inter-bold text-foreground"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {formatMoney(reserva.total, { moneda: reserva.moneda })}
              </Text>
            </View>
            <View className="flex-row items-center gap-1">
              <Text className="text-xs font-inter-semibold text-primary">
                Ver detalle
              </Text>
              <ChevronRight size={14} color="#0284c7" />
            </View>
          </View>
        </View>
      </View>
    </Card>
  );
}

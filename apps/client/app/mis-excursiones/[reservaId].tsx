import React from 'react';
import { ResponsiveDetailSheet } from '../../src/components/ui/ResponsiveDetailSheet'
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { goBackOr } from '../../src/lib/navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  CalendarDays,
  Clock,
  MapPin,
  Users,
  CreditCard,
  Check,
  X,
  Shield,
  Compass,
  AlertCircle,
  Ticket,
} from 'lucide-react-native';
import { useAuth } from '../../src/lib/auth-context';
import { useMiExcursion } from '../../src/hooks/useExcursiones';
import { formatDate, formatMoney, formatDateTime } from '../../src/lib/format';
import { Button } from '../../src/components/ui/Button';
import { Card } from '../../src/components/ui/Card';
import { Badge } from '../../src/components/ui/Badge';
import { EmptyState } from '../../src/components/ui/EmptyState';
import { Skeleton } from '../../src/components/ui/Skeleton';
import { DetailPageFrame } from '../../src/components/ui/DetailPageFrame';
import { cn } from '../../src/lib/cn';
import {
  ESTADO_RESERVA_LABEL,
  TONO_RESERVA,
  ESTADOS_CERRADOS,
  esModificable,
  minutosDesdeMedianoche,
  formatoMinutosAHora,
  type EstadoReserva,
  type PoliticaReembolso,
} from '../../src/lib/reservas-nucleo';
import { ReservaCheckinQrDisplay } from '../../src/components/excursiones/ReservaCheckinQrDisplay';
import { ClienteModificarReserva } from '../../src/components/excursiones/ClienteModificarReserva';

// Interfaces locales (BFF retorna unknown)
interface ReservaDetalle {
  id: string;
  numero: string;
  estado: string;
  fecha: string;
  hora: string | null;
  adultos: number;
  ninos: number;
  subtotal: number;
  descuento: number;
  impuestos: number;
  total: number;
  notas: string | null;
  pasajeros: Array<{
    id: string;
    tipo: 'ADULTO' | 'NINO';
    presente: boolean;
  }>;
  pagos: Array<{
    id: string;
    monto: number;
    createdAt: string;
  }>;
}

interface ExcursionDetalle {
  id: string;
  nombre: string;
  slug: string;
  categoria: string | null;
  portadaUrl: string | null;
  descripcion: string | null;
  duracionMin: number | null;
  ubicacion: string | null;
  puntoSalida: string | null;
  horaSalida: string | null;
  horaRegreso: string | null;
  incluye: string | null;
  noIncluye: string | null;
  politicas: string | null;
  moneda: string;
  impuestoPct: number | null;
  tipoItem: string | null;
}

interface VarianteDetalle {
  id: string;
  precioAdulto: number;
  precioNino: number | null;
}

interface SaldoDetalle {
  pagado: number;
  saldo: number;
  liquidada: boolean;
}

// Mapeo TONO → Badge variant
const TONO_TO_VARIANT: Record<string, 'success' | 'warning' | 'info' | 'secondary' | 'destructive'> = {
  success: 'success',
  warning: 'warning',
  info: 'info',
  neutral: 'secondary',
  danger: 'destructive',
};

// ponytail: getExcursionesConfig no disponible en BFF. Default hardcodeado.
// Agregar GET /api/v1/cliente/excursiones/config cuando F4 lo priorice.
const POLITICA_DEFAULT: PoliticaReembolso = {
  permitirReduccionPasajeros: true,
  permitirCancelacion: true,
  anticipacionMinimaHoras: 24,
  anticipacionCancelacionHoras: 48,
  penalizacionCancelacionPct: 0,
  permitirReembolsoTotal: true,
  permitirReembolsoParcial: true,
  tipoReembolso: 'COMPLETO',
  horasLimiteReembolso: 24,
};

function MisExcursionDetalleScreenContent() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { reservaId } = useLocalSearchParams<{ reservaId: string }>();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { data, isLoading, isError, refetch } = useMiExcursion(
    reservaId,
    isAuthenticated
  );

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
            onPress={() => goBackOr(router, '/mis-excursiones')}
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
          description="Accede a los detalles de tu reserva."
          action={
            <Button onPress={() => router.push('/(auth)/login')}>
              Iniciar Sesión
            </Button>
          }
        />
      </View>
    );
  }

  // Loading
  if (isLoading) {
    return (
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
        <View className="px-4 py-3 border-b border-border bg-card">
          <Pressable
            onPress={() => goBackOr(router, '/mis-excursiones')}
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
          showsVerticalScrollIndicator={false}
        >
          <DetailPageFrame className="px-4 py-6 gap-4">
            <Skeleton className="h-48 rounded-2xl" />
            <Skeleton className="h-32 rounded-2xl" />
            <Skeleton className="h-64 rounded-2xl" />
          </DetailPageFrame>
        </ScrollView>
      </View>
    );
  }

  // Error
  if (isError || !data) {
    return (
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
        <View className="px-4 py-3 border-b border-border bg-card">
          <Pressable
            onPress={() => goBackOr(router, '/mis-excursiones')}
            className="flex-row items-center gap-1.5"
          >
            <ArrowLeft size={16} color="#71717a" />
            <Text className="text-sm font-inter-semibold text-muted-foreground">
              Mis excursiones
            </Text>
          </Pressable>
        </View>
        <EmptyState
          icon={<AlertCircle size={40} color="#e7000b" />}
          title="No pudimos cargar la reserva"
          description="La reserva no existe o no tienes permiso para verla."
          action={
            <Button variant="outline" onPress={() => refetch()}>
              Reintentar
            </Button>
          }
        />
      </View>
    );
  }

  const reserva = data.reserva as ReservaDetalle;
  const excursion = data.excursion as ExcursionDetalle;
  const variante = data.variante as VarianteDetalle | null;
  const saldo = data.saldo as SaldoDetalle;
  const checkinToken = data.checkinToken as string | null;
  const checkinAt = data.checkinAt as string | null;
  const checkinPorId = data.checkinPorId as string | null;

  const moneda = excursion?.moneda ?? 'DOP';
  const tono = TONO_RESERVA[reserva.estado as EstadoReserva] ?? 'neutral';
  const badgeVariant = TONO_TO_VARIANT[tono] ?? 'secondary';
  const estadoLabel =
    ESTADO_RESERVA_LABEL[reserva.estado as EstadoReserva] ?? reserva.estado;

  const ahora = new Date();
  const { modificable, horasRestantes } = esModificable(
    new Date(reserva.fecha),
    reserva.hora,
    ahora,
    POLITICA_DEFAULT.anticipacionMinimaHoras
  );
  const esCerrada = ESTADOS_CERRADOS.includes(reserva.estado as EstadoReserva);

  // Calcular hora de regreso estimada
  const hInicio = reserva.hora?.trim().slice(0, 5) || excursion?.horaSalida?.trim().slice(0, 5);
  const durMin = excursion?.duracionMin;
  const hFin =
    hInicio && durMin && durMin > 0
      ? formatoMinutosAHora(minutosDesdeMedianoche(hInicio) + durMin)
      : excursion?.horaRegreso?.trim().slice(0, 5) || null;

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      {/* Back bar */}
      <View className="border-b border-border bg-card">
        <DetailPageFrame className="px-4 py-3">
          <Pressable
            onPress={() => router.push('/mis-excursiones')}
            className="flex-row items-center gap-1.5"
          >
            <ArrowLeft size={16} color="#71717a" />
            <Text className="text-sm font-inter-semibold text-muted-foreground">
              Mis excursiones
            </Text>
          </Pressable>
        </DetailPageFrame>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
      >
        <DetailPageFrame className="px-4 py-6 gap-6">
          {/* QR de embarque */}
          <ReservaCheckinQrDisplay
            checkinToken={checkinToken}
            checkinAt={checkinAt}
            checkinPorId={checkinPorId}
            numero={reserva.numero}
          />

          {/* Modificación de pasajeros */}
          {!esCerrada && variante && (
            <ClienteModificarReserva
              reservaId={reserva.id}
              adultos={reserva.adultos}
              ninos={reserva.ninos}
              precioAdulto={Number(variante.precioAdulto)}
              precioNino={variante.precioNino != null ? Number(variante.precioNino) : null}
              impuestoPct={excursion?.impuestoPct != null ? Number(excursion.impuestoPct) : null}
              descuento={Number(reserva.descuento ?? 0)}
              pagado={saldo.pagado}
              moneda={moneda}
              politica={POLITICA_DEFAULT}
              horasRestantes={horasRestantes}
              modificable={modificable}
            />
          )}

          {/* Card principal */}
          <Card className="overflow-hidden p-0">
            {/* Header de la reserva */}
            <View className="border-b border-border bg-muted/20 p-4">
              <View className="flex-row items-center justify-between gap-3">
                <View>
                  <Text className="text-xs font-inter-bold uppercase tracking-wider text-muted-foreground">
                    Número de Reserva
                  </Text>
                  <Text className="mt-0.5 text-xl font-mono font-inter-bold text-foreground">
                    {reserva.numero}
                  </Text>
                </View>
                <Badge variant={badgeVariant}>
                  <Text className="text-xs font-inter-bold">{estadoLabel}</Text>
                </Badge>
              </View>
            </View>

            {/* Info de la excursión */}
            {excursion && (
              <View className="p-4 border-b border-border gap-4">
                <View className="flex-row items-start gap-3.5">
                  <View className="h-14 w-14 rounded-xl bg-primary/10 items-center justify-center flex-shrink-0">
                    <Compass size={28} color="#0284c7" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-base font-inter-bold text-foreground" numberOfLines={2}>
                      {excursion.nombre}
                    </Text>
                    {excursion.categoria && (
                      <Badge variant="info" className="mt-1">
                        <Text className="text-xs font-inter-semibold">{excursion.categoria}</Text>
                      </Badge>
                    )}
                    <View className="mt-2 flex-row flex-wrap items-center gap-x-4 gap-y-1.5">
                      {excursion.duracionMin && (
                        <View className="flex-row items-center gap-1">
                          <Clock size={14} color="#0284c7" />
                          <Text className="text-xs font-inter-medium text-muted-foreground">
                            {excursion.duracionMin} min
                          </Text>
                        </View>
                      )}
                      {excursion.ubicacion && (
                        <View className="flex-row items-center gap-1">
                          <MapPin size={14} color="#0284c7" />
                          <Text className="text-xs font-inter-medium text-muted-foreground" numberOfLines={1}>
                            {excursion.ubicacion}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                </View>

                {/* Portada */}
                {excursion.portadaUrl && (
                  <View className="relative w-full overflow-hidden rounded-xl bg-muted" style={{ aspectRatio: 16 / 9 }}>
                    <Image
                      source={{ uri: excursion.portadaUrl }}
                      className="h-full w-full"
                      resizeMode="cover"
                    />
                  </View>
                )}

                {/* Descripción */}
                {excursion.descripcion && (
                  <View>
                    <Text className="text-xs font-inter-bold uppercase tracking-wider text-muted-foreground">
                      Descripción
                    </Text>
                    <Text className="mt-1 text-sm text-foreground/80">
                      {excursion.descripcion}
                    </Text>
                  </View>
                )}

                {/* Grid de horarios */}
                <View className="flex-row flex-wrap gap-2.5">
                  {excursion.puntoSalida && (
                    <View className="flex-1 min-w-[45%] flex-row items-center gap-2.5 rounded-xl bg-muted/50 p-3">
                      <MapPin size={20} color="#0284c7" />
                      <View className="flex-1">
                        <Text className="text-xs font-inter-bold uppercase text-muted-foreground">
                          Punto de salida
                        </Text>
                        <Text className="text-xs font-inter-semibold text-foreground" numberOfLines={1}>
                          {excursion.puntoSalida}
                        </Text>
                      </View>
                    </View>
                  )}
                  {hInicio && (
                    <View className="flex-1 min-w-[45%] flex-row items-center gap-2.5 rounded-xl bg-muted/50 p-3">
                      <Clock size={20} color="#0284c7" />
                      <View>
                        <Text className="text-xs font-inter-bold uppercase text-muted-foreground">
                          Hora de salida
                        </Text>
                        <Text className="text-xs font-inter-semibold text-foreground font-mono">
                          {hInicio}
                        </Text>
                      </View>
                    </View>
                  )}
                  {hFin && (
                    <View className="flex-1 min-w-[45%] flex-row items-center gap-2.5 rounded-xl bg-muted/50 p-3">
                      <Clock size={20} color="#71717a" />
                      <View>
                        <Text className="text-xs font-inter-bold uppercase text-muted-foreground">
                          Regreso estimado
                        </Text>
                        <Text className="text-xs font-inter-semibold text-foreground font-mono">
                          {hFin}
                        </Text>
                      </View>
                    </View>
                  )}
                  {excursion.duracionMin && (
                    <View className="flex-1 min-w-[45%] flex-row items-center gap-2.5 rounded-xl bg-muted/50 p-3">
                      <CalendarDays size={20} color="#0284c7" />
                      <View>
                        <Text className="text-xs font-inter-bold uppercase text-muted-foreground">
                          Duración total
                        </Text>
                        <Text className="text-xs font-inter-semibold text-foreground">
                          {excursion.duracionMin >= 60
                            ? `${Math.floor(excursion.duracionMin / 60)}h ${excursion.duracionMin % 60 > 0 ? `${excursion.duracionMin % 60}m` : ''}`.trim()
                            : `${excursion.duracionMin} min`}
                        </Text>
                      </View>
                    </View>
                  )}
                </View>

                {/* Incluye / No incluye */}
                {(excursion.incluye || excursion.noIncluye) && (
                  <View className="gap-2.5">
                    {excursion.incluye && (
                      <View className="rounded-xl bg-success/10 p-3.5 border border-success/20">
                        <View className="flex-row items-center gap-1.5">
                          <Check size={16} color="#00864d" />
                          <Text className="text-sm font-inter-bold text-success">
                            Incluye
                          </Text>
                        </View>
                        <Text className="mt-1.5 text-xs text-foreground/80">
                          {excursion.incluye}
                        </Text>
                      </View>
                    )}
                    {excursion.noIncluye && (
                      <View className="rounded-xl bg-destructive/10 p-3.5 border border-destructive/20">
                        <View className="flex-row items-center gap-1.5">
                          <X size={16} color="#e7000b" />
                          <Text className="text-sm font-inter-bold text-destructive">
                            No incluye
                          </Text>
                        </View>
                        <Text className="mt-1.5 text-xs text-foreground/80">
                          {excursion.noIncluye}
                        </Text>
                      </View>
                    )}
                  </View>
                )}

                {/* Políticas */}
                {excursion.politicas && (
                  <View className="rounded-xl bg-info/10 p-3.5 border border-info/20">
                    <View className="flex-row items-center gap-1.5">
                      <Shield size={16} color="#00809b" />
                      <Text className="text-sm font-inter-bold text-info">
                        Políticas y recomendaciones
                      </Text>
                    </View>
                    <Text className="mt-1.5 text-xs text-foreground/80">
                      {excursion.politicas}
                    </Text>
                  </View>
                )}
              </View>
            )}

            {/* Detalles del pasaje */}
            <View className="p-4 gap-4">
              <Text className="text-xs font-inter-bold uppercase tracking-wider text-muted-foreground">
                Detalles del Pasaje
              </Text>

              {/* Fecha y hora */}
              <View className="flex-row gap-3">
                <View className="flex-1 flex-row items-center gap-3 p-3 rounded-xl bg-muted/40">
                  <View className="h-9 w-9 rounded-lg bg-background items-center justify-center">
                    <CalendarDays size={20} color="#0284c7" />
                  </View>
                  <View>
                    <Text className="text-xs font-inter-bold uppercase text-muted-foreground">
                      Fecha
                    </Text>
                    <Text className="text-sm font-inter-semibold text-foreground">
                      {formatDate(reserva.fecha, { moneda })}
                    </Text>
                  </View>
                </View>
                {reserva.hora && (
                  <View className="flex-1 flex-row items-center gap-3 p-3 rounded-xl bg-muted/40">
                    <View className="h-9 w-9 rounded-lg bg-background items-center justify-center">
                      <Clock size={20} color="#0284c7" />
                    </View>
                    <View>
                      <Text className="text-xs font-inter-bold uppercase text-muted-foreground">
                        Hora
                      </Text>
                      <Text className="text-sm font-inter-semibold text-foreground">
                        {reserva.hora}
                      </Text>
                    </View>
                  </View>
                )}
              </View>

              {/* Pasajeros */}
              <View className="flex-row items-center gap-3 p-3 rounded-xl bg-muted/40">
                <View className="h-9 w-9 rounded-lg bg-background items-center justify-center">
                  <Users size={20} color="#0284c7" />
                </View>
                <View>
                  <Text className="text-xs font-inter-bold uppercase text-muted-foreground">
                    Desglose de pasajeros
                  </Text>
                  <Text className="text-sm font-inter-semibold text-foreground">
                    {reserva.adultos} adulto{reserva.adultos !== 1 ? 's' : ''}
                    {reserva.ninos > 0 && `, ${reserva.ninos} niño${reserva.ninos !== 1 ? 's' : ''}`}
                  </Text>
                </View>
              </View>

              {/* Check-in de pasajeros */}
              {reserva.pasajeros && reserva.pasajeros.length > 0 && (
                <View>
                  <Text className="mb-2 text-xs font-inter-bold uppercase tracking-wider text-muted-foreground">
                    Check-in de pasajeros:
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    {reserva.pasajeros.map((p, i) => (
                      <View
                        key={p.id}
                        className="flex-row items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1"
                      >
                        <Text className="text-xs font-inter-semibold text-foreground">
                          {p.tipo === 'ADULTO' ? 'Adulto' : 'Niño'} #{i + 1}
                        </Text>
                        {p.presente && (
                          <Text className="text-xs font-inter-bold text-success">
                            ✓ Embarcado
                          </Text>
                        )}
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {/* Notas */}
              {reserva.notas && (
                <View className="rounded-xl bg-muted/50 p-3.5 border border-border/60">
                  <Text className="text-xs font-inter-bold uppercase text-muted-foreground mb-1">
                    Notas / Solicitudes Especiales
                  </Text>
                  <Text className="text-xs text-foreground/90">{reserva.notas}</Text>
                </View>
              )}
            </View>

            {/* Resumen de pago */}
            <View className="border-t border-border bg-muted/20 p-4 gap-3">
              <Text className="text-xs font-inter-bold uppercase tracking-wider text-muted-foreground">
                Resumen de Pago
              </Text>
              <View className="gap-2">
                <View className="flex-row justify-between">
                  <Text className="text-xs text-muted-foreground">Subtotal</Text>
                  <Text
                    className="text-xs font-inter-semibold text-foreground"
                    style={{ fontVariant: ['tabular-nums'] }}
                  >
                    {formatMoney(Number(reserva.subtotal), { moneda })}
                  </Text>
                </View>
                {Number(reserva.descuento) > 0 && (
                  <View className="flex-row justify-between">
                    <Text className="text-xs text-success">Descuento aplicado</Text>
                    <Text
                      className="text-xs font-inter-semibold text-success"
                      style={{ fontVariant: ['tabular-nums'] }}
                    >
                      -{formatMoney(Number(reserva.descuento), { moneda })}
                    </Text>
                  </View>
                )}
                {Number(reserva.impuestos) > 0 && (
                  <View className="flex-row justify-between">
                    <Text className="text-xs text-muted-foreground">Impuestos incluidos</Text>
                    <Text
                      className="text-xs font-inter-semibold text-muted-foreground"
                      style={{ fontVariant: ['tabular-nums'] }}
                    >
                      {formatMoney(Number(reserva.impuestos), { moneda })}
                    </Text>
                  </View>
                )}
                <View className="flex-row justify-between pt-2 border-t border-border/60">
                  <Text className="text-sm font-inter-bold text-foreground">Total</Text>
                  <Text
                    className="text-sm font-inter-bold text-foreground"
                    style={{ fontVariant: ['tabular-nums'] }}
                  >
                    {formatMoney(Number(reserva.total), { moneda })}
                  </Text>
                </View>
              </View>

              {/* Saldo pendiente */}
              {!saldo.liquidada && (
                <View className="mt-4 rounded-xl bg-warning/15 p-3.5 border border-warning/25">
                  <View className="flex-row items-center gap-2">
                    <CreditCard size={16} color="#ab6300" />
                    <Text className="text-xs font-inter-bold text-warning">
                      Saldo pendiente: {formatMoney(saldo.saldo, { moneda })}
                    </Text>
                  </View>
                  <Text className="mt-1 text-xs text-warning/90">
                    Puedes liquidar el saldo pendiente antes de abordar.
                  </Text>
                </View>
              )}

              {/* Pagos realizados */}
              {reserva.pagos && reserva.pagos.length > 0 && (
                <View className="mt-4 pt-3 border-t border-border/40">
                  <Text className="text-xs font-inter-bold uppercase tracking-wider text-muted-foreground mb-2">
                    Comprobantes de pago
                  </Text>
                  <View className="gap-1.5">
                    {reserva.pagos.map((pago) => (
                      <View
                        key={pago.id}
                        className="flex-row items-center justify-between p-2.5 rounded-xl bg-background border border-border"
                      >
                        <Text className="text-xs text-muted-foreground">
                          {formatDate(pago.createdAt, { moneda })}
                        </Text>
                        <Text
                          className="text-xs font-inter-bold text-success"
                          style={{ fontVariant: ['tabular-nums'] }}
                        >
                          +{formatMoney(Number(pago.monto), { moneda })}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>
          </Card>

          {/* CTAs */}
          <View className="flex-row gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onPress={() => router.push('/mis-excursiones')}
            >
              Volver a mis excursiones
            </Button>
            <Button className="flex-1" onPress={() => router.push('/explorar')}>
              Explorar más
            </Button>
          </View>
        </DetailPageFrame>
      </ScrollView>
    </View>
  );
}

export default function MisExcursionDetalleScreen() {
  return (
    <ResponsiveDetailSheet>
      <MisExcursionDetalleScreenContent />
    </ResponsiveDetailSheet>
  )
}

import React from 'react';
import { ResponsiveDetailSheet, useResponsiveDetailSheetBackgroundClass } from '../src/components/ui/ResponsiveDetailSheet';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  CreditCard,
  ArrowRightLeft,
  XCircle,
  Receipt,
  Sparkles,
  AlertCircle,
} from 'lucide-react-native';
import { useAuth } from '../src/lib/auth-context';
import { usePagos } from '../src/hooks/usePagos';
import { formatMoney, formatDate } from '../src/lib/format';
import { cn } from '../src/lib/cn';
import { Button } from '../src/components/ui/Button';
import { Card } from '../src/components/ui/Card';
import { EmptyState } from '../src/components/ui/EmptyState';
import { PageHeader } from '../src/components/ui/PageHeader';
import { Skeleton } from '../src/components/ui/Skeleton';
import { BillingCycleHeader } from '../src/components/cliente/pagos/BillingCycleHeader';
import { PagosLedger } from '../src/components/cliente/pagos/PagosLedger';
import { ComprobanteLink } from '../src/components/pagos/ComprobanteLink';

/* ── Constants ─────────────────────────────────────────────────────────── */

const NECESITA_PAGO = ['PENDIENTE', 'RECHAZADA'];

/** Color del micro-punto de estado según la variante semántica del estado. */
const DOT_COLOR: Record<string, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  info: 'bg-info',
  destructive: 'bg-destructive',
  secondary: 'bg-muted-foreground',
};

/**
 * Aviso del retorno de la pasarela (`?pago=`). Lo escribe /api/pagos/cardnet/retorno.
 * Port RN de `src/app/(cliente)/cliente/pagos/page.tsx`.
 */
const AVISO_PAGO: Record<
  string,
  { tono: string; titulo: string; texto: string }
> = {
  ok: {
    tono: 'border-success/30 bg-success/10',
    titulo: 'Pago aprobado',
    texto: 'Tu compra ya está activa. Puedes usarla desde tus beneficios.',
  },
  rechazado: {
    tono: 'border-destructive/30 bg-destructive/10',
    titulo: 'Pago rechazado',
    texto:
      'El banco no aprobó la transacción. No se te cobró nada. Puedes intentar con otra tarjeta.',
  },
  pendiente: {
    tono: 'border-warning/30 bg-warning/10',
    titulo: 'Estamos confirmando tu pago',
    texto:
      'No pudimos confirmar el resultado con el banco todavía. No vuelvas a pagar: si el cobro se realizó, tu compra se activará sola y te avisaremos.',
  },
  error: {
    tono: 'border-warning/30 bg-warning/10',
    titulo: 'No pudimos procesar el retorno',
    texto:
      'Si crees que se te cobró, escríbenos con la fecha y hora antes de intentar de nuevo.',
  },
};

/** Mapea estado de membresía a variante de dot. */
function getEstadoVariant(estado: string): string {
  if (estado === 'ACTIVA') return 'success';
  if (estado === 'PENDIENTE' || estado === 'PENDIENTE_PAGO') return 'warning';
  if (estado === 'RECHAZADA') return 'destructive';
  if (estado === 'VENCIDA' || estado === 'CANCELADA') return 'secondary';
  return 'secondary';
}

/** Label legible para el estado de membresía. */
function getEstadoLabel(estado: string): string {
  const labels: Record<string, string> = {
    ACTIVA: 'Activa',
    PENDIENTE: 'Pendiente',
    PENDIENTE_PAGO: 'Esperando pago',
    VENCIDA: 'Vencida',
    RECHAZADA: 'Rechazada',
    CANCELADA: 'Cancelada',
  };
  return labels[estado] ?? estado;
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  return formatDate(d);
}

/* ── Sub-components ────────────────────────────────────────────────────── */

/**
 * Micro-badge de estado minimalista (`● Activa`): la mitad de tamaño que un
 * badge tradicional.
 */
function EstadoDot({ estado }: { estado: string }) {
  const variant = getEstadoVariant(estado);
  const label = getEstadoLabel(estado);

  return (
    <View className="flex-row items-center gap-1.5">
      <View
        className={cn('h-2 w-2 rounded-full', DOT_COLOR[variant])}
      />
      <Text className="text-xs font-inter-semibold text-foreground">
        {label}
      </Text>
    </View>
  );
}

/* ── Screen ────────────────────────────────────────────────────────────── */

function PagosScreenContent() {
  const sheetBackgroundClass = useResponsiveDetailSheetBackgroundClass('bg-vibe-fondo')
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const params = useLocalSearchParams<{ pago?: string }>();
  const { data, isLoading, isError, refetch } = usePagos(isAuthenticated);

  const aviso = params.pago ? AVISO_PAGO[params.pago] : undefined;
  const membership = data?.membership ?? null;
  const historial = data?.historial ?? [];
  const necesitaPago = membership ? NECESITA_PAGO.includes(membership.estado) : false;
  const cambioPendiente = !!membership?.planSolicitadoNombre;

  /* ── Auth gate ─────────────────────────────────────────────────────── */
  if (!isAuthenticated) {
    return (
      <View className={sheetBackgroundClass === 'bg-surface-card' ? "flex-1 items-center justify-center bg-surface-card p-6" : "flex-1 items-center justify-center bg-vibe-fondo p-6"}>
        <View className="h-16 w-16 items-center justify-center rounded-full bg-primary/20 mb-4">
          <Receipt size={32} color="#0284c7" />
        </View>
        <Text className="text-xl font-inter-bold text-foreground mb-2 text-center">
          Inicia sesión para ver tus pagos
        </Text>
        <Text className="text-sm text-muted-foreground mb-6 text-center max-w-xs">
          Tu plan, tu ciclo y cada pago. Todo claro, sin sorpresas.
        </Text>
        <Button onPress={() => router.push('/(auth)/login')}>
          Iniciar Sesión
        </Button>
      </View>
    );
  }

  /* ── Loading ───────────────────────────────────────────────────────── */
  if (isLoading) {
    return (
      <View className={sheetBackgroundClass === 'bg-surface-card' ? "flex-1 bg-surface-card" : "flex-1 bg-vibe-fondo"}>
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16 }}
        >
          <View className="mb-6">
            <Skeleton className="mb-2 h-4 w-20" />
            <Skeleton className="mb-2 h-8 w-48" />
            <Skeleton className="h-4 w-64" />
          </View>
          <Skeleton className="mb-4 h-48 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
        </ScrollView>
      </View>
    );
  }

  /* ── Error ─────────────────────────────────────────────────────────── */
  if (isError) {
    return (
      <View className={sheetBackgroundClass === 'bg-surface-card' ? "flex-1 bg-surface-card" : "flex-1 bg-vibe-fondo"}>
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16 }}
        >
          <EmptyState
            icon={<AlertCircle size={40} color="#e7000b" />}
            title="No pudimos cargar tus pagos"
            description="Intenta de nuevo en unos momentos."
            action={
              <Button variant="outline" onPress={() => refetch()}>
                Reintentar
              </Button>
            }
          />
        </ScrollView>
      </View>
    );
  }

  /* ── Empty (sin membresía) ─────────────────────────────────────────── */
  if (!membership) {
    return (
      <View className={sheetBackgroundClass === 'bg-surface-card' ? "flex-1 bg-surface-card" : "flex-1 bg-vibe-fondo"}>
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16 }}
        >
          {/* Aviso gateway (si aplica) */}
          {aviso && <AvisoBanner aviso={aviso} />}

          <PageHeader
            eyebrow={
              <Text className="text-xs font-inter-semibold uppercase tracking-widest text-primary">
                Finanzas
              </Text>
            }
            title="Mis pagos"
            description="Tu plan, tu ciclo y cada pago. Todo claro, sin sorpresas."
            action={
              <Button
                variant="outline"
                size="sm"
                onPress={() => router.push('/mis-membresias')}
                icon={<ArrowLeft size={16} color="#111827" />}
              >
                Mis membresías
              </Button>
            }
          />

          <EmptyState
            icon={<Receipt size={40} color="#0284c7" />}
            title="Sin pagos todavía"
            description="Selecciona un plan para comenzar tu membresía y aquí verás todos tus pagos."
            action={
              <Button
                onPress={() => router.push('/planes')}
                icon={<Sparkles size={16} color="#ffffff" />}
              >
                Ver planes
              </Button>
            }
          />
        </ScrollView>
      </View>
    );
  }

  /* ── Data ──────────────────────────────────────────────────────────── */
  return (
    <View className={sheetBackgroundClass === 'bg-surface-card' ? "flex-1 bg-surface-card" : "flex-1 bg-vibe-fondo"}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16 }}
      >
        {/* Aviso gateway (si aplica) */}
        {aviso && <AvisoBanner aviso={aviso} />}

        <PageHeader
          eyebrow={
            <Text className="text-xs font-inter-semibold uppercase tracking-widest text-primary">
              Finanzas
            </Text>
          }
          title="Mis pagos"
          description="Tu plan, tu ciclo y cada pago. Todo claro, sin sorpresas."
          action={
            <Button
              variant="outline"
              size="sm"
              onPress={() => router.push('/mis-membresias')}
              icon={<ArrowLeft size={16} color="#111827" />}
            >
              Mis membresías
            </Button>
          }
        />

        {/* ── Membresía actual: panel de suscripción estilo Stripe Billing ─ */}
        <Card className="mb-8 p-0">
          {/* Header row */}
          <View className="flex-row items-center justify-between border-b border-border/40 px-5 py-3">
            <Text className="text-sm font-inter-semibold text-muted-foreground">
              Membresía actual
            </Text>
            <EstadoDot estado={membership.estado} />
          </View>

          <View className="p-5">
            {/* Plan + monto */}
            <View className="mb-6 flex-row items-baseline justify-between">
              <Text className="flex-1 text-xl font-inter-bold text-foreground">
                {membership.planNombre}
              </Text>
              {membership.montoPagado != null ? (
                <Text className="font-inter-bold text-2xl tabular-nums text-foreground">
                  {formatMoney(membership.montoPagado)}
                </Text>
              ) : null}
            </View>

            {/* Ciclo de facturación */}
            <View className="mb-6">
              <BillingCycleHeader
                items={[
                  {
                    label: 'Ciclo de facturación',
                    value:
                      membership.fechaInicio || membership.fechaVencimiento
                        ? `${fmtDate(membership.fechaInicio)} – ${fmtDate(membership.fechaVencimiento)}`
                        : '—',
                  },
                  {
                    label: 'Método',
                    value: membership.metodoPagoNombre ?? '—',
                  },
                  {
                    label: 'Próximo cobro',
                    value:
                      membership.estado === 'ACTIVA'
                        ? fmtDate(membership.fechaVencimiento)
                        : '—',
                  },
                ]}
              />
            </View>

            {/* Comprobante */}
            {membership.comprobanteUrl ? (
              <View className="mb-4">
                <ComprobanteLink url={membership.comprobanteUrl} />
              </View>
            ) : null}

            {/* Motivo de rechazo */}
            {membership.estado === 'RECHAZADA' && membership.rechazadoReason ? (
              <View className="mb-4 rounded-xl border border-destructive/25 bg-destructive/5 p-3.5">
                <Text className="text-sm text-destructive">
                  <Text className="font-inter-bold">Motivo del rechazo: </Text>
                  {membership.rechazadoReason}
                </Text>
              </View>
            ) : null}

            {/* Cambio pendiente */}
            {cambioPendiente ? (
              <View className="mb-4 flex-row items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3.5">
                <View className="h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <ArrowRightLeft size={16} color="#0284c7" />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-inter-semibold text-foreground">
                    Cambio a {membership.planSolicitadoNombre} solicitado
                  </Text>
                  <Text className="mt-0.5 text-sm text-muted-foreground">
                    Sube el comprobante del nuevo plan para que el equipo lo apruebe.
                  </Text>
                </View>
              </View>
            ) : null}

            {/* CTA de pago */}
            {/* ponytail: CTA real (Cardnet) es integración externa — fuera de alcance.
                El botón navega a la pantalla de membresía para completar el pago.
                Cuando se integre Cardnet, reemplazar router.push con la llamada al SDK. */}
            {necesitaPago || cambioPendiente ? (
              <Button
                variant="premium"
                onPress={() => router.push(`/membresia/${membership.id}`)}
                icon={<CreditCard size={16} color="#ffffff" />}
              >
                {membership.estado === 'RECHAZADA'
                  ? 'Reenviar comprobante'
                  : cambioPendiente
                    ? 'Subir comprobante del cambio'
                    : 'Completar pago'}
              </Button>
            ) : null}
          </View>
        </Card>

        {/* ── Historial ─────────────────────────────────────────────── */}
        <View className="mb-4 flex-row items-center gap-2">
          <Text className="text-lg font-inter-bold text-foreground">
            Historial de pagos
          </Text>
          {historial.length > 0 ? (
            <View className="rounded-full bg-muted px-2 py-0.5">
              <Text className="text-xs font-inter-semibold text-muted-foreground">
                {historial.length}
              </Text>
            </View>
          ) : null}
        </View>

        <PagosLedger items={historial} />
      </ScrollView>
    </View>
  );
}

/* ── Aviso Banner ──────────────────────────────────────────────────────── */

function AvisoBanner({
  aviso,
}: {
  aviso: { tono: string; titulo: string; texto: string };
}) {
  const textColor = aviso.tono.includes('success')
    ? '#00864d'
    : aviso.tono.includes('destructive')
      ? '#e7000b'
      : '#ab6300';

  return (
    <View
      className={cn('mb-6 rounded-2xl border p-4', aviso.tono)}
    >
      <Text className="font-inter-bold" style={{ color: textColor }}>
        {aviso.titulo}
      </Text>
      <Text
        className="mt-1 text-sm opacity-90"
        style={{ color: textColor }}
      >
        {aviso.texto}
      </Text>
    </View>
  );
}

export default function PagosScreen() {
  return (
    <ResponsiveDetailSheet>
      <PagosScreenContent />
    </ResponsiveDetailSheet>
  )
}

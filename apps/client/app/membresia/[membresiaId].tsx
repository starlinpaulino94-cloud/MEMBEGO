import React, { useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ResponsiveDetailSheet, useIsResponsiveDetailSheet, useResponsiveDetailSheetBackgroundClass } from '../../src/components/ui/ResponsiveDetailSheet'
import {
  ActivityIndicator,
  View,
  Text,
  ScrollView,
  Pressable,
  Share,
  Alert,
  useWindowDimensions,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { goBackOr } from '../../src/lib/navigation'
import { ArrowLeft, History, Car, Clock, Calendar, Share2, Download, ArrowRightLeft, CreditCard } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import QRCode from 'react-native-qrcode-svg'
import { useAuth } from '../../src/lib/auth-context'
import { useMembresias } from '../../src/hooks/useMembresias'
import { useHistorial } from '../../src/hooks/useHistorial'
import { Button } from '../../src/components/ui/Button'
import { DetailPageFrame } from '../../src/components/ui/DetailPageFrame'
import { Skeleton } from '../../src/components/ui/Skeleton'
import { BackHeader } from '../../src/components/ui/BackHeader'
import { brandColor, brandDisplayForeground, hasBrandColor } from '../../src/lib/brand-color'
import { api } from '../../src/lib/api'
import type { CardnetCaptureSession, CardnetPaymentStatus } from '../../src/lib/api'
import { CardnetCapture } from '../../src/components/pagos/cardnet/Capture'
import {
  CardnetActivationForm,
  CardnetCaptureError,
  CardnetPaymentStatusMessage,
  RenewalConsent,
} from '../../src/components/pagos/cardnet/primitives'
import { ComprobanteMembresiaForm } from '../../src/components/pagos/ComprobanteMembresiaForm'
import {
  isCardnetServerApproved,
  membershipCardnetStartAction,
  membershipCardnetTarget,
} from '../../src/lib/cardnet-membership-checkout'

const ESTADO_LABEL: Record<string, string> = {
  ACTIVA: 'Activa',
  PENDIENTE: 'Esperando pago',
  PENDIENTE_PAGO: 'Esperando pago',
  VENCIDA: 'Vencida',
  CANCELADA: 'Cancelada',
  RECHAZADA: 'Rechazada',
}

interface Membership {
  id: string
  planNombre: string
  companyName: string
  companyLogoUrl?: string | null
  companyColorPrimario?: string | null
  estado: string
  lavadosRestantes?: number | null
  planLavadosIncluidos?: number | null
  qrToken?: string | null
  fechaInicio?: string | null
  fechaVencimiento?: string | null
}

interface Visita {
  id: string
  fecha: string
  sucursal?: string | null
  servicio?: string | null
  vehiculo?: {
    marca?: string
    modelo?: string
  } | null
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  try {
    const date = new Date(dateStr)
    return new Intl.DateTimeFormat('es', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(date)
  } catch {
    return dateStr
  }
}

function formatDateLong(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  try {
    const date = new Date(dateStr)
    return new Intl.DateTimeFormat('es-DO', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date)
  } catch {
    return dateStr
  }
}

function getDaysRemaining(fechaVencimiento: string | null | undefined): number | null {
  if (!fechaVencimiento) return null
  try {
    const now = new Date()
    const venc = new Date(fechaVencimiento)
    const diff = Math.ceil((venc.getTime() - now.getTime()) / 86_400_000)
    return diff > 0 ? diff : 0
  } catch {
    return null
  }
}

function getStatusChipStyle(estado: string) {
  const upper = estado.toUpperCase()
  if (upper === 'ACTIVA') {
    return 'bg-success/15 border-success/30'
  }
  if (upper.startsWith('PENDIENTE')) {
    return 'bg-warning/15 border-warning/30'
  }
  if (upper === 'VENCIDA' || upper === 'CANCELADA') {
    return 'bg-destructive/10 border-destructive/30'
  }
  return 'bg-muted border-border'
}

function getStatusTextColor(estado: string) {
  const upper = estado.toUpperCase()
  if (upper === 'ACTIVA') {
    return 'text-success'
  }
  if (upper.startsWith('PENDIENTE')) {
    return 'text-warning'
  }
  if (upper === 'VENCIDA' || upper === 'CANCELADA') {
    return 'text-destructive'
  }
  return 'text-muted-foreground'
}

function isUnlimited(m: Membership): boolean {
  return (
    m.planLavadosIncluidos === null ||
    m.planLavadosIncluidos === undefined ||
    m.planLavadosIncluidos < 0 ||
    m.lavadosRestantes === null ||
    m.lavadosRestantes === undefined ||
    m.lavadosRestantes < 0
  )
}

function MembresiaDetailScreenContent() {
  const sheetBackgroundClass = useResponsiveDetailSheetBackgroundClass('bg-vibe-fondo')
  const isResponsiveDetailSheet = useIsResponsiveDetailSheet()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const isDetailSheet = width >= 768 && router.canGoBack()
  const routeParams = useLocalSearchParams<{ membresiaId: string | string[] }>()
  const membresiaId = Array.isArray(routeParams.membresiaId) ? routeParams.membresiaId[0] : routeParams.membresiaId
  const { isAuthenticated } = useAuth()
  const queryClient = useQueryClient()
  const [cardnetSession, setCardnetSession] = useState<CardnetCaptureSession | null>(null)
  const [cardnetRecoverySessionId, setCardnetRecoverySessionId] = useState<string | null>(null)
  const [cardnetRecoveryRetryAvailable, setCardnetRecoveryRetryAvailable] = useState(false)
  const [cardnetActivationSubmitting, setCardnetActivationSubmitting] = useState(false)
  const [cardnetActivationError, setCardnetActivationError] = useState<string | null>(null)
  const [cardnetStatus, setCardnetStatus] = useState<CardnetPaymentStatus | null>(null)
  const [cardnetStarting, setCardnetStarting] = useState(false)
  const [cardnetError, setCardnetError] = useState<string | null>(null)
  const [renewalConsent, setRenewalConsent] = useState(false)
  const cardnetStartInFlightRef = useRef(false)
  const cardnetRecoveryPollAttemptsRef = useRef(0)
  const { data: membresiasData, isLoading: loadingMembresias } =
    useMembresias(isAuthenticated)
  const { data: historialData } = useHistorial(1, isAuthenticated)
  const { data: pagoData } = useQuery({
    queryKey: ['cliente', 'membresia-pago', membresiaId],
    queryFn: () => api.getMembresiaPago(membresiaId),
    enabled: isAuthenticated && !!membresiaId,
  })
  const cardnetRecoveryQueryKey = ['cliente', 'cardnet-session-status', cardnetRecoverySessionId] as const
  const cardnetRecoveryQuery = useQuery({
    queryKey: cardnetRecoveryQueryKey,
    queryFn: () => api.getCardnetStatus(cardnetRecoverySessionId ?? ''),
    enabled: isAuthenticated && !!cardnetRecoverySessionId,
  })
  const cardnetRecoveryStatus = cardnetRecoveryQuery.data

  const handleCardnetStatusChange = React.useCallback((status: CardnetPaymentStatus) => {
    setCardnetStatus(status)
    if (!isCardnetServerApproved(status)) return

    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ['cliente', 'membresias'] }),
      queryClient.invalidateQueries({ queryKey: ['cliente', 'membresia-pago', membresiaId] }),
    ])
  }, [membresiaId, queryClient])

  React.useEffect(() => {
    if (cardnetRecoveryStatus) handleCardnetStatusChange(cardnetRecoveryStatus)
  }, [cardnetRecoveryStatus, handleCardnetStatusChange])

  React.useEffect(() => {
    if (
      !cardnetRecoverySessionId ||
      (cardnetRecoveryStatus !== undefined && cardnetRecoveryStatus.status !== 'pending') ||
      cardnetRecoveryRetryAvailable
    ) {
      return
    }

    const interval = setInterval(() => {
      if (cardnetRecoveryPollAttemptsRef.current >= 18) {
        clearInterval(interval)
        setCardnetRecoveryRetryAvailable(true)
        return
      }

      cardnetRecoveryPollAttemptsRef.current += 1
      void cardnetRecoveryQuery.refetch()
    }, 2500)

    return () => clearInterval(interval)
  }, [
    cardnetRecoveryQuery.refetch,
    cardnetRecoveryRetryAvailable,
    cardnetRecoverySessionId,
    cardnetRecoveryStatus?.status,
  ])

  const membresia = useMemo(() => {
    const memberships = membresiasData?.membresias ?? []
    return memberships.find((m) => m.id === membresiaId)
  }, [membresiasData, membresiaId])

  const visitas: Visita[] = useMemo(() => {
    return historialData?.visitas ?? []
  }, [historialData])

  if (!isAuthenticated) {
    return (
      <View className={sheetBackgroundClass === 'bg-surface-card' ? "flex-1 items-center justify-center bg-surface-card p-6" : "flex-1 items-center justify-center bg-vibe-fondo p-6"}>
        <Text className="text-lg font-bold text-foreground mb-4">
          Inicia sesión para ver el detalle
        </Text>
        <Button onPress={() => router.push('/(auth)/login')}>
          Iniciar Sesión
        </Button>
      </View>
    )
  }

  if (loadingMembresias) {
    return (
      <ScrollView
        className={sheetBackgroundClass === 'bg-surface-card' ? "flex-1 bg-surface-card" : "flex-1 bg-vibe-fondo"}
        contentContainerStyle={{ padding: 16, paddingTop: isResponsiveDetailSheet ? 8 : insets.top + 8 }}
        showsVerticalScrollIndicator={false}
      >
        <Skeleton className="h-8 w-32 mb-4" />
        <Skeleton className="h-12 w-full mb-6" />
        <Skeleton className="h-[300px] rounded-2xl mb-6" />
        <Skeleton className="h-[200px] rounded-xl" />
      </ScrollView>
    )
  }

  if (!membresia) {
    return (
      <ScrollView
        className={sheetBackgroundClass === 'bg-surface-card' ? "flex-1 bg-surface-card" : "flex-1 bg-vibe-fondo"}
        contentContainerStyle={{ padding: 16, paddingTop: isResponsiveDetailSheet ? 8 : insets.top + 8 }}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          onPress={() => goBackOr(router, '/mis-membresias')}
          className="flex-row items-center gap-1.5 mb-4"
        >
          <ArrowLeft size={20} color="#4b5563" />
          <Text className="text-sm text-muted-foreground">Volver</Text>
        </Pressable>
        <View className="flex-1 items-center justify-center py-16">
          <Text className="text-lg font-semibold text-muted-foreground">
            Membresía no encontrada
          </Text>
        </View>
      </ScrollView>
    )
  }

  const statusChipStyle = getStatusChipStyle(membresia.estado)
  const statusTextColor = getStatusTextColor(membresia.estado)
  const unlimited = isUnlimited(membresia)
  const daysRemaining = getDaysRemaining(membresia.fechaVencimiento)
  const companyAccent = brandColor(membresia.companyColorPrimario, '#0284c7')
  const hasCompanyColor = hasBrandColor(membresia.companyColorPrimario)
  const estadoLabel = ESTADO_LABEL[membresia.estado] ?? membresia.estado
  const isActive = membresia.estado === 'ACTIVA' && (!membresia.fechaVencimiento || new Date(membresia.fechaVencimiento) > new Date())
  const showQr = isActive && !!membresia.qrToken
  const pagoDetalle = pagoData?.membresia
  const pagoPendiente = pagoData?.pago
  const planCambio = pagoDetalle?.planSolicitado
  const permiteAdjuntar = (membresia.estado === 'PENDIENTE' || membresia.estado === 'RECHAZADA' || !!planCambio) &&
    (!pagoDetalle?.tieneComprobante || membresia.estado === 'RECHAZADA' || (!!planCambio && !!pagoDetalle?.rechazadoReason))

  const puedePagarConCardnet = !!pagoPendiente && !!pagoDetalle && permiteAdjuntar
  const permiteConsentimientoRenovacion = !planCambio &&
    (membresia.estado === 'PENDIENTE' || membresia.estado === 'PENDIENTE_PAGO' || membresia.estado === 'RECHAZADA')

  const startCardnetCheckout = async () => {
    if (!puedePagarConCardnet || cardnetStartInFlightRef.current) return

    cardnetStartInFlightRef.current = true
    setCardnetStarting(true)
    setCardnetError(null)
    setCardnetStatus(null)
    setCardnetSession(null)
    setCardnetRecoverySessionId(null)
    setCardnetRecoveryRetryAvailable(false)
    setCardnetActivationError(null)
    cardnetRecoveryPollAttemptsRef.current = 0

    try {
      const result = await api.startCardnetSession(
        membershipCardnetTarget(membresia.id, permiteConsentimientoRenovacion, renewalConsent),
      )
      const action = membershipCardnetStartAction(result)
      if (action.kind === 'resume') {
        queryClient.removeQueries({
          queryKey: ['cliente', 'cardnet-session-status', action.sessionId],
          exact: true,
        })
        setCardnetRecoverySessionId(action.sessionId)
      } else {
        setCardnetSession(action.session)
      }
    } catch (error) {
      setCardnetError(error instanceof Error ? error.message : 'Intenta de nuevo en unos minutos.')
    } finally {
      cardnetStartInFlightRef.current = false
      setCardnetStarting(false)
    }
  }

  const retryCardnetRecoveryStatus = () => {
    cardnetRecoveryPollAttemptsRef.current = 0
    setCardnetRecoveryRetryAvailable(false)
    void cardnetRecoveryQuery.refetch()
  }

  const activateRecoveredCardnetPayment = async (activationCode: string) => {
    if (!cardnetRecoverySessionId || cardnetActivationSubmitting) return

    setCardnetActivationSubmitting(true)
    setCardnetActivationError(null)
    try {
      const status = await api.activateCardnetProfile({
        sessionId: cardnetRecoverySessionId,
        activationCode,
      })
      queryClient.setQueryData(cardnetRecoveryQueryKey, status)
      if (status.status === 'activation_required') {
        setCardnetActivationError('El código no fue confirmado. Verifica el mensaje de tu banco e inténtalo de nuevo.')
      }
    } catch {
      setCardnetActivationError('No pudimos confirmar la activación. Revisa tu conexión e inténtalo de nuevo.')
    } finally {
      setCardnetActivationSubmitting(false)
    }
  }

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Mi membresía en ${membresia.companyName} — Plan ${membresia.planNombre}`,
      })
    } catch { /* dismissed */ }
  }

  const handleDownload = () => {
    Alert.alert(
      'Descargar QR',
      'La descarga del QR como imagen estará disponible próximamente.'
    )
  }

  const handleCancel = () => {
    Alert.alert(
      'Cancelar membresía',
      'La cancelación de membresía estará disponible próximamente.',
      [{ text: 'Entendido' }]
    )
  }

  return (
    <View className={sheetBackgroundClass === 'bg-surface-card' ? "flex-1 bg-surface-card" : "flex-1 bg-vibe-fondo"}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingTop: isResponsiveDetailSheet ? 8 : insets.top + 8, paddingBottom: 16 }}
        showsVerticalScrollIndicator={false}
      >
        <DetailPageFrame>
          <BackHeader
            className="mb-6"
            safeAreaTop={false}
            title={
              <View className="flex-row items-start justify-between">
                <View className="flex-1 mr-4">
                  <Text className="text-xs uppercase tracking-widest text-muted-foreground mb-1 font-inter-semibold" style={hasCompanyColor ? { color: companyAccent } : undefined}>
                    {membresia.companyName}
                  </Text>
                  <Text className="text-[28px] font-inter-extrabold text-foreground leading-tight">
                    {membresia.planNombre}
                  </Text>
                </View>
                <View className={`rounded-full px-3 py-1 border ${statusChipStyle}`}>
                  <Text className={`text-xs font-inter-semibold ${statusTextColor}`}>
                    {estadoLabel}
                  </Text>
                </View>
              </View>
            }
            leftInset={insets.left}
            onBack={() => goBackOr(router, '/mis-membresias')}
            border={false}
          />

          <View className="rounded-2xl border border-border/60 bg-card py-6 px-5 items-center mb-6">
            <Text className="text-lg font-inter-bold text-foreground mb-1.5 text-center">
              Tu llave de acceso
            </Text>
            <Text className="text-sm text-muted-foreground text-center mb-4 leading-5 px-2">
              Muéstralo en {membresia.companyName} y listo: tu membresía se valida al instante.
            </Text>

            {daysRemaining !== null && daysRemaining <= 7 && (
              <View className="flex-row items-center gap-1.5 rounded-full bg-warning/10 border border-warning/30 px-3.5 py-1.5 mb-5">
                <Clock size={14} color="#ab6300" />
                <Text className="text-sm font-inter-semibold text-warning">
                  {daysRemaining === 0 ? 'Vence hoy' : `Te quedan ${daysRemaining} ${daysRemaining === 1 ? 'día' : 'días'}`}
                </Text>
              </View>
            )}

            {showQr ? (
              <>
                {/* QR Frame */}
                <View className="rounded-[28px] p-[3px] mb-5">
                  <LinearGradient
                    colors={hasCompanyColor ? [companyAccent, companyAccent] : ['#10b981', '#2dd4bf', '#059669']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={{ borderRadius: 28, padding: 3 }}
                  >
                    <View className="bg-card rounded-2xl p-4 items-center justify-center">
                      <QRCode
                        value={membresia.qrToken!}
                        size={220}
                        color="#0f172a"
                        backgroundColor="#ffffff"
                      />
                    </View>
                  </LinearGradient>
                </View>

                <View className="flex-row gap-3 w-full">
                  <Pressable
                    onPress={handleShare}
                    className="flex-1 flex-row items-center justify-center gap-2 h-11 rounded-xl bg-primary active:opacity-90"
                    style={hasCompanyColor ? { backgroundColor: companyAccent } : undefined}
                  >
                    <Share2 size={16} color={hasCompanyColor ? brandDisplayForeground(companyAccent, '#0284c7') : '#ffffff'} />
                    <Text className="text-sm font-inter-semibold" style={hasCompanyColor ? { color: brandDisplayForeground(companyAccent, '#0284c7') } : { color: '#ffffff' }}>Compartir</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleDownload}
                    className="flex-1 flex-row items-center justify-center gap-2 h-11 rounded-xl border border-border bg-card active:bg-muted"
                  >
                    <Download size={16} color="#334155" />
                    <Text className="text-sm font-inter-semibold text-foreground">Descargar</Text>
                  </Pressable>
                </View>
              </>
            ) : isActive && !unlimited && (membresia.lavadosRestantes ?? 0) <= 0 ? (
              <View className="py-6 px-4 items-center">
                <Text className="text-sm text-muted-foreground text-center">
                  Sin usos disponibles en este período. Renueva tu membresía para seguir usando tus beneficios.
                </Text>
              </View>
            ) : isActive ? (
              <View className="py-6 px-4 items-center">
                <Text className="text-sm text-muted-foreground text-center">
                  Tu código para canjear se está generando. Vuelve a cargar la página en un momento.
                </Text>
              </View>
            ) : (
              <View className="py-6 px-4 items-center">
                <Text className="text-sm text-muted-foreground text-center">
                  {membresia.estado === 'PENDIENTE' || membresia.estado === 'PENDIENTE_PAGO'
                    ? 'Esta membresía está pendiente de pago. Completa el pago para activar tu código QR.'
                    : membresia.estado === 'VENCIDA' || membresia.estado === 'CANCELADA'
                      ? 'Esta membresía no se encuentra activa. Renueva tu plan para volver a generar tu código QR.'
                      : 'El código QR no está disponible en este momento.'}
                </Text>
              </View>
            )}
          </View>

          {pagoPendiente && pagoDetalle && (
            <View className="mb-6 rounded-2xl border border-border bg-card p-5">
              <View className="flex-row items-center gap-2">
                <View className="h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: `${companyAccent}18` }}>
                  <ArrowRightLeft size={16} color={companyAccent} />
                </View>
                <View className="flex-1">
                  <Text className="text-base font-inter-bold text-foreground">
                    {planCambio ? `Cambio a ${planCambio.nombre}` : 'Completa el pago de tu membresía'}
                  </Text>
                  <Text className="mt-0.5 text-caption text-muted-foreground">
                    {pagoDetalle.estado === 'PENDIENTE_PAGO' || pagoDetalle.tieneComprobante
                      ? 'El negocio revisará tu comprobante.'
                      : 'Envía el comprobante para que el negocio active tu plan.'}
                  </Text>
                </View>
              </View>
              <View className="mt-4 rounded-xl p-4" style={{ backgroundColor: `${companyAccent}0D` }}>
                <Text className="text-caption font-inter-semibold text-muted-foreground">TOTAL A PAGAR</Text>
                <Text className="mt-1 text-h2 font-inter-extrabold" style={{ color: companyAccent }}>
                  RD${pagoPendiente.importeAPagar.toLocaleString('es-DO')}
                </Text>
                {pagoPendiente.descuentoBienvenida > 0 && (
                  <Text className="mt-1 text-caption text-muted-foreground">
                    Incluye RD${pagoPendiente.descuentoBienvenida.toLocaleString('es-DO')} de descuento de bienvenida.
                  </Text>
                )}
              </View>
              {pagoDetalle.rechazadoReason && (membresia.estado === 'RECHAZADA' || !!planCambio) && (
                <Text className="mt-3 text-small text-destructive">Motivo del rechazo: {pagoDetalle.rechazadoReason}</Text>
              )}
              {permiteAdjuntar && pagoPendiente.transferenciaActiva && pagoPendiente.cuentas.length > 0 ? (
                <View className="mt-4">
                  <ComprobanteMembresiaForm
                    membershipId={membresia.id}
                    cuentas={pagoPendiente.cuentas}
                    color={companyAccent}
                  />
                </View>
              ) : pagoDetalle.tieneComprobante && membresia.estado !== 'RECHAZADA' ? (
                <Text className="mt-4 rounded-xl bg-success/10 p-3 text-small font-inter-semibold text-success">
                  Comprobante enviado. El equipo del negocio lo revisará pronto.
                </Text>
              ) : permiteAdjuntar ? (
                <Text className="mt-4 rounded-xl bg-warning/10 p-3 text-small text-foreground">
                  Este negocio no tiene una cuenta de transferencia disponible. Contacta al negocio para completar el pago.
                </Text>
              ) : null}
              {puedePagarConCardnet && !cardnetSession && !cardnetRecoverySessionId ? (
                <View className="mt-4 gap-3">
                  {permiteConsentimientoRenovacion ? (
                    <>
                      <RenewalConsent
                        checked={renewalConsent}
                        disabled={cardnetStarting}
                        onChange={setRenewalConsent}
                      />
                      <Text className="text-small leading-5 text-muted-foreground">
                        La renovación automática solo se habilitará después de que el servidor confirme este pago y si autorizas esta opción.
                      </Text>
                    </>
                  ) : null}
                  {!cardnetError ? (
                    <Button
                      className="w-full"
                      style={{ backgroundColor: companyAccent }}
                      disabled={cardnetStarting}
                      loading={cardnetStarting}
                      icon={<CreditCard size={17} color={brandDisplayForeground(companyAccent, '#0284c7')} />}
                      onPress={() => { void startCardnetCheckout() }}
                    >
                      <Text className="text-sm font-inter-semibold" style={{ color: brandDisplayForeground(companyAccent, '#0284c7') }}>
                        Pagar con CardNET
                      </Text>
                    </Button>
                  ) : null}
                  {cardnetError ? (
                    <CardnetCaptureError
                      title="No pudimos preparar el pago con CardNET"
                      description={cardnetError}
                      onRetry={() => { void startCardnetCheckout() }}
                    />
                  ) : null}
                </View>
              ) : null}
            </View>
          )}

          {cardnetSession ? (
            <View className="mb-6">
              <CardnetCapture
                session={cardnetSession}
                onStatusChange={handleCardnetStatusChange}
                onRestartSession={() => { void startCardnetCheckout() }}
              />
              {cardnetStatus?.status === 'expired' ? (
                <View className="px-4 md:px-6">
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={cardnetStarting}
                    loading={cardnetStarting}
                    onPress={() => { void startCardnetCheckout() }}
                  >
                    Iniciar un nuevo pago
                  </Button>
                </View>
              ) : null}
            </View>
          ) : null}

          {cardnetRecoverySessionId ? (
            <View className="mb-6 gap-3 px-4 md:px-6">
              {cardnetRecoveryStatus ? (
                <>
                  <CardnetPaymentStatusMessage status={cardnetRecoveryStatus.status} />
                  {cardnetRecoveryStatus.status === 'activation_required' ? (
                    <CardnetActivationForm
                      error={cardnetActivationError}
                      onSubmit={activateRecoveredCardnetPayment}
                      submitting={cardnetActivationSubmitting}
                    />
                  ) : null}
                  {cardnetRecoveryStatus.status === 'pending' && cardnetRecoveryRetryAvailable ? (
                    <Button
                      variant="outline"
                      disabled={cardnetRecoveryQuery.isFetching}
                      loading={cardnetRecoveryQuery.isFetching}
                      onPress={retryCardnetRecoveryStatus}
                    >
                      Revisar estado
                    </Button>
                  ) : null}
                  {(cardnetRecoveryStatus.status === 'declined' || cardnetRecoveryStatus.status === 'expired') && puedePagarConCardnet ? (
                    <Button
                      variant="outline"
                      disabled={cardnetStarting}
                      loading={cardnetStarting}
                      onPress={() => { void startCardnetCheckout() }}
                    >
                      Iniciar un nuevo pago
                    </Button>
                  ) : null}
                </>
              ) : cardnetRecoveryQuery.isError ? (
                <CardnetCaptureError
                  title="No pudimos consultar el estado del pago"
                  description="Revisa tu conexión para volver a consultar el resultado confirmado por el servidor."
                  onRetry={retryCardnetRecoveryStatus}
                />
              ) : (
                <View className="flex-row items-center gap-3 rounded-xl border border-warning/25 bg-warning/5 p-4">
                  <ActivityIndicator />
                  <Text className="flex-1 text-sm leading-5 text-muted-foreground">
                    Consultando el estado del pago con el servidor. No vuelvas a iniciar el pago mientras lo revisamos.
                  </Text>
                </View>
              )}
            </View>
          ) : null}

          {/* Visits Section */}
          <View className="mb-6">
            <View className="flex-row items-center gap-2 mb-3">
              <View className="h-7 w-7 rounded-lg items-center justify-center" style={{ backgroundColor: `${hasCompanyColor ? companyAccent : '#7c3aed'}1A` }}>
                <History size={14} color={hasCompanyColor ? companyAccent : '#7c3aed'} />
              </View>
              <Text className="text-base font-inter-bold text-foreground">
                Visitas
              </Text>
            </View>
            {visitas.length > 0 ? (
              <View className="rounded-xl border border-border bg-card p-4">
                {visitas.slice(0, 5).map((visita, idx) => (
                  <View
                    key={visita.id}
                    className={`flex-row gap-3 py-3 ${idx < Math.min(visitas.length, 5) - 1
                      ? 'border-b border-border/50'
                      : ''
                      }`}
                  >
                      <View className="h-9 w-9 rounded-xl items-center justify-center" style={{ backgroundColor: `${companyAccent}1A` }}>
                      {visita.vehiculo ? (
                        <Car size={18} color={companyAccent} />
                      ) : (
                        <Clock size={18} color={companyAccent} />
                      )}
                    </View>
                    <View className="flex-1">
                      <Text className="text-sm font-inter-semibold text-foreground">
                        {visita.servicio || 'Servicio'}
                      </Text>
                      <Text className="text-xs text-muted-foreground">
                        {formatDate(visita.fecha)}
                      </Text>
                      {visita.sucursal && (
                        <Text className="text-xs text-muted-foreground mt-0.5">
                          {visita.sucursal}
                        </Text>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <View className="rounded-xl border border-dashed border-border bg-muted/20 py-8 px-4 items-center">
                <View className="h-10 w-10 rounded-xl bg-muted items-center justify-center mb-3">
                  <Clock size={20} color="#94a3b8" />
                </View>
                <Text className="text-sm text-muted-foreground text-center leading-5">
                  Cuando uses tu membresía, tus visitas aparecerán aquí.
                </Text>
              </View>
            )}
          </View>

          <View className="rounded-xl border border-border bg-card p-5 mb-6">
            <View className="flex-row items-center gap-2 mb-4">
              <View className="h-7 w-7 rounded-lg bg-muted items-center justify-center">
                <Calendar size={14} color="#64748b" />
              </View>
              <Text className="text-base font-inter-bold text-foreground">
                Detalles de la membresía
              </Text>
            </View>
            <View>
              <DetailRow
                label="Fecha de inicio"
                value={formatDateLong(membresia.fechaInicio)}
                isLast={false}
              />
              <DetailRow
                label="Fecha de vencimiento"
                value={formatDateLong(membresia.fechaVencimiento)}
                isLast={false}
              />
              <DetailRow
                label="Usos restantes"
                value={unlimited ? 'Ilimitado' : `${membresia.lavadosRestantes ?? 0}`}
                isLast={true}
              />
            </View>
          </View>

        </DetailPageFrame>
      </ScrollView>
      <View
        className={sheetBackgroundClass === 'bg-surface-card' ? "border-t border-border bg-surface-card px-4 pt-3" : "border-t border-border bg-vibe-fondo px-4 pt-3"}
        style={{ paddingBottom: isDetailSheet ? 12 : insets.bottom + 12 }}
      >
        <DetailPageFrame>
          {isActive && (
            <Button
              className="mb-2 w-full"
              style={{ backgroundColor: companyAccent }}
              onPress={() => router.push(`/planes?membershipId=${encodeURIComponent(membresia.id)}`)}
              icon={<ArrowRightLeft size={16} color={brandDisplayForeground(companyAccent, '#0284c7')} />}
            >
              <Text className="text-sm font-inter-semibold" style={{ color: brandDisplayForeground(companyAccent, '#0284c7') }}>
                Cambiar plan
              </Text>
            </Button>
          )}
          <Pressable
            onPress={handleCancel}
            className="items-center py-3"
          >
            <Text className="text-sm font-inter-semibold text-destructive">
              Cancelar membresía
            </Text>
          </Pressable>
        </DetailPageFrame>
      </View>
    </View>
  )
}

export default function MembresiaDetailScreen() {
  return (
    <ResponsiveDetailSheet>
      <MembresiaDetailScreenContent />
    </ResponsiveDetailSheet>
  )
}

function DetailRow({
  label,
  value,
  isLast,
}: {
  label: string
  value: string
  isLast: boolean
}) {
  return (
    <View
      className={`flex-row justify-between py-3 ${!isLast ? 'border-b border-border/50' : ''
        }`}
    >
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <Text className="text-sm font-medium text-foreground">{value}</Text>
    </View>
  )
}

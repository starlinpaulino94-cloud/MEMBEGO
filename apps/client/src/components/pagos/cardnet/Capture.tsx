import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Modal, Platform, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { CheckCircle2 } from 'lucide-react-native'
import type { CardnetCaptureSession, CardnetPaymentStatus } from '../../../lib/api'
import { api } from '../../../lib/api'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { colors } from '../../../theme/tokens'
import CardnetCaptureSurface from './CaptureSurface'
import type { CardnetCaptureFailure } from './capture.types'
import {
  CardnetActivationForm,
  CardnetCaptureError,
  CardnetCaptureIntroduction,
  CardnetPaymentStatusMessage,
} from './primitives'
import {
  decideCaptureStatus,
  isCardnetSessionExpired,
  resolveCardnetMerchantOrigin,
  shouldRenderPaymentSuccess,
  validateCardnetCaptureSession,
} from './security'

const cardnetMerchantOrigin = resolveCardnetMerchantOrigin(
  process.env.EXPO_PUBLIC_CARDNET_MERCHANT_ORIGIN,
)

export interface CardnetCaptureProps {
  readonly session: CardnetCaptureSession
  readonly initialStatus?: CardnetPaymentStatus | null
  readonly onStatusChange?: (status: CardnetPaymentStatus) => void
  readonly onApproved?: () => void
  readonly onRestartSession?: () => void
  readonly onClose: () => void
}

/** Cada cuánto se pregunta al servidor mientras el formulario está abierto (≈17 por minuto; el tope de la ruta es 30). */
const CAPTURE_WATCH_MS = 3500

function formatAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('es-DO', { style: 'currency', currency }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

function CaptureConfirmingMessage({ retryAvailable, onRetry }: { retryAvailable: boolean; onRetry: () => void }) {
  return (
    <Card className="flex-row items-center gap-3 border-warning/25 bg-warning/5 p-4">
      <ActivityIndicator color={colors.state.warning} />
      <View className="flex-1 gap-0.5">
        <Text className="text-sm font-inter-semibold text-foreground">Estamos confirmando tu pago</Text>
        <Text className="text-sm leading-5 text-muted-foreground">El resultado solo aparecerá cuando el servidor lo confirme.</Text>
      </View>
      {retryAvailable ? <Button size="sm" variant="outline" onPress={onRetry}>Revisar</Button> : null}
    </Card>
  )
}

export function CardnetCapture({
  session,
  initialStatus = null,
  onStatusChange,
  onApproved,
  onRestartSession,
  onClose,
}: CardnetCaptureProps) {
  const config = useMemo(() => validateCardnetCaptureSession(session), [session])
  const [status, setStatus] = useState<CardnetPaymentStatus | null>(initialStatus)
  const [captureFailure, setCaptureFailure] = useState<CardnetCaptureFailure | null>(null)
  const [confirmationUncertain, setConfirmationUncertain] = useState(false)
  const [submittingCapture, setSubmittingCapture] = useState(false)
  const [activationSubmitting, setActivationSubmitting] = useState(false)
  const [activationError, setActivationError] = useState<string | null>(null)
  const [surfaceKey, setSurfaceKey] = useState(0)
  const submittedRef = useRef(false)
  const submittingRef = useRef(false)
  const statusRef = useRef<CardnetPaymentStatus | null>(initialStatus)
  const sessionIdRef = useRef(session.sessionId)
  const approvedNotifiedRef = useRef(false)
  const pollInFlightRef = useRef(false)
  const pollAttemptsRef = useRef(0)
  const statusKind = status?.status ?? null

  const acceptServerStatus = useCallback((next: CardnetPaymentStatus) => {
    statusRef.current = next
    setStatus(next)
    // Lo que diga el servidor manda: un error de captura mostrado antes ya no aplica (la tarjeta pudo registrarse igual).
    setCaptureFailure(null)
    setConfirmationUncertain(false)
    onStatusChange?.(next)
    if (shouldRenderPaymentSuccess(next) && !approvedNotifiedRef.current) {
      approvedNotifiedRef.current = true
      onApproved?.()
    }
  }, [onApproved, onStatusChange])

  useEffect(() => {
    sessionIdRef.current = session.sessionId
    statusRef.current = initialStatus ?? null
    setStatus(initialStatus ?? null)
    setCaptureFailure(null)
    setConfirmationUncertain(false)
    setSubmittingCapture(false)
    setActivationError(null)
    setActivationSubmitting(false)
    submittedRef.current = false
    submittingRef.current = false
    approvedNotifiedRef.current = initialStatus?.status === 'approved'
    pollAttemptsRef.current = 0
  }, [initialStatus, session.sessionId])

  /**
   * Pregunta al servidor cómo va la sesión y actúa según `decideCaptureStatus`.
   *
   * `force` salta la regla de «una consulta a la vez»: después de un fallo de `/confirmar` la consulta NO puede descartarse
   * porque haya otra en vuelo (esa carrera dejaba la pantalla muerta). `silent` no marca «incierto» al fallar: el sondeo de
   * respaldo mientras se teclea la tarjeta no debe cambiar el formulario por «estamos confirmando» por un parpadeo de red
   * (se perdería lo que el cliente ya escribió).
   */
  const refreshStatus = useCallback(async (options: { force?: boolean; silent?: boolean } = {}): Promise<CardnetPaymentStatus | null> => {
    if (pollInFlightRef.current && !options.force) return null
    pollInFlightRef.current = true
    const requestedFor = session.sessionId
    try {
      const next = await api.getCardnetStatus(requestedFor)
      if (sessionIdRef.current !== requestedFor) return null
      const decision = decideCaptureStatus({
        next,
        current: statusRef.current,
        submitted: submittedRef.current,
        submitting: submittingRef.current,
      })
      if (decision === 'accept') acceptServerStatus(next)
      else if (decision === 'rearm') {
        submittedRef.current = false
        setSurfaceKey((key) => key + 1)
      }
      setConfirmationUncertain(false)
      return next
    } catch {
      if (!options.silent) setConfirmationUncertain(true)
      return null
    } finally {
      pollInFlightRef.current = false
    }
  }, [acceptServerStatus, session.sessionId])
  // El sondeo de respaldo llama siempre a la versión MÁS reciente sin reiniciar su temporizador en cada render del padre.
  const refreshStatusRef = useRef(refreshStatus)
  useEffect(() => {
    refreshStatusRef.current = refreshStatus
  }, [refreshStatus])

  useEffect(() => {
    if (statusKind !== 'pending') return
    const interval = setInterval(() => {
      if (pollAttemptsRef.current >= 18) {
        clearInterval(interval)
        return
      }
      pollAttemptsRef.current += 1
      void refreshStatus()
    }, 2500)
    return () => clearInterval(interval)
  }, [refreshStatus, statusKind])

  const receiveToken = useCallback(async (token: string) => {
    if (submittedRef.current) return
    submittedRef.current = true
    submittingRef.current = true
    setCaptureFailure(null)
    setConfirmationUncertain(false)
    setSubmittingCapture(true)
    try {
      const next = await api.confirmCardnetCapture({
        sessionId: session.sessionId,
        captureNonce: session.captureNonce,
        token,
      })
      acceptServerStatus(next)
    } catch {
      // `/confirmar` falló: por red, o con un 409 porque el servidor YA avanzó por su cuenta al ver la tarjeta en CardNET.
      // Manda lo que diga el servidor (se consulta aunque haya otra consulta en vuelo).
      submittingRef.current = false
      await refreshStatus({ force: true })
    } finally {
      submittingRef.current = false
      setSubmittingCapture(false)
    }
  }, [acceptServerStatus, refreshStatus, session.captureNonce, session.sessionId])

  const handleActivation = useCallback(async (activationCode: string) => {
    setActivationSubmitting(true)
    setActivationError(null)
    try {
      const next = await api.activateCardnetProfile({ sessionId: session.sessionId, activationCode })
      acceptServerStatus(next)
      if (next.status === 'activation_required') {
        setActivationError('El código no fue confirmado. Verifica el mensaje de tu banco e inténtalo de nuevo.')
      }
    } catch {
      setActivationError('No pudimos confirmar la activación. Revisa tu conexión e inténtalo de nuevo.')
    } finally {
      setActivationSubmitting(false)
    }
  }, [acceptServerStatus, refreshStatus, session.sessionId])

  const handleCaptureError = useCallback((reason: CardnetCaptureFailure) => {
    setCaptureFailure(reason)
  }, [])

  const expired = isCardnetSessionExpired(session)
  const effectiveStatus = status ?? (expired ? { status: 'expired' as const } : null)
  const showApproved = shouldRenderPaymentSuccess(status)
  const captureIsClosed = effectiveStatus !== null || confirmationUncertain || submittingCapture
  const retryStatus = useCallback(() => void refreshStatus({ force: true }), [refreshStatus])

  // RED DE SEGURIDAD: mientras el servidor no haya dicho nada, se le pregunta cómo va la sesión.
  //
  // Antes la app solo avisaba al servidor cuando el navegador del formulario le entregaba el token, y si esa señal se
  // perdía (el widget la entrega en otro formato, cierra su ventana antes de entregarla…) la tarjeta quedaba registrada
  // en CardNET y la pantalla se quedaba en «Completa el formulario» hasta que la sesión vencía, sin cobro y sin error.
  // El servidor ahora comprueba en CardNET si la tarjeta ya existe y, si es así, avanza el pago y responde `capture:
  // 'closed'`: aquí el formulario se cierra y sigue el flujo de siempre. Corre incluso con un error de captura a la vista
  // (la tarjeta pudo registrarse igual) y mientras se envía el token (las respuestas atrasadas se resuelven en
  // `decideCaptureStatus`). Un fallo de red no cambia nada en pantalla: se reintenta en el siguiente turno.
  const watching = config !== null && effectiveStatus === null
  useEffect(() => {
    if (!watching) return
    const interval = setInterval(() => {
      void refreshStatusRef.current({ silent: true })
    }, CAPTURE_WATCH_MS)
    return () => clearInterval(interval)
  }, [watching])
  const nativeCaptureActive = Platform.OS !== 'web' &&
    config !== null &&
    cardnetMerchantOrigin !== null &&
    !captureFailure &&
    !captureIsClosed

  const captureContent = (
    <View className="mx-auto w-full max-w-[720px] gap-4 px-4 py-4 md:px-6">
      <Card className="gap-4 p-4 md:p-5">
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1 gap-1">
            <Text className="text-xs font-inter-semibold uppercase tracking-widest text-primary">Pago con tarjeta</Text>
            <Text className="text-h2 font-inter-bold text-foreground">Confirma tu pago</Text>
          </View>
          <Badge variant="info" textClassName="text-foreground">CardNET</Badge>
        </View>
        <View className="flex-row items-center justify-between rounded-xl bg-muted px-4 py-3">
          <Text className="text-sm text-muted-foreground">Total de esta operación</Text>
          <Text className="text-base font-inter-bold tabular-nums text-foreground">{formatAmount(session.amount, session.currency)}</Text>
        </View>
        <CardnetCaptureIntroduction />
        {!config ? (
          <CardnetCaptureError title="No pudimos validar la sesión de CardNET" description="Cierra esta ventana e inicia una nueva sesión de pago." onRetry={onRestartSession} />
        ) : Platform.OS !== 'web' && !cardnetMerchantOrigin ? (
          <CardnetCaptureError title="No pudimos preparar CardNET" description="El origen seguro de la tienda no es válido." onRetry={onRestartSession} />
        ) : captureFailure ? (
          <CardnetCaptureError onRetry={onRestartSession} />
        ) : captureIsClosed ? (
          submittingCapture || (confirmationUncertain && !status) ? (
            <CaptureConfirmingMessage retryAvailable={confirmationUncertain} onRetry={retryStatus} />
          ) : statusKind === 'pending' && confirmationUncertain ? (
            <CaptureConfirmingMessage retryAvailable onRetry={retryStatus} />
          ) : null
        ) : (
          <CardnetCaptureSurface
            key={surfaceKey}
            config={config}
            disabled={false}
            merchantOrigin={cardnetMerchantOrigin ?? 'https://membego.com'}
            onError={handleCaptureError}
            onToken={receiveToken}
            session={session}
          />
        )}
        {effectiveStatus ? <CardnetPaymentStatusMessage status={effectiveStatus.status} /> : null}
        {status?.status === 'activation_required' ? (
          <CardnetActivationForm error={activationError} onSubmit={handleActivation} submitting={activationSubmitting} />
        ) : null}
        {status?.status === 'declined' && onRestartSession ? (
          <Button onPress={onRestartSession}>Intentar de nuevo</Button>
        ) : null}
        {showApproved ? (
          <View accessibilityLiveRegion="polite" className="flex-row items-center gap-2 rounded-xl border border-success/20 bg-success/5 px-3 py-2.5">
            <CheckCircle2 size={16} color={colors.state.success} />
            <Text className="flex-1 text-sm font-inter-semibold text-success">Confirmado por el servidor</Text>
          </View>
        ) : null}
      </Card>
    </View>
  )

  if (Platform.OS === 'web') return captureContent

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      visible
    >
      <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
        <View className="border-b border-border px-4 py-3">
          <View className="mx-auto w-full max-w-[720px] flex-row items-center justify-between gap-3">
            <View className="flex-1">
              <Text className="text-base font-inter-semibold text-foreground">Pago seguro</Text>
              <Text className="text-sm text-muted-foreground">CardNET · {formatAmount(session.amount, session.currency)}</Text>
            </View>
            <Button size="sm" variant="outline" onPress={onClose}>
              Cerrar
            </Button>
          </View>
        </View>
        {nativeCaptureActive && config ? (
          <CardnetCaptureSurface
            key={surfaceKey}
            config={config}
            disabled={false}
            merchantOrigin={cardnetMerchantOrigin ?? 'https://membego.com'}
            onError={handleCaptureError}
            onToken={receiveToken}
            session={session}
          />
        ) : (
          <ScrollView
            className="flex-1"
            contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}
            keyboardShouldPersistTaps="handled"
          >
            {captureContent}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  )
}

export default CardnetCapture

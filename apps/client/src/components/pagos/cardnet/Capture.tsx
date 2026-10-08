import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
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
  isCardnetSessionExpired,
  shouldRenderPaymentSuccess,
  validateCardnetCaptureSession,
} from './security'

export interface CardnetCaptureProps {
  readonly session: CardnetCaptureSession
  readonly initialStatus?: CardnetPaymentStatus | null
  readonly onStatusChange?: (status: CardnetPaymentStatus) => void
  readonly onApproved?: () => void
  readonly onRestartSession?: () => void
}

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
}: CardnetCaptureProps) {
  const config = useMemo(() => validateCardnetCaptureSession(session), [session])
  const [status, setStatus] = useState<CardnetPaymentStatus | null>(initialStatus)
  const [captureFailure, setCaptureFailure] = useState<CardnetCaptureFailure | null>(null)
  const [confirmationUncertain, setConfirmationUncertain] = useState(false)
  const [submittingCapture, setSubmittingCapture] = useState(false)
  const [activationSubmitting, setActivationSubmitting] = useState(false)
  const [activationError, setActivationError] = useState<string | null>(null)
  const submittedRef = useRef(false)
  const approvedNotifiedRef = useRef(false)
  const pollInFlightRef = useRef(false)
  const pollAttemptsRef = useRef(0)
  const statusKind = status?.status ?? null

  const acceptServerStatus = useCallback((next: CardnetPaymentStatus) => {
    setStatus(next)
    setConfirmationUncertain(false)
    onStatusChange?.(next)
    if (shouldRenderPaymentSuccess(next) && !approvedNotifiedRef.current) {
      approvedNotifiedRef.current = true
      onApproved?.()
    }
  }, [onApproved, onStatusChange])

  useEffect(() => {
    setStatus(initialStatus ?? null)
    setCaptureFailure(null)
    setConfirmationUncertain(false)
    setSubmittingCapture(false)
    setActivationError(null)
    setActivationSubmitting(false)
    submittedRef.current = false
    approvedNotifiedRef.current = initialStatus?.status === 'approved'
    pollAttemptsRef.current = 0
  }, [initialStatus, session.sessionId])

  const refreshStatus = useCallback(async (): Promise<CardnetPaymentStatus | null> => {
    if (pollInFlightRef.current) return null
    pollInFlightRef.current = true
    try {
      const next = await api.getCardnetStatus(session.sessionId)
      acceptServerStatus(next)
      setConfirmationUncertain(false)
      return next
    } catch {
      setConfirmationUncertain(true)
      return null
    } finally {
      pollInFlightRef.current = false
    }
  }, [acceptServerStatus, session.sessionId])

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
      await refreshStatus()
    } finally {
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
  const retryStatus = useCallback(() => void refreshStatus(), [refreshStatus])

  return (
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
            config={config}
            disabled={false}
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
}

export default CardnetCapture

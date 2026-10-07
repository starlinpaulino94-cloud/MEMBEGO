import React, { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { AlertCircle, Check, CheckCircle2, Clock3, CreditCard, LockKeyhole, ShieldCheck } from 'lucide-react-native'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { EmptyState } from '../../ui/EmptyState'
import { Input } from '../../ui/Input'
import { colors } from '../../../theme/tokens'
import type { CardnetPaymentStatus } from '../../../lib/api'

export type CardnetStatusKind = CardnetPaymentStatus['status']

export function CardnetCaptureIntroduction() {
  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-2">
        <View className="h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
          <CreditCard size={18} color={colors.primary.DEFAULT} strokeWidth={2} />
        </View>
        <View className="flex-1">
          <Text className="text-h3 font-inter-bold text-foreground">Pago seguro con CardNET</Text>
          <Text className="mt-0.5 text-small text-muted-foreground">Tus datos se capturan en el formulario protegido de CardNET.</Text>
        </View>
      </View>
      <View className="flex-row items-center gap-2 rounded-xl border border-border bg-muted px-3 py-2.5">
        <ShieldCheck size={17} color={colors.state.success} strokeWidth={2} />
        <Text className="flex-1 text-sm leading-5 text-foreground">Los datos de tu tarjeta se quedan dentro de CardNET.</Text>
      </View>
    </View>
  )
}

export function RenewalConsent({
  checked,
  disabled = false,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel="Guardar medio de pago para renovaciones automáticas"
      disabled={disabled}
      onPress={() => onChange(!checked)}
      className={`min-h-11 flex-row items-start gap-3 rounded-xl border px-3 py-3 ${checked ? 'border-primary/40 bg-primary/5' : 'border-border bg-card'} ${disabled ? 'opacity-60' : 'active:opacity-80'}`}
    >
      <View className={`mt-0.5 h-5 w-5 items-center justify-center rounded-md border ${checked ? 'border-primary bg-primary' : 'border-border bg-background'}`}>
        {checked ? <Check size={14} color={colors.surface.background} strokeWidth={3} /> : null}
      </View>
      <View className="flex-1">
        <Text className="text-sm font-inter-semibold leading-5 text-foreground">Guardar para renovaciones automáticas</Text>
        <Text className="mt-1 text-small leading-5 text-muted-foreground">CardNET puede conservar un perfil para procesar este pago. Si lo autorizas, lo usaremos para las renovaciones de esta membresía.</Text>
      </View>
    </Pressable>
  )
}

const STATUS_COPY: Record<CardnetStatusKind, { title: string; description: string; variant: 'warning' | 'success' | 'destructive' | 'info'; icon: React.ReactNode }> = {
  pending: {
    title: 'Estamos confirmando tu pago',
    description: 'CardNET recibió la captura. Te avisaremos cuando el servidor confirme el resultado.',
    variant: 'warning',
    icon: <Clock3 size={18} color={colors.state.warning} />,
  },
  approved: {
    title: 'Pago aprobado',
    description: 'El servidor confirmó el pago.',
    variant: 'success',
    icon: <CheckCircle2 size={18} color={colors.state.success} />,
  },
  declined: {
    title: 'Pago no aprobado',
    description: 'El banco no aprobó el pago. Puedes volver a intentarlo con otra tarjeta.',
    variant: 'destructive',
    icon: <AlertCircle size={18} color={colors.state.danger} />,
  },
  activation_required: {
    title: 'Activa el medio de pago',
    description: 'Ingresa el código de activación que recibiste de tu banco.',
    variant: 'info',
    icon: <ShieldCheck size={18} color={colors.state.info} />,
  },
  expired: {
    title: 'La sesión de pago venció',
    description: 'Inicia una nueva sesión para continuar con seguridad.',
    variant: 'warning',
    icon: <Clock3 size={18} color={colors.state.warning} />,
  },
}

export function CardnetPaymentStatusMessage({ status }: { status: CardnetStatusKind }) {
  const copy = STATUS_COPY[status]
  return (
    <Card className="p-4">
      <View className="flex-row items-start gap-3" accessibilityLiveRegion="polite">
        <View className="mt-0.5">{copy.icon}</View>
        <View className="flex-1 gap-1">
          <View className="flex-row flex-wrap items-center gap-2">
            <Text className="text-base font-inter-semibold text-foreground">{copy.title}</Text>
            <Badge variant={copy.variant} textClassName="text-foreground">{status === 'activation_required' ? 'Acción necesaria' : status === 'pending' ? 'Pendiente' : status === 'approved' ? 'Confirmado' : status === 'declined' ? 'No aprobado' : 'Vencido'}</Badge>
          </View>
          <Text className="text-sm leading-5 text-muted-foreground">{copy.description}</Text>
        </View>
      </View>
    </Card>
  )
}

export function CardnetCaptureError({
  title = 'No pudimos abrir el formulario seguro',
  description = 'La sesión o la conexión no está disponible. Puedes volver a intentarlo.',
  onRetry,
}: {
  title?: string
  description?: string
  onRetry?: () => void
}) {
  return (
    <EmptyState
      variant="inline"
      icon={<AlertCircle size={21} color={colors.state.danger} />}
      title={title}
      description={description}
      action={onRetry ? <Button variant="outline" onPress={onRetry}>Intentar de nuevo</Button> : undefined}
      className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-6"
    />
  )
}

export function CardnetActivationForm({
  submitting = false,
  error,
  onSubmit,
}: {
  submitting?: boolean
  error?: string | null
  onSubmit: (activationCode: string) => Promise<void> | void
}) {
  const [activationCode, setActivationCode] = useState('')
  const code = activationCode.trim()
  const valid = code.length >= 6 && code.length <= 64

  return (
    <Card className="gap-3 p-4">
      <View className="flex-row items-center gap-2">
        <LockKeyhole size={17} color={colors.state.info} />
        <Text className="text-base font-inter-semibold text-foreground">Código de activación</Text>
      </View>
      <Text className="text-sm leading-5 text-muted-foreground">Escribe el código que te envió tu banco para continuar con este pago.</Text>
      <Input
        accessibilityLabel="Código de activación bancaria"
        autoCapitalize="characters"
        autoCorrect={false}
        keyboardType="default"
        maxLength={64}
        onChangeText={setActivationCode}
        placeholder="Código de activación"
        returnKeyType="done"
        value={activationCode}
      />
      {error ? <Text accessibilityRole="alert" className="text-sm text-destructive">{error}</Text> : null}
      <Button disabled={!valid || submitting} loading={submitting} onPress={() => void onSubmit(code)}>
        Activar y continuar
      </Button>
    </Card>
  )
}

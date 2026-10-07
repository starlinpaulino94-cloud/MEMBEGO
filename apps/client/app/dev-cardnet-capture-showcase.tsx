import React, { useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { CreditCard, ShieldCheck } from 'lucide-react-native'
import { Badge } from '../src/components/ui/Badge'
import { Button } from '../src/components/ui/Button'
import { Card } from '../src/components/ui/Card'
import { PageHeader } from '../src/components/ui/PageHeader'
import { colors } from '../src/theme/tokens'
import {
  CardnetActivationForm,
  CardnetCaptureError,
  CardnetCaptureIntroduction,
  CardnetPaymentStatusMessage,
  RenewalConsent,
} from '../src/components/pagos/cardnet/primitives'

const SHOWCASE_STATES = [
  'pending',
  'approved',
  'declined',
  'activation_required',
  'expired',
] as const

export default function CardnetCaptureShowcaseRoute() {
  const [renewalConsent, setRenewalConsent] = useState(false)
  const [staticNotice, setStaticNotice] = useState<string | null>(null)

  if (!__DEV__) return null

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="flex-grow">
      <View className="mx-auto w-full max-w-[720px] px-4 pb-8 pt-5 md:px-6 lg:pt-8">
        <PageHeader
          eyebrow="Componentes de pago"
          title="CardNET · vista previa"
          description="Muestra estática de desarrollo. No abre CardNET, no envía solicitudes y no captura datos bancarios."
          className="mb-5"
        />
        <View className="mb-5 flex-row items-start gap-2 rounded-xl border border-info/20 bg-info/5 px-3 py-3">
          <ShieldCheck size={17} color={colors.state.info} />
          <Text className="flex-1 text-sm leading-5 text-foreground">Los importes y estados de esta página son ejemplos de diseño. Un pago real solo se completa con confirmación del servidor.</Text>
        </View>

        <View className="gap-5">
          <View className="gap-4">
            <Card className="gap-4 p-4 md:p-5">
              <View className="flex-row items-start justify-between gap-3">
                <View className="flex-1 gap-1">
                  <Text className="text-xs font-inter-semibold uppercase tracking-widest text-primary">Pago con tarjeta</Text>
                  <Text className="text-h2 font-inter-bold text-foreground">Confirma tu pago</Text>
                </View>
          <Badge variant="info" textClassName="text-foreground">Vista previa</Badge>
              </View>
              <View className="flex-row items-center justify-between rounded-xl bg-muted px-4 py-3">
                <Text className="text-sm text-muted-foreground">Total de ejemplo</Text>
                <Text className="text-base font-inter-bold tabular-nums text-foreground">RD$1,250.00</Text>
              </View>
              <CardnetCaptureIntroduction />
              <View className="min-h-[164px] items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/60 px-4 py-5">
                <View className="h-10 w-10 items-center justify-center rounded-xl bg-card">
                  <CreditCard size={19} color={colors.primary.DEFAULT} />
                </View>
                <Text className="text-center text-sm font-inter-semibold text-foreground">El formulario seguro se abriría en CardNET</Text>
                <Text className="max-w-[340px] text-center text-sm leading-5 text-muted-foreground">La vista real usa el formulario alojado por CardNET. Esta muestra no contiene campos de tarjeta.</Text>
                <Button disabled variant="outline">Abrir formulario seguro</Button>
              </View>
              <RenewalConsent checked={renewalConsent} onChange={setRenewalConsent} />
              <Text className="text-xs text-muted-foreground">Consentimiento de renovación: {renewalConsent ? 'activado en esta muestra' : 'desactivado por defecto'}</Text>
            </Card>

            <CardnetCaptureError
              title="No se pudo abrir el formulario seguro"
              description="La sesión de captura no está disponible. Puedes iniciar una nueva sesión."
              onRetry={() => setStaticNotice('En un pago real, volveríamos a solicitar una sesión segura al servidor.')}
            />
          </View>

          <View className="gap-4">
            <Card className="gap-3 p-4 md:p-5">
              <View className="flex-row items-center justify-between gap-2">
                <Text className="text-h3 font-inter-bold text-foreground">Estados del pago</Text>
                <Badge variant="secondary">Solo muestra</Badge>
              </View>
              <View className="gap-3">
                {SHOWCASE_STATES.map((status) => (
                  <CardnetPaymentStatusMessage key={status} status={status} />
                ))}
              </View>
            </Card>

            <CardnetActivationForm onSubmit={() => setStaticNotice('La muestra validó el formato localmente. En un pago real, el código se enviaría al servidor para confirmar la activación.')} />
            <Text className="px-1 text-xs leading-5 text-muted-foreground">En una compra real, el código se envía al servidor para confirmar la activación. Esta muestra solo valida el formato y no envía solicitudes.</Text>
            {staticNotice ? <Text accessibilityLiveRegion="polite" className="rounded-xl border border-info/20 bg-info/5 px-3 py-3 text-sm leading-5 text-foreground">{staticNotice}</Text> : null}
          </View>
        </View>
      </View>
    </ScrollView>
  )
}

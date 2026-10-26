import React, { useState } from 'react'
import { Alert, Linking, Pressable, Text, View } from 'react-native'
import { Check, CreditCard, RefreshCw } from 'lucide-react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type RenovacionAutomatica, type RenovacionTarjeta } from '../../lib/api'
import { Button } from '../ui/Button'
import { colors } from '../../theme/tokens'

type Disponible = Extract<RenovacionAutomatica, { disponible: true }>

function etiquetaTarjeta(marca: string | null, ultimos4: string | null): string {
  const nombre = marca?.trim() ? marca.trim().charAt(0).toUpperCase() + marca.trim().slice(1).toLowerCase() : 'Tarjeta'
  const digitos = (ultimos4 ?? '').replace(/\D/g, '')
  return digitos.length >= 4 ? `${nombre} ····${digitos.slice(-4)}` : `${nombre} guardada`
}

function fechaLarga(iso: string | null): string | null {
  if (!iso) return null
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return null
  return new Intl.DateTimeFormat('es-DO', { dateStyle: 'long', timeZone: 'America/Santo_Domingo' }).format(fecha)
}

/**
 * LA RENOVACIÓN AUTOMÁTICA DE UNA MEMBRESÍA, en la app.
 *
 * EL SERVIDOR MANDA: si se ofrece, con qué tarjetas, y el texto del consentimiento
 * vienen de `/api/v1/cliente/membresias/:id/renovacion` y la app los muestra tal cual.
 * Al aceptar, devuelve la versión del texto que vio: si cambió mientras tanto, el
 * servidor no la registra. Es la misma puerta que usa la web.
 *
 * Situaciones, y cada una dice la verdad sobre lo que va a pasar:
 *  · **Activa**: con qué tarjeta, cuánto y cuándo; se puede desactivar (la tarjeta
 *    sigue guardada). Si es de antes del registro de consentimientos, se ofrece
 *    CONFIRMARLA.
 *  · **Apagada, con tarjetas vigentes**: se activa aceptando un texto corto, con una
 *    casilla sin marcar y el enlace a las condiciones completas.
 *  · **Apagada, tarjetas vencidas / sin tarjetas / empresa sin cobro con tarjeta**: se
 *    explica, sin un botón que no pueda hacer nada.
 *
 * Si no se puede cargar, no se muestra nada: nunca estorba el resto de la membresía.
 */
export function RenovacionAutomaticaPanel({ membershipId }: { membershipId: string }) {
  const query = useQuery({
    queryKey: ['cliente', 'membresia-renovacion', membershipId],
    queryFn: () => api.getRenovacionAutomatica(membershipId),
    enabled: !!membershipId,
  })
  const datos = query.data
  if (!datos || !datos.disponible) return null
  return <Panel membershipId={membershipId} datos={datos} />
}

function Panel({ membershipId, datos }: { membershipId: string; datos: Disponible }) {
  const queryClient = useQueryClient()
  const vigentes = datos.tarjetas.filter((t) => !t.vencida)
  const refrescar = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['cliente', 'membresia-renovacion', membershipId] }),
      queryClient.invalidateQueries({ queryKey: ['cliente', 'membresias'] }),
    ])

  const desactivar = useMutation({
    mutationFn: () => api.desactivarRenovacionAutomatica(membershipId),
    onSuccess: refrescar,
  })
  const vence = fechaLarga(datos.proximoCobro)

  const confirmarDesactivar = () => {
    Alert.alert(
      '¿Desactivar la renovación automática?',
      vence
        ? `Tu membresía sigue activa hasta el ${vence}. Después tendrás que renovarla tú. No se te cobrará automáticamente.`
        : 'Tu membresía sigue activa hasta su vencimiento. Después tendrás que renovarla tú. No se te cobrará automáticamente.',
      [
        { text: 'Mantenerla', style: 'cancel' },
        { text: 'Sí, desactivar', style: 'destructive', onPress: () => desactivar.mutate() },
      ]
    )
  }

  return (
    <View className="mb-6">
      <View className="mb-3 flex-row items-center gap-2">
        <View className="h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
          <RefreshCw size={14} color={colors.primary.DEFAULT} />
        </View>
        <Text className="text-base font-inter-bold text-foreground">Renovación automática</Text>
        {datos.activa ? (
          <Text className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-inter-semibold text-success">Activa</Text>
        ) : null}
      </View>

      <View className="gap-4 rounded-xl border border-border bg-card p-4">
        {datos.activa && datos.tarjetaActual ? (
          <>
            <Text className="text-sm leading-5 text-foreground">
              Se renovará sola con{' '}
              <Text className="font-inter-semibold">{etiquetaTarjeta(datos.tarjetaActual.marca, datos.tarjetaActual.ultimos4)}</Text>
              {vence ? ` en los días previos al ${vence}` : ''}, por el precio vigente del plan (hoy {datos.montoTexto}). Puedes
              desactivarla cuando quieras; tu tarjeta seguirá guardada.
            </Text>
            <EnlaceCondiciones url={datos.consentimiento.urlCondiciones} />
            <Button variant="outline" size="sm" loading={desactivar.isPending} disabled={desactivar.isPending} onPress={confirmarDesactivar}>
              Desactivar renovación automática
            </Button>
            {desactivar.isError ? <ErrorTexto error={desactivar.error} /> : null}

            {datos.heredada && datos.puedeActivar && vigentes.some((t) => t.id === datos.tarjetaActual?.id) ? (
              <View className="gap-3 border-t border-border pt-4">
                <Text className="text-sm leading-5 text-muted-foreground">
                  Activaste esta renovación antes de que registráramos tu autorización. Si quieres seguir con ella, confírmala:
                </Text>
                <FormularioDeAutorizacion
                  membershipId={membershipId}
                  datos={datos}
                  tarjetas={vigentes.filter((t) => t.id === datos.tarjetaActual?.id)}
                  textoBoton="Confirmar renovación automática"
                  alTerminar={refrescar}
                />
              </View>
            ) : null}
          </>
        ) : !datos.puedeActivar ? (
          <Text className="text-sm leading-5 text-muted-foreground">
            La renovación automática no está disponible en este negocio por ahora. Puedes renovar tu membresía a mano cuando venza.
          </Text>
        ) : vigentes.length > 0 ? (
          <FormularioDeAutorizacion
            membershipId={membershipId}
            datos={datos}
            // Una tarjeta vencida no se ofrece: el cobro no la intentaría.
            tarjetas={vigentes}
            textoBoton="Activar renovación automática"
            alTerminar={refrescar}
          />
        ) : datos.tarjetas.length > 0 ? (
          <Text className="text-sm leading-5 text-muted-foreground">
            Tus tarjetas guardadas están vencidas. Para activar la renovación automática, paga con una tarjeta vigente y marca
            “Guardar esta tarjeta para futuras compras”.
          </Text>
        ) : (
          <Text className="text-sm leading-5 text-muted-foreground">
            La renovación automática cobra tu membresía sola con una tarjeta guardada. Para activarla, paga con tarjeta una vez y marca
            “Guardar esta tarjeta para futuras compras”; después vuelve aquí.
          </Text>
        )}
      </View>
    </View>
  )
}

/**
 * Las condiciones completas (aviso previo, intentos, cómo desactivarla) están en la
 * Política de Privacidad: la casilla las incorpora sin repetirlas.
 */
function EnlaceCondiciones({ url }: { url: string }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel="Condiciones de la renovación automática"
      onPress={() => void Linking.openURL(url).catch(() => undefined)}
      className="min-h-11 justify-center self-start"
    >
      <Text className="text-xs text-muted-foreground underline">Condiciones de la renovación automática</Text>
    </Pressable>
  )
}

function ErrorTexto({ error }: { error: unknown }) {
  return (
    <Text className="text-sm leading-5 text-destructive" accessibilityLiveRegion="polite">
      {error instanceof Error && error.message ? error.message : 'No pudimos completar el cambio. Inténtalo de nuevo.'}
    </Text>
  )
}

/**
 * El formulario del CONSENTIMIENTO: la tarjeta, el texto que escribió el servidor y
 * una casilla sin marcar. El botón no se habilita hasta marcarla, y el servidor
 * además exige que la petición diga que se aceptó y qué versión del texto se vio.
 */
function FormularioDeAutorizacion({
  membershipId,
  datos,
  tarjetas,
  textoBoton,
  alTerminar,
}: {
  membershipId: string
  datos: Disponible
  tarjetas: readonly RenovacionTarjeta[]
  textoBoton: string
  alTerminar: () => Promise<unknown>
}) {
  // La predeterminada si la hay (el servidor las envía ordenadas con ella primero).
  const [tarjetaId, setTarjetaId] = useState(tarjetas[0]?.id ?? '')
  const [acepto, setAcepto] = useState(false)
  const { consentimiento } = datos

  const activar = useMutation({
    mutationFn: () =>
      api.activarRenovacionAutomatica(membershipId, { tarjetaId, textoVersion: consentimiento.textoVersion }),
    onSuccess: alTerminar,
    // Si el texto cambió o algo ya no es elegible, se recarga lo que dice el servidor.
    onError: () => void alTerminar(),
  })

  return (
    <View className="gap-3">
      {tarjetas.length > 1 ? (
        <View className="gap-2" accessibilityRole="radiogroup">
          <Text className="text-sm font-inter-medium text-foreground">¿Con qué tarjeta?</Text>
          {tarjetas.map((t) => {
            const elegida = tarjetaId === t.id
            return (
              <Pressable
                key={t.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: elegida }}
                onPress={() => setTarjetaId(t.id)}
                className={`min-h-11 flex-row items-center gap-3 rounded-xl border px-3 py-2.5 ${elegida ? 'border-primary/50 bg-primary/5' : 'border-border bg-card'}`}
              >
                <View className={`h-4 w-4 items-center justify-center rounded-full border ${elegida ? 'border-primary' : 'border-border'}`}>
                  {elegida ? <View className="h-2 w-2 rounded-full bg-primary" /> : null}
                </View>
                <CreditCard size={16} color={colors.vibe.deep} />
                <Text className="text-sm font-inter-semibold text-foreground">{etiquetaTarjeta(t.marca, t.ultimos4)}</Text>
                {t.predeterminada ? <Text className="text-xs text-muted-foreground">· predeterminada</Text> : null}
              </Pressable>
            )
          })}
        </View>
      ) : tarjetas[0] ? (
        <View className="flex-row items-center gap-2">
          <CreditCard size={16} color={colors.vibe.deep} />
          <Text className="text-sm text-foreground">
            Con <Text className="font-inter-semibold">{etiquetaTarjeta(tarjetas[0].marca, tarjetas[0].ultimos4)}</Text>
          </Text>
        </View>
      ) : null}

      {/* El texto del consentimiento, tal como lo escribió el servidor (y como se registra). */}
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: acepto }}
        accessibilityLabel={consentimiento.titulo}
        onPress={() => setAcepto((v) => !v)}
        className={`min-h-11 flex-row items-start gap-3 rounded-xl border px-3 py-3 ${acepto ? 'border-primary/40 bg-primary/5' : 'border-border bg-card'} active:opacity-80`}
      >
        <View className={`mt-0.5 h-5 w-5 items-center justify-center rounded-md border ${acepto ? 'border-primary bg-primary' : 'border-border bg-background'}`}>
          {acepto ? <Check size={14} color={colors.surface.background} strokeWidth={3} /> : null}
        </View>
        <View className="flex-1">
          <Text className="text-sm font-inter-semibold leading-5 text-foreground">{consentimiento.titulo}</Text>
          {consentimiento.detalle ? (
            <Text className="mt-1 text-small leading-5 text-muted-foreground">{consentimiento.detalle}</Text>
          ) : null}
        </View>
      </Pressable>

      <EnlaceCondiciones url={consentimiento.urlCondiciones} />

      <Button
        disabled={!acepto || !tarjetaId || activar.isPending}
        loading={activar.isPending}
        onPress={() => activar.mutate()}
      >
        {textoBoton}
      </Button>
      {activar.isError ? <ErrorTexto error={activar.error} /> : null}
    </View>
  )
}

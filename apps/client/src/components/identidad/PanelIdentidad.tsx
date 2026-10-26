import React, { useEffect, useRef, useState } from 'react'
import { Alert, Linking, Pressable, Text, View } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import { Building2, Check, ChevronDown, ChevronUp, FileCheck2, Headset, LockKeyhole, ShieldCheck, Trash2 } from 'lucide-react-native'
import { api, type ConsentimientoIdentidad, type PanelIdentidad, type TonoIdentidad } from '../../lib/api'
import { IDENTIDAD_RETURN_URL, retornoEsDeEsteIntento } from '../../lib/identidad-retorno'
import {
  useBorrarDatosIdentidad,
  useCambiarConsentimientoIdentidad,
  useRefrescarIdentidad,
  useReportarProblemaIdentidad,
} from '../../hooks/useIdentidad'
import { colors } from '../../theme/tokens'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Input } from '../ui/Input'

const BADGE: Record<TonoIdentidad, 'success' | 'warning' | 'info' | 'secondary' | 'destructive'> = {
  exito: 'success',
  aviso: 'warning',
  info: 'info',
  neutro: 'secondary',
  peligro: 'destructive',
}
const AVISO_CAJA: Record<TonoIdentidad, string> = {
  exito: 'border-success/25 bg-success/10',
  aviso: 'border-warning/30 bg-warning/15',
  info: 'border-info/25 bg-info/10',
  neutro: 'border-border bg-muted',
  peligro: 'border-destructive/25 bg-destructive/10',
}
const AVISO_TEXTO: Record<TonoIdentidad, string> = {
  exito: 'text-success',
  aviso: 'text-warning',
  info: 'text-info',
  neutro: 'text-foreground',
  peligro: 'text-destructive',
}

const URL_BASE_PUBLICA = 'https://membego.com'

/**
 * LA VERIFICACIÓN DE IDENTIDAD en la app: estado, cómo funciona, privacidad, consentimiento, empezar, resultado,
 * reintentar, incidencias y borrado.
 *
 * LA APP NO DECIDE NADA. El servidor manda la vista armada (`panel.vista`: el estado, qué botón ofrecer, qué decir y con
 * qué tono) y los textos de los permisos con su versión; aquí se pintan. La captura no ocurre en la app: se abre la
 * verificación hospedada en el navegador del sistema (`WebBrowser.openAuthSessionAsync`, como la ventana de CardNET), que
 * ya tiene la cámara y los permisos resueltos, y al volver la pantalla le pregunta el estado al servidor. Que alguien
 * quede verificado solo lo decide el servidor, tras consultarle al proveedor.
 */
export function PanelIdentidadView({ panel }: { panel: PanelIdentidad }) {
  const { vista } = panel
  const refrescar = useRefrescarIdentidad()
  const [marcadas, setMarcadas] = useState<Record<string, boolean>>({})
  const [abriendo, setAbriendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [volvio, setVolvio] = useState(false)
  const [reportando, setReportando] = useState(false)
  const montado = useRef(true)
  useEffect(() => {
    montado.current = true
    return () => {
      montado.current = false
    }
  }, [])

  const empieza = vista.accion === 'verificar' || vista.accion === 'continuar' || vista.accion === 'reintentar'
  // Las casillas que se piden: las obligatorias que faltan y la opcional de los negocios.
  const pedir = empieza && vista.requiereConsentimientos ? panel.consentimientos.filter((c) => !c.vigente) : []
  const faltanObligatorias = pedir.some((c) => c.obligatorio && !marcadas[c.tipo])

  const empezar = async () => {
    if (abriendo) return
    setError(null)
    setAbriendo(true)
    try {
      // Cada permiso se manda con la versión del texto que la persona VIO: el servidor rechaza cualquier otra.
      const aceptados = Object.fromEntries(pedir.filter((c) => marcadas[c.tipo]).map((c) => [c.tipo, c.textoVersion]))
      const sesion = await api.iniciarVerificacionIdentidad(aceptados)
      const resultado = await WebBrowser.openAuthSessionAsync(sesion.url, IDENTIDAD_RETURN_URL, { preferEphemeralSession: true })
      // El retorno no dice qué pasó: solo que volvió. El estado lo pregunta la pantalla al servidor (más abajo).
      if (montado.current && resultado.type === 'success' && retornoEsDeEsteIntento(resultado.url, { intentoId: sesion.intentoId, nonce: sesion.nonce })) setVolvio(true)
    } catch (e) {
      if (montado.current) setError(e instanceof Error ? e.message : 'No pudimos iniciar la verificación.')
    } finally {
      if (montado.current) setAbriendo(false)
      await refrescar()
    }
  }

  return (
    <View className="gap-4">
      {volvio && vista.estado !== 'verificada' ? (
        <View accessibilityLiveRegion="polite" className={`rounded-xl border p-3 ${AVISO_CAJA.info}`}>
          <Text className={`text-sm font-inter-semibold ${AVISO_TEXTO.info}`}>Volviste de la verificación</Text>
          <Text className="mt-0.5 text-small text-foreground">Estamos comprobando el resultado. Esta pantalla se actualiza sola.</Text>
        </View>
      ) : null}

      <Card className="gap-3 p-4">
        <View className="flex-row items-center gap-2">
          <ShieldCheck size={16} color={colors.surface.mutedForeground} />
          <Text className="flex-1 text-h4 font-inter-semibold text-foreground">Verificación de identidad</Text>
          <Badge variant={BADGE[vista.tono]}>{vista.etiqueta}</Badge>
        </View>
        <View accessibilityLiveRegion="polite" className="gap-1">
          <Text className="text-base font-inter-semibold text-foreground">{vista.titulo}</Text>
          <Text className="text-small leading-5 text-muted-foreground">{vista.descripcion}</Text>
        </View>

        {vista.aviso ? (
          <View accessibilityLiveRegion="polite" className={`rounded-xl border p-3 ${AVISO_CAJA[vista.aviso.tono]}`}>
            <Text className={`text-small font-inter-medium ${AVISO_TEXTO[vista.aviso.tono]}`}>{vista.aviso.texto}</Text>
          </View>
        ) : null}

        {pedir.map((c) => (
          <Consentimiento key={c.tipo} c={c} marcada={!!marcadas[c.tipo]} alCambiar={(v) => setMarcadas((m) => ({ ...m, [c.tipo]: v }))} />
        ))}
        {pedir.length > 0 ? (
          <Pressable accessibilityRole="link" className="min-h-11 justify-center" onPress={() => void Linking.openURL(URL_BASE_PUBLICA + panel.urlCondiciones)}>
            <Text className="text-small text-muted-foreground underline">Cómo tratamos tus datos de verificación</Text>
          </Pressable>
        ) : null}

        {empieza ? (
          <>
            <Button onPress={() => void empezar()} disabled={faltanObligatorias || abriendo} loading={abriendo}>
              {abriendo ? 'Abriendo la verificación…' : (vista.textoAccion ?? 'Verificar')}
            </Button>
            <Text className="text-caption text-muted-foreground">
              Te llevaremos a {panel.proveedor}, nuestro proveedor de verificación, y volverás aquí al terminar.
            </Text>
          </>
        ) : null}

        {vista.accion === 'contactar' ? (
          <Button variant="outline" icon={<Headset size={16} color={colors.vibe.deep} />} onPress={() => setReportando(true)}>
            {vista.textoAccion ?? 'Contar mi problema'}
          </Button>
        ) : null}

        {error ? (
          <Text accessibilityLiveRegion="polite" className="text-small text-destructive">
            {error}
          </Text>
        ) : null}
        {vista.sondear ? <Text className="text-small text-muted-foreground">Comprobando el estado…</Text> : null}
      </Card>

      {vista.mostrarDivulgacion ? <Divulgacion consentimiento={panel.consentimientos.find((c) => c.tipo === 'IDENTIDAD_DIVULGACION_EMPRESAS')} /> : null}

      <Informacion panel={panel} abierta={vista.accion === 'verificar'} />

      {vista.puedeReportar || reportando || panel.incidenciasAbiertas.length > 0 ? (
        <Problema panel={panel} abierto={reportando} alAbrir={() => setReportando(true)} />
      ) : null}

      {vista.puedeBorrar ? <BorrarDatos /> : null}
    </View>
  )
}

/** Una casilla de consentimiento: el texto exacto que se registra. Objetivo táctil de 44 px, como la autorización de renovación. */
function Consentimiento({ c, marcada, alCambiar }: { c: ConsentimientoIdentidad; marcada: boolean; alCambiar: (v: boolean) => void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: marcada }}
      accessibilityLabel={c.titulo}
      onPress={() => alCambiar(!marcada)}
      className={`min-h-11 flex-row items-start gap-3 rounded-2xl border p-4 ${marcada ? 'border-primary/50 bg-primary/5' : 'border-border/60 bg-card'}`}
    >
      <View className={`mt-0.5 h-5 w-5 items-center justify-center rounded border ${marcada ? 'border-primary bg-primary' : 'border-input bg-background'}`}>
        {marcada ? <Check size={14} color={colors.surface.background} strokeWidth={3} /> : null}
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-sm font-inter-semibold text-foreground">
          {c.titulo}
          {!c.obligatorio ? <Text className="text-caption font-inter-regular text-muted-foreground"> (opcional)</Text> : null}
        </Text>
        {c.detalle ? <Text className="mt-1 text-small leading-5 text-muted-foreground">{c.detalle}</Text> : null}
      </View>
    </Pressable>
  )
}

function Divulgacion({ consentimiento }: { consentimiento?: ConsentimientoIdentidad }) {
  const cambiar = useCambiarConsentimientoIdentidad()
  if (!consentimiento) return null
  const permitido = consentimiento.vigente
  return (
    <Card className="gap-3 p-4">
      <View className="flex-row items-center gap-2">
        <Building2 size={16} color={colors.surface.mutedForeground} />
        <Text className="text-h4 font-inter-semibold text-foreground">Qué ven los negocios</Text>
      </View>
      <Text className="text-small leading-5 text-muted-foreground">
        {permitido
          ? 'Los negocios donde eres cliente ven que estás verificado y desde cuándo. Nunca ven tu cédula ni tu selfie.'
          : 'Los negocios donde eres cliente no ven nada de tu verificación. Si quieres, pueden ver solo que estás verificado y desde cuándo; nunca tu cédula ni tu selfie.'}
      </Text>
      <Button
        variant="outline"
        loading={cambiar.isPending}
        disabled={cambiar.isPending}
        onPress={() => cambiar.mutate({ tipo: consentimiento.tipo, accion: permitido ? 'retirar' : 'aceptar', version: consentimiento.textoVersion })}
      >
        {permitido ? 'Dejar de mostrarlo' : 'Permitir que lo vean'}
      </Button>
      {cambiar.isError ? <Text className="text-small text-destructive">{cambiar.error.message}</Text> : null}
    </Card>
  )
}

function Informacion({ panel, abierta }: { panel: PanelIdentidad; abierta: boolean }) {
  return (
    <Card className="gap-3 p-4">
      <Plegable icono={<FileCheck2 size={16} color={colors.surface.mutedForeground} />} titulo="Cómo funciona" abierta={abierta}>
        {panel.pasos.map((p, i) => (
          <Text key={p} className="text-small leading-5 text-muted-foreground">
            {i + 1}. {p}
          </Text>
        ))}
      </Plegable>
      <Plegable icono={<LockKeyhole size={16} color={colors.surface.mutedForeground} />} titulo="Tu privacidad" abierta={abierta}>
        {panel.privacidad.map((p) => (
          <Text key={p} className="text-small leading-5 text-muted-foreground">
            • {p}
          </Text>
        ))}
        <Pressable accessibilityRole="link" className="min-h-11 justify-center" onPress={() => void Linking.openURL(URL_BASE_PUBLICA + panel.urlCondiciones)}>
          <Text className="text-small text-muted-foreground underline">Leer la política de privacidad completa</Text>
        </Pressable>
      </Plegable>
    </Card>
  )
}

function Plegable({ icono, titulo, abierta, children }: { icono: React.ReactNode; titulo: string; abierta: boolean; children: React.ReactNode }) {
  const [abierto, setAbierto] = useState(abierta)
  return (
    <View className="rounded-xl border border-border/60 px-4">
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: abierto }} onPress={() => setAbierto((v) => !v)} className="min-h-11 flex-row items-center gap-2">
        {icono}
        <Text className="flex-1 text-h4 font-inter-semibold text-foreground">{titulo}</Text>
        {abierto ? <ChevronUp size={16} color={colors.surface.mutedForeground} /> : <ChevronDown size={16} color={colors.surface.mutedForeground} />}
      </Pressable>
      {abierto ? <View className="gap-1.5 pb-3">{children}</View> : null}
    </View>
  )
}

function Problema({ panel, abierto, alAbrir }: { panel: PanelIdentidad; abierto: boolean; alAbrir: () => void }) {
  const reportar = useReportarProblemaIdentidad()
  const [tipo, setTipo] = useState('')
  const [mensaje, setMensaje] = useState('')
  const enviar = () => {
    reportar.mutate(
      { tipo, mensaje, intentoId: panel.intentoId },
      {
        onSuccess: () => {
          setMensaje('')
          setTipo('')
          Alert.alert('Recibimos tu reporte', 'Lo revisaremos y te escribiremos.')
        },
      }
    )
  }
  return (
    <Card className="gap-3 p-4">
      <View className="flex-row items-center gap-2">
        <Headset size={16} color={colors.surface.mutedForeground} />
        <Text className="text-h4 font-inter-semibold text-foreground">¿Algo no va bien?</Text>
      </View>
      {panel.incidenciasAbiertas.map((i) => (
        <View key={i.id} className="rounded-xl border border-border/60 p-3">
          <Text className="text-small font-inter-medium text-foreground">{i.etiqueta}</Text>
          <Text className="text-caption text-muted-foreground">Reporte abierto desde el {i.desde}. Lo estamos revisando.</Text>
        </View>
      ))}
      {!abierto ? (
        <>
          <Button variant="outline" onPress={alAbrir}>
            Contar mi problema
          </Button>
          <Pressable accessibilityRole="link" className="min-h-11 justify-center" onPress={() => void Linking.openURL(`mailto:${panel.soporte.email}`)}>
            <Text className="text-caption text-muted-foreground">
              O escríbenos a {panel.soporte.email} o por WhatsApp al {panel.soporte.whatsapp}.
            </Text>
          </Pressable>
        </>
      ) : (
        <View className="gap-3">
          <Text className="text-small font-inter-medium text-foreground">¿Qué pasa?</Text>
          <View className="gap-2">
            {panel.tiposDeIncidencia.map((t) => (
              <Pressable
                key={t.valor}
                accessibilityRole="radio"
                accessibilityState={{ checked: tipo === t.valor }}
                onPress={() => setTipo(t.valor)}
                className={`min-h-11 justify-center rounded-xl border px-4 ${tipo === t.valor ? 'border-primary/50 bg-primary/5' : 'border-border/60 bg-card'}`}
              >
                <Text className="text-small text-foreground">{t.etiqueta}</Text>
              </Pressable>
            ))}
          </View>
          <Input
            multiline
            value={mensaje}
            onChangeText={setMensaje}
            maxLength={panel.maxMensajeIncidencia}
            placeholder="Cuéntanos más"
            accessibilityLabel="Cuéntanos más"
            className="h-28 py-2"
            textAlignVertical="top"
          />
          <Text className="text-caption text-muted-foreground">
            {panel.avisoDeIncidencia} ({mensaje.length}/{panel.maxMensajeIncidencia})
          </Text>
          <Button onPress={enviar} disabled={reportar.isPending || !tipo || mensaje.trim().length === 0} loading={reportar.isPending}>
            Enviar reporte
          </Button>
          {reportar.isError ? <Text accessibilityLiveRegion="polite" className="text-small text-destructive">{reportar.error.message}</Text> : null}
        </View>
      )}
    </Card>
  )
}

function BorrarDatos() {
  const borrar = useBorrarDatosIdentidad()
  const confirmar = () =>
    Alert.alert(
      '¿Borrar tus datos de verificación?',
      'Perderás tu verificación y no se puede deshacer. Podrás verificarte de nuevo cuando quieras.',
      [
        { text: 'Conservarlos', style: 'cancel' },
        { text: 'Sí, borrar', style: 'destructive', onPress: () => borrar.mutate() },
      ]
    )
  return (
    <Card className="gap-3 p-4">
      <View className="flex-row items-center gap-2">
        <Trash2 size={16} color={colors.surface.mutedForeground} />
        <Text className="text-h4 font-inter-semibold text-foreground">Borrar mis datos de verificación</Text>
      </View>
      <Text className="text-small leading-5 text-muted-foreground">
        Borramos tu resultado de verificación y le pedimos a nuestro proveedor que elimine cualquier dato tuyo. Es definitivo: si más adelante quieres estar verificado, tendrás que hacerlo de nuevo.
      </Text>
      <Button variant="outline" loading={borrar.isPending} disabled={borrar.isPending} icon={<Trash2 size={15} color={colors.state.danger} />} onPress={confirmar}>
        Borrar mis datos
      </Button>
      {borrar.isError ? <Text accessibilityLiveRegion="polite" className="text-small text-destructive">{borrar.error.message}</Text> : null}
    </Card>
  )
}

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Text, View } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import { LockKeyhole, ShieldCheck } from 'lucide-react-native'
import { api } from '../../../lib/api'
import { colors } from '../../../theme/tokens'
import { Button } from '../../ui/Button'
import type { CardnetCaptureSurfaceProps } from './capture.types'
import { CARDNET_WINDOW_RETURN_URL, parseCardnetWindowReturn } from './security'

/**
 * EL FORMULARIO DE CARDNET EN EL TELÉFONO SE ABRE EN EL NAVEGADOR DEL SISTEMA, NO EN UNA WEBVIEW (14-10-2026).
 *
 * En Android, dentro de la WebView, CardNET respondía «la autenticación falló» a toda tarjeta cuyo banco pide la
 * verificación 3D Secure, mientras la MISMA tarjeta se registraba bien en membego.com desde Chrome en el mismo teléfono.
 * La verificación del banco necesita lo que un navegador completo da y una WebView no. Así que la app abre la ventana de
 * CardNET que sirve el servidor (`/api/v1/cliente/pagos/cardnet/ventana`) en una pestaña de Chrome (Android) o en
 * Safari (iPhone): el mismo motor en el que ya funciona, con el formulario oficial de CardNET y los mismos parámetros.
 *
 * Al registrar la tarjeta, la ventana vuelve a la app (`CARDNET_WINDOW_RETURN_URL`) con el token y se confirma como
 * antes, con la sesión autenticada y el nonce. Si esa vuelta se pierde (el cliente cierra la pestaña a mano), el sondeo
 * de `Capture.tsx` sigue preguntando y el servidor ve la tarjeta nueva en CardNET y avanza el pago.
 */
export default function CardnetCaptureSurface({
  session,
  disabled = false,
  onToken,
  onError,
}: CardnetCaptureSurfaceProps) {
  const [open, setOpen] = useState(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const openCapture = useCallback(async () => {
    if (disabled || open) return
    setOpen(true)
    try {
      const result = await WebBrowser.openAuthSessionAsync(
        api.cardnetCaptureWindowUrl({ sessionId: session.sessionId, captureNonce: session.captureNonce }),
        CARDNET_WINDOW_RETURN_URL,
        // Sin sesión compartida: en iPhone evita el aviso «quiere usar … para iniciar sesión», que aquí no aplica.
        { preferEphemeralSession: true }
      )
      if (result.type === 'success') {
        const token = parseCardnetWindowReturn(result.url, session.sessionId)
        if (token) onToken(token)
      }
    } catch {
      onError('widget_unavailable')
    } finally {
      if (mounted.current) setOpen(false)
    }
  }, [disabled, onError, onToken, open, session.captureNonce, session.sessionId])

  if (disabled) {
    return (
      <View className="min-h-[180px] items-center justify-center rounded-xl border border-border bg-muted px-4 py-6">
        <Text className="text-center text-sm text-muted-foreground">La captura segura está cerrada.</Text>
      </View>
    )
  }

  return (
    <View className="gap-3">
      <View className={`min-h-[164px] items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-5 ${open ? 'border-primary/30 bg-primary/5' : 'border-border bg-muted/60'}`}>
        <View className="h-10 w-10 items-center justify-center rounded-xl bg-card">
          {open ? <ShieldCheck size={19} color={colors.primary.DEFAULT} /> : <LockKeyhole size={19} color={colors.primary.DEFAULT} />}
        </View>
        <Text className="text-center text-sm font-inter-semibold text-foreground">
          {open ? 'Completa el formulario de CardNET en el navegador' : 'El formulario seguro se abre en el navegador'}
        </Text>
        <Text className="max-w-[340px] text-center text-sm leading-5 text-muted-foreground">
          {open
            ? 'Al registrar la tarjeta volverás aquí. Si cierras el navegador antes, esta pantalla igual comprobará el pago.'
            : 'Escribe los datos de tu tarjeta en CardNET. Tu banco puede pedirte una verificación; MembeGo no ve ni guarda la tarjeta.'}
        </Text>
      </View>
      <Button disabled={open} onPress={() => void openCapture()}>
        {open ? 'Esperando a CardNET…' : 'Abrir formulario de CardNET'}
      </Button>
      <View className="flex-row items-center justify-center gap-1.5">
        <ShieldCheck size={14} color={colors.surface.mutedForeground} />
        <Text className="text-xs text-muted-foreground">Conexión protegida por CardNET</Text>
      </View>
    </View>
  )
}

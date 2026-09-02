'use client'

import Script from 'next/script'
import { useActionState, useEffect, useRef, useState } from 'react'
import { altaMetaAction, type AltaState } from '@/modules/connect/altaActions'
import { Button } from '@/components/ui/button'
import { StatusBanner } from '@/components/ui/status-banner'

/**
 * ALTA INCRUSTADA DE META · el diálogo (Connect · Fase 14).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTE COMPONENTE ES DISTINTO A TODO LO DEMÁS DEL ASISTENTE
 *
 * El código que Meta devuelve vive TREINTA SEGUNDOS. No hay «revisa y pulsa
 * continuar»: en cuanto llega, se envía. Por eso este componente manda el
 * formulario SOLO, sin que nadie pulse nada, y por eso su acción es propia y
 * no la genérica de los pasos.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS CANALES QUE HAY QUE ESCUCHAR A LA VEZ
 *
 * Meta manda el resultado por dos vías distintas y hacen falta las dos:
 *
 *   · `message` de la ventana — trae el WABA y el número elegidos;
 *   · la respuesta de `FB.login` — trae el CÓDIGO canjeable.
 *
 * Ninguna trae las tres cosas, así que se juntan aquí. El `message` se filtra
 * por origen: aceptar mensajes de cualquier ventana sería dejar que otra
 * pestaña nos dicte qué cuenta conectar.
 *
 * NADA DE ESTO SE HA PROBADO CONTRA META. Se escribió contra la documentación
 * pública vigente, sin app con la que ejecutarlo.
 */

const INIT: AltaState = {}
const ORIGEN_META = 'https://www.facebook.com'

interface RespuestaLogin {
  authResponse?: { code?: string } | null
  status?: string
}

declare global {
  interface Window {
    FB?: {
      init: (opciones: Record<string, unknown>) => void
      login: (cb: (r: RespuestaLogin) => void, opciones: Record<string, unknown>) => void
    }
    fbAsyncInit?: () => void
  }
}

export function AltaMetaWhatsapp({
  appId,
  configId,
  versionGraph,
}: {
  appId: string
  configId: string
  versionGraph: string
}) {
  const [estado, enviar] = useActionState(altaMetaAction, INIT)
  const [listo, setListo] = useState(false)
  const [enCurso, setEnCurso] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  const formRef = useRef<HTMLFormElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)
  const wabaRef = useRef<HTMLInputElement>(null)
  const phoneRef = useRef<HTMLInputElement>(null)
  // Lo que llega por el canal de mensajes, a la espera del código.
  const seleccion = useRef<{ wabaId?: string; phoneNumberId?: string }>({})

  useEffect(() => {
    function alMensaje(e: MessageEvent) {
      // Filtrar por origen: sin esto, cualquier ventana podría decirnos qué
      // cuenta de WhatsApp conectar.
      if (e.origin !== ORIGEN_META) return
      try {
        const datos = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
        if (datos?.type !== 'WA_EMBEDDED_SIGNUP') return
        if (datos?.event === 'FINISH' || datos?.event === 'FINISH_ONLY_WABA') {
          seleccion.current = {
            wabaId: datos?.data?.waba_id,
            phoneNumberId: datos?.data?.phone_number_id,
          }
        }
        if (datos?.event === 'CANCEL') {
          setEnCurso(false)
          setAviso('Cerraste la ventana de Meta antes de terminar. No se guardó nada.')
        }
      } catch {
        // Un mensaje que no entendemos no es un error nuestro: se ignora.
      }
    }
    window.addEventListener('message', alMensaje)
    return () => window.removeEventListener('message', alMensaje)
  }, [])

  function abrirDialogo() {
    if (!window.FB) return
    setAviso(null)
    setEnCurso(true)
    seleccion.current = {}

    window.FB.login(
      (respuesta) => {
        const code = respuesta?.authResponse?.code
        const { wabaId, phoneNumberId } = seleccion.current

        if (!code || !wabaId || !phoneNumberId) {
          setEnCurso(false)
          setAviso('No se completó la conexión con Meta. No se guardó nada.')
          return
        }

        // AQUÍ EMPIEZAN LOS 30 SEGUNDOS. Se envía de inmediato.
        if (codeRef.current) codeRef.current.value = code
        if (wabaRef.current) wabaRef.current.value = wabaId
        if (phoneRef.current) phoneRef.current.value = phoneNumberId
        formRef.current?.requestSubmit()
      },
      {
        config_id: configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {}, featureType: '', sessionInfoVersion: '3' },
      }
    )
  }

  return (
    <div className="space-y-4">
      <Script
        src={`https://connect.facebook.net/en_US/sdk.js`}
        strategy="afterInteractive"
        onLoad={() => {
          window.FB?.init({ appId, autoLogAppEvents: true, xfbml: false, version: versionGraph })
          setListo(true)
        }}
      />

      {aviso && (
        <StatusBanner variant="warning" title="No se conectó WhatsApp">
          {aviso}
        </StatusBanner>
      )}
      {estado.error && (
        <StatusBanner variant="destructive" title="No se pudo conectar">
          {estado.error}
        </StatusBanner>
      )}
      {estado.success && (
        <StatusBanner variant="success" title="Listo">
          {estado.success}
        </StatusBanner>
      )}

      {/* El formulario lo envía el código, no una persona. */}
      <form ref={formRef} action={enviar} className="hidden">
        <input ref={codeRef} type="hidden" name="code" />
        <input ref={wabaRef} type="hidden" name="wabaId" />
        <input ref={phoneRef} type="hidden" name="phoneNumberId" />
      </form>

      <Button type="button" onClick={abrirDialogo} disabled={!listo || enCurso}>
        {!listo ? 'Cargando…' : enCurso ? 'Terminando en la ventana de Meta…' : 'Conéctate con Facebook'}
      </Button>

      <p className="text-caption text-muted-foreground">
        Se abre una ventana de Meta. Al terminar, Meta te pedirá añadir un método de pago en tu
        cuenta de WhatsApp Business: te factura a ti el uso de la mensajería.
      </p>
    </div>
  )
}

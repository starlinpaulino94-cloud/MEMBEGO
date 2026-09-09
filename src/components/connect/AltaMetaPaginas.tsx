'use client'

import Script from 'next/script'
import { useActionState, useEffect, useRef, useState } from 'react'
import { altaMetaPaginasAction, type AltaState } from '@/modules/connect/altaActions'
import { Button } from '@/components/ui/button'
import { StatusBanner } from '@/components/ui/status-banner'

/**
 * FACEBOOK E INSTAGRAM · el diálogo de Login for Business (Meta · Fase 3).
 *
 * El mismo patrón que el alta incrustada de WhatsApp: el SDK abre el diálogo
 * con la configuración de Páginas (`config_id`), devuelve un CÓDIGO
 * (`response_type: 'code'`, `override_default_response_type: true`), y el
 * código viaja a una acción de servidor que lo canjea. Aquí no hay token
 * nunca. Sin canal `postMessage`: para Páginas no hace falta —lo que Meta
 * concedió lo dice `debug_token` en el servidor.
 */

const INIT: AltaState = {}

declare global {
  interface Window {
    FB?: {
      init: (opciones: Record<string, unknown>) => void
      login: (
        cb: (r: { authResponse?: { code?: string } | null; status?: string }) => void,
        opciones: Record<string, unknown>
      ) => void
    }
  }
}

export function AltaMetaPaginas({ appId, configId, versionGraph }: { appId: string; configId: string; versionGraph: string }) {
  const [estado, enviar] = useActionState(altaMetaPaginasAction, INIT)
  const [listo, setListo] = useState(false)
  const [enCurso, setEnCurso] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)

  // El SDK puede estar ya en la página (WhatsApp lo carga igual): se espera a
  // que aparezca en vez de fiarse de `onLoad`, que no se repite.
  useEffect(() => {
    if (listo) return
    const t = setInterval(() => {
      if (!window.FB) return
      window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: versionGraph })
      setListo(true)
      clearInterval(t)
    }, 200)
    return () => clearInterval(t)
  }, [appId, listo, versionGraph])

  const hayError = Boolean(estado.error)

  function abrirDialogo() {
    if (!window.FB) return
    setAviso(null)
    setEnCurso(true)
    window.FB.login(
      (respuesta) => {
        const code = respuesta?.authResponse?.code
        if (!code) {
          setEnCurso(false)
          setAviso('No se completó la autorización con Meta. No se guardó nada.')
          return
        }
        if (codeRef.current) codeRef.current.value = code
        formRef.current?.requestSubmit()
      },
      { config_id: configId, response_type: 'code', override_default_response_type: true }
    )
  }

  return (
    <div className="space-y-4">
      <Script src="https://connect.facebook.net/en_US/sdk.js" strategy="afterInteractive" />

      {aviso && (
        <StatusBanner variant="warning" title="No se conectó Facebook">
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

      <form ref={formRef} action={enviar} className="hidden">
        <input ref={codeRef} type="hidden" name="code" />
      </form>

      <Button type="button" onClick={abrirDialogo} disabled={!listo || (enCurso && !hayError)}>
        {!listo
          ? 'Cargando…'
          : enCurso && !hayError
            ? 'Terminando en la ventana de Meta…'
            : hayError
              ? 'Volver a intentarlo'
              : 'Conéctate con Facebook'}
      </Button>
      <p className="text-caption text-muted-foreground">
        Se abre una ventana de Meta. Elige las Páginas y cuentas de Instagram que quieres que Membego
        pueda atender; el acceso caduca cada dos meses y te avisaremos para renovarlo.
      </p>
    </div>
  )
}

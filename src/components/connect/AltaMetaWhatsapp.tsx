'use client'

import Script from 'next/script'
import { useActionState, useCallback, useEffect, useRef, useState } from 'react'
import { altaMetaAction, type AltaState } from '@/modules/connect/altaActions'
import { Button } from '@/components/ui/button'
import { StatusBanner } from '@/components/ui/status-banner'
// Del módulo del NAVEGADOR y no del núcleo: el núcleo usa `node:crypto` y
// arrastrarlo aquí rompe el build de producción.
import { crearRecolector, leerMensajeMeta } from '@/modules/connect/metaNavegador'

/**
 * ALTA INCRUSTADA DE META · el diálogo (Fase 14 · corregido en la 14.1).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA CARRERA QUE LA AUDITORÍA ENCONTRÓ
 *
 * Meta entrega el resultado por DOS canales independientes:
 *
 *   · el evento `message` de la ventana → `wabaId` y `phoneNumberId`
 *   · la respuesta de `FB.login`        → el `code` canjeable
 *
 * Ninguno trae los tres valores, y NO HAY ORDEN GARANTIZADO. La primera
 * versión leía la selección dentro del callback de `FB.login`, dando por hecho
 * que el `message` habría llegado antes. Cuando llegaba después —que pasa— el
 * alta fallaba con «no se completó», sin motivo visible.
 *
 * Ahora los dos canales escriben en el mismo sitio y llaman a la MISMA
 * función, `intentarCompletar()`, que envía en cuanto tiene los tres valores y
 * NO ANTES. Da igual quién llegue primero.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EXACTAMENTE UNA VEZ
 *
 * Meta puede emitir el mismo evento dos veces. El pestillo `enviado` es un
 * `ref` y no un estado: se lee y se pone en el mismo tick, sin esperar a un
 * re-render, que es lo que hace que dos llamadas seguidas no pasen las dos.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TREINTA SEGUNDOS
 *
 * El código caduca en medio minuto: no hay «revisa y pulsa continuar». Se
 * envía solo.
 *
 * NADA DE ESTO SE HA PROBADO CONTRA META.
 */

const INIT: AltaState = {}

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

  /**
   * El recolector junta lo de los dos canales y decide cuándo hay bastante.
   * Vive en `modules/connect/metaNucleo` y es puro: los cuatro casos que
   * importan —código primero, mensaje primero, evento duplicado, reinicio tras
   * error— se prueban ejecutándolos, no leyendo este archivo.
   */
  const recolector = useRef(crearRecolector())

  /**
   * EL ÚNICO SITIO QUE ENVÍA. Lo llaman los dos canales; el primero que
   * complete los tres valores gana, y el segundo recibe null.
   */
  const intentarCompletar = useCallback((parcial: Parameters<typeof recolector.current.aportar>[0]) => {
    const listo = recolector.current.aportar(parcial)
    if (!listo) return

    if (codeRef.current) codeRef.current.value = listo.code
    if (wabaRef.current) wabaRef.current.value = listo.wabaId
    if (phoneRef.current) phoneRef.current.value = listo.phoneNumberId
    formRef.current?.requestSubmit()
  }, [])

  useEffect(() => {
    function alMensaje(e: MessageEvent) {
      // El origen se comprueba dentro de `leerMensajeMeta`, contra una lista
      // cerrada: nada de comodines ni de `endsWith('.facebook.com')`.
      const mensaje = leerMensajeMeta(e.origin, e.data)
      if (mensaje.tipo === 'seleccion') {
        intentarCompletar({
          wabaId: mensaje.wabaId,
          phoneNumberId: mensaje.phoneNumberId,
        })
        return
      }
      if (mensaje.tipo === 'cancelado') {
        setEnCurso(false)
        setAviso('Cerraste la ventana de Meta antes de terminar. No se guardó nada.')
      }
    }
    window.addEventListener('message', alMensaje)
    return () => window.removeEventListener('message', alMensaje)
  }, [intentarCompletar])

  /**
   * REINTENTAR SIN RECARGAR (F14.1 · punto 5).
   *
   * Si el servidor falla —canje, verificación, registro, suscripción o
   * guardado— el botón tiene que volver. La primera versión dejaba `enCurso`
   * en true para siempre y la única salida era recargar la página.
   *
   * El «ya no está en curso» se DERIVA de que hay error, en vez de escribirse
   * con un `setState` dentro de un efecto: menos estado que sincronizar y una
   * cascada de renders menos.
   */
  const hayError = Boolean(estado.error)
  useEffect(() => {
    if (hayError) {
      // Solo referencias: un intento fallido no puede contaminar el siguiente.
      recolector.current.reiniciar()
    }
  }, [hayError])

  /**
   * EL SDK PUEDE ESTAR YA CARGADO (F14.1 · remontaje).
   *
   * Al volver a este paso, `next/script` NO vuelve a disparar `onLoad` para un
   * script que ya está en la página: el botón se quedaba en «Cargando…» para
   * siempre y no había forma de conectar sin recargar.
   *
   * Se resuelve suscribiéndose a la aparición del SDK en vez de mirarlo una
   * sola vez — que además es el patrón que la regla de efectos pide: el
   * `setState` ocurre en el callback del intervalo, no en el cuerpo del
   * efecto.
   */
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

  function abrirDialogo() {
    if (!window.FB) return
    setAviso(null)
    setEnCurso(true)
    // Empezar de cero: un intento anterior no puede contaminar éste.
    recolector.current.reiniciar()

    window.FB.login(
      (respuesta) => {
        const code = respuesta?.authResponse?.code
        if (!code) {
          setEnCurso(false)
          setAviso('No se completó la autorización con Meta. No se guardó nada.')
          return
        }
        // Puede que el `message` ya haya llegado, o puede que llegue después.
        // El recolector lo resuelve en los dos casos.
        intentarCompletar({ code })
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
        src="https://connect.facebook.net/en_US/sdk.js"
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

      {/* Con error, el botón vuelve: se puede reintentar sin recargar. */}
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
        Se abre una ventana de Meta. Al terminar, Meta te pedirá añadir un método de pago en tu
        cuenta de WhatsApp Business: te factura a ti el uso de la mensajería.
      </p>
    </div>
  )
}

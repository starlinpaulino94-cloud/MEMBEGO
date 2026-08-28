'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CreditCard, Loader2, CheckCircle2, ShieldCheck, AlertCircle, Lock } from 'lucide-react'
import { toast } from 'sonner'
import {
  tokenDe,
  refsGuardado,
  textoSeguroWidget,
  imagenSeguraWidget,
} from '@/lib/payments/cardnet-widget'
import { normalizarCodigoActivacion } from '@/lib/payments/cardnet-tokens-core'
import { Button } from '@/components/ui/button'

/**
 * Pago con tarjeta HOSPEDADO por CardNET (tokenización).
 *
 * La tarjeta se digita en un IFRAME de CardNET (su script `PWCheckout.js`),
 * nunca en nuestro DOM. CardNET nos devuelve un TOKEN por el callback
 * `tokenCreated`; ese token —no la tarjeta— viaja a nuestro servidor, que cobra
 * con el monto de la base. Aquí NUNCA se ve ni se toca el número de tarjeta.
 *
 * VERIFICAR-QA: la forma exacta del objeto que entrega `tokenCreated` y el
 * nombre del método para abrir el iframe se confirman contra el QA de CardNET
 * (ver docs/PAGOS-CARDNET.md). El componente cubre las variantes conocidas.
 */

// Superficie mínima del SDK de CardNET que usamos. `unknown` en lo demás.
interface PWCheckoutSDK {
  Bind: (evento: string, cb: (data: unknown) => void) => void
  SetProperties: (props: Record<string, unknown>) => void
  OpenIframeCustom?: (url: string, uniqueId: string) => void
  OpenIframe?: (url: string, uniqueId: string) => void
  Iframe?: { Close?: (...args: unknown[]) => unknown }
}

/**
 * BLINDAJE CONTRA UN BUG DEL WIDGET DEL PROVEEDOR (visto en vivo): su
 * `Iframe.Close` revienta con "Cannot read properties of null (reading
 * 'parentNode')" cuando intenta cerrar una ventana ya cerrada. La excepción
 * mata el manejador donde ocurre — y la ENTREGA DEL TOKEN viene justo después
 * del Close en ese mismo manejador, así que el token se pierde dentro del
 * widget. Envolver Close en try/catch deja que su código continúe.
 */
function blindarCierre(sdk: PWCheckoutSDK) {
  const iframeObj = sdk.Iframe
  if (!iframeObj || typeof iframeObj.Close !== 'function') return
  const actual = iframeObj.Close as ((...args: unknown[]) => unknown) & { _blindado?: boolean }
  if (actual._blindado) return
  const original = actual.bind(iframeObj)
  const seguro = ((...args: unknown[]) => {
    try {
      return original(...args)
    } catch {
      // La ventana ya no estaba: cerrar dos veces no es un error.
      return undefined
    }
  }) as ((...args: unknown[]) => unknown) & { _blindado?: boolean }
  seguro._blindado = true
  iframeObj.Close = seguro
}

declare global {
  interface Window {
    PWCheckout?: PWCheckoutSDK
  }
}

interface Props {
  membershipId: string
  /** Texto del monto para el botón (ej. "RD$1,600"). */
  montoTexto: string
  /** Config PÚBLICA de la pasarela (no incluye la llave privada). */
  publicKey: string
  captureUrl: string
  scriptUrl: string
  /** Marca que ve el cliente dentro de la ventana de pago. */
  companyName?: string
  /** Logo (URL absoluta) que la ventana de pago muestra en su cabecera. */
  logoUrl?: string | null
  /** A dónde ir cuando el pago aprueba. */
  urlExito?: string
}

interface SesionCaptura {
  captureUrl: string
  /** Script del widget, del MISMO origen que `captureUrl` (lo deriva el servidor). */
  scriptUrl: string
  uniqueId: string
  publicKey: string
  creadaEn: number
  /** Tarjetas que el proveedor ya tenía ANTES de abrir esta ventana. */
  conteoPerfiles: number
  /** Customer de la sesión: la confirmación consulta por GET con él. */
  customerId: string | null
}

// Una sesión pre-creada se considera fresca por 4 minutos; después se pide otra.
const SESION_TTL_MS = 4 * 60 * 1000

// Formulario oculto donde el widget del proveedor inserta el token (manual
// §3.2: `form_id` es obligatorio; el input debe llamarse PWToken).
const FORM_ID = 'membego_pago_form'

type Estado = 'cargando' | 'listo' | 'capturando' | 'cobrando' | 'activacion' | 'aprobado' | 'error'

/**
 * Lo que devuelven `/cobrar`, `/confirmar` y `/activar`.
 *
 * Está escrito una sola vez y a propósito: los tres caminos se leían con tres
 * castings distintos, y el que faltaba —`compraId` / `membershipId`— es
 * justamente el que el comprobante necesita. Con un solo tipo, añadir un campo
 * al servidor y olvidarse de uno de los tres sitios deja de ser posible.
 *
 * Solo lleva campos que el servidor manda DE VERDAD. No hay `ultimos4` ni
 * `codigoAutorizacion` porque las rutas no los devuelven, y una pantalla de
 * pago con una fila inventada es lo peor que se le puede enseñar a alguien
 * que acaba de dar su tarjeta.
 */
interface RespuestaPago {
  estado?: string
  motivo?: string
  compraId?: string | null
  membershipId?: string | null
}

// Rastro de diagnóstico en la consola del navegador (estados y presencia,
// nunca el token ni datos de tarjeta). Va por console.warn porque es el único
// nivel informativo que permite el linter del proyecto.
const rastro = (...datos: unknown[]) => console.warn(...datos)

export function PagoTokenCardnet({
  membershipId,
  montoTexto,
  publicKey,
  scriptUrl: scriptUrlProp,
  companyName,
  logoUrl,
  urlExito,
}: Props) {
  const router = useRouter()
  /**
   * De dónde se carga el widget. Arranca con el valor de la configuración y
   * lo reemplaza el que devuelve la sesión, que sale del `CaptureURL` real de
   * CardNET. Así el SDK y el iframe quedan siempre en el mismo origen: es la
   * condición para que el token pueda volver del iframe a esta página.
   */
  const [scriptUrl, setScriptUrl] = useState(scriptUrlProp)
  const [estado, setEstado] = useState<Estado>('cargando')
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [guardar, setGuardar] = useState(false)
  // Pantalla de activación (llaves CON autenticación): el código del banco.
  const [codigoActivacion, setCodigoActivacion] = useState('')
  const [activando, setActivando] = useState(false)
  /**
   * Segundos que lleva la verificación en curso.
   *
   * Verificar y cobrar son TRES llamadas encadenadas al proveedor, y aunque
   * ya no son cinco, siguen pudiendo tardar. Un botón que solo gira no dice si
   * avanza o si se colgó — y en esa duda es donde el cliente cierra la pestaña
   * a mitad de un cobro, que es la peor forma de terminar.
   */
  const [segundosEsperando, setSegundosEsperando] = useState(0)
  // El contador se pone a cero al ARRANCAR la operación, no aquí: escribir
  // estado de forma síncrona dentro de un efecto es justo lo que el linter
  // señala, y en este caso no hacía falta — el momento de reiniciar un reloj
  // es cuando empieza lo que mide.
  useEffect(() => {
    if (!activando) return
    const id = setInterval(() => setSegundosEsperando((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [activando])
  /**
   * La tarjeta que quedó registrada esperando su código, si la hay.
   *
   * No es lo mismo que `estado === 'activacion'`: eso es «estoy tecleando el
   * código AHORA». Esto es «existe una tarjeta pendiente», que sobrevive a que
   * el cliente salga de la pantalla de activación —porque el código todavía no
   * aparece en su banco— y es lo que permite volver sin registrar la tarjeta
   * otra vez ni provocar un segundo cargo de RD$1.00.
   */
  const [tarjetaPendiente, setTarjetaPendiente] = useState<{
    marca: string | null
    ultimos4: string | null
  } | null>(null)
  /**
   * El comprobante de lo que acaba de pasar.
   *
   * Solo lleva lo que el servidor devolvió DE VERDAD: la referencia del cobro
   * y el instante en que se aprobó. No hay fila de «método» ni de «próximo
   * cobro» porque el servidor no las da, y una tabla con datos inventados en
   * una pantalla de pago es la peor cosa que se puede enseñar.
   */
  const [comprobante, setComprobante] = useState<{
    referencia: string | null
    cuando: Date
  } | null>(null)
  /**
   * Qué clase de error es el que se está enseñando.
   *
   * `estado === 'error'` cubre cosas muy distintas: una tarjeta rechazada, una
   * tarjeta que quedó activa pero sin cobrar, un corte por tiempo. Solo en el
   * primer caso se puede afirmar que NO se cobró; decirlo en los otros sería
   * mentir sobre dinero, que es la única mentira que no se perdona en una
   * pantalla de pago.
   */
  const [tipoError, setTipoError] = useState<'rechazo' | 'otro'>('otro')
  const cobrandoRef = useRef(false)
  // Confirmación por servidor en curso (no solapar sondeos).
  const confirmandoRef = useRef(false)
  // Tarjetas que ya existían al abrir la ventana (línea base del sondeo).
  const conteoAntesRef = useRef(0)
  // Customer de la sesión abierta: la confirmación consulta por GET con él.
  const customerIdRef = useRef<string | null>(null)
  // Sesión pre-creada en segundo plano para que el clic abra al instante.
  const sesionRef = useRef<SesionCaptura | null>(null)
  // Último payload de tokenCreated: de aquí salen las referencias para guardar.
  const tokenDataRef = useRef<unknown>(null)
  const guardarRef = useRef(false)
  useEffect(() => {
    guardarRef.current = guardar
  }, [guardar])

  /**
   * Deja constancia de lo que acaba de aprobarse, con la referencia que el
   * servidor devolvió. Si no vino ninguna, la fila simplemente no se enseña:
   * un comprobante sin referencia es incompleto, uno con una referencia
   * inventada es falso.
   */
  const anotarComprobante = useCallback((data: RespuestaPago) => {
    setComprobante({
      referencia: data.compraId ?? data.membershipId ?? null,
      cuando: new Date(),
    })
  }, [])

  // Guarda la tarjeta (Fase 2) tras un cobro aprobado, si el cliente lo pidió.
  const guardarTarjeta = useCallback(async () => {
    const refs = refsGuardado(tokenDataRef.current)
    if (!refs.customerId && !refs.paymentProfileId && !refs.token) return
    try {
      await fetch('/api/pagos/cardnet-token/guardar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ membershipId, ...refs }),
      })
    } catch {
      // No es crítico para el cobro (que ya aprobó): si falla, el cliente
      // simplemente no queda con renovación automática. No se le alarma.
    }
  }, [membershipId])

  // Cobra en nuestro servidor con el token que devolvió el iframe.
  const cobrar = useCallback(
    async (trxToken: string) => {
      if (cobrandoRef.current) return
      cobrandoRef.current = true
      setEstado('cobrando')
      setMensaje(null)
      // Cada intento empieza sin veredicto. Si no se limpiara, el «no se te
      // cobró» de un rechazo anterior sobreviviría a un fallo técnico
      // posterior y afirmaría algo sobre un dinero que nadie comprobó.
      setTipoError('otro')
      try {
        const resp = await fetch('/api/pagos/cardnet-token/cobrar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ membershipId, trxToken }),
        })
        const data = (await resp.json().catch(() => ({}))) as RespuestaPago
        rastro('[pago] resultado del cobro:', data.estado ?? resp.status, data.motivo ?? '')
        if (data.estado === 'aprobado') {
          if (guardarRef.current) await guardarTarjeta()
          anotarComprobante(data)
          setEstado('aprobado')
          toast.success('¡Pago aprobado! Tu membresía está activa.')
          // El refresco ya NO es automático: lo dispara el cliente desde la
          // pantalla de pago aprobado. Ver la nota larga en esa pantalla.
          if (urlExito) router.push(urlExito)
        } else if (data.estado === 'pendiente_activacion') {
          // La pasarela dijo CS012: la tarjeta está registrada pero sin
          // activar. Este camino ANTES caía en el `else` de abajo y le decía
          // al cliente «no se pudo procesar el pago», con su código de
          // activación ya en la app del banco y ningún campo donde ponerlo.
          // Se deja constancia de que hay una tarjeta esperando. Sin esto, el
          // aviso de vuelta solo existía si la sonda del montaje la había
          // encontrado: quien llegaba aquí desde un cobro y luego salía por
          // cualquier motivo se quedaba sin camino de regreso.
          setTarjetaPendiente((previo) => previo ?? { marca: null, ultimos4: null })
          setEstado('activacion')
          setMensaje(data.motivo ?? 'Tu tarjeta necesita activarse antes de poder cobrarla.')
        } else {
          setTipoError(data.estado === 'rechazado' ? 'rechazo' : 'otro')
          setEstado('error')
          // SOLO se dice "rechazada" si el servidor rechazó DE VERDAD. Antes,
          // cualquier otro final (sesión vencida, límite de intentos, un 500,
          // una respuesta ilegible) caía aquí con el mismo texto, y culpaba a
          // la tarjeta de fallos que no eran de la tarjeta. Eso mandó una
          // depuración entera a buscar en la pasarela un problema que estaba
          // de este lado.
          setMensaje(
            data.motivo ??
              (data.estado === 'rechazado'
                ? 'La tarjeta fue rechazada.'
                : `No se pudo procesar el pago (${data.estado ?? `HTTP ${resp.status}`}). Intenta de nuevo.`)
          )
        }
      } catch {
        setEstado('error')
        setMensaje('No se pudo confirmar el pago. Revisa tu conexión e intenta de nuevo.')
      } finally {
        cobrandoRef.current = false
      }
    },
    [membershipId, router, urlExito, guardarTarjeta, anotarComprobante]
  )

  // Carga el script de CardNET una sola vez y engancha el callback del token.
  useEffect(() => {
    let cancelado = false

    function enganchar() {
      const sdk = window.PWCheckout
      if (!sdk) return false
      blindarCierre(sdk)
      const manejarToken = (data: unknown) => {
        tokenDataRef.current = data
        const t = tokenDe(data)
        // Rastro de diagnóstico (nunca el token en sí).
        rastro('[pago] callback del widget:', t ? 'token recibido' : 'sin token', typeof data)
        if (t) void cobrar(t)
        else {
          setEstado('error')
          setMensaje('No se recibió la tarjeta. Intenta de nuevo.')
        }
      }
      // El nombre documentado es `tokenCreated`; se cubren grafías alternas
      // por si el widget del proveedor usa otra. Un nombre no soportado no
      // debe tumbar el enganche del resto.
      for (const evento of ['tokenCreated', 'TokenCreated', 'token_created']) {
        try {
          sdk.Bind(evento, manejarToken)
        } catch {
          // nombre de evento no soportado por esta versión del widget
        }
      }
      if (!cancelado) setEstado('listo')
      return true
    }

    if (enganchar()) return

    const src = `${scriptUrl}?key=${encodeURIComponent(publicKey)}`
    let script = document.querySelector<HTMLScriptElement>(`script[data-pwcheckout="1"]`)
    /**
     * SI EL `src` CAMBIÓ, EL SCRIPT VIEJO NO SIRVE.
     *
     * Se reutilizaba la etiqueta existente sin mirar a dónde apuntaba. La
     * llave y el ambiente viajan EN LA URL (`?key=…`, y el host cambia entre
     * pruebas y producción), así que al cambiar de juego de llaves seguía
     * cargado el widget de la cuenta anterior — y el síntoma es justamente
     * «el pago seguro todavía no está listo», sin nada que apunte a la causa.
     *
     * Se sustituye por uno nuevo. `PWCheckout` lo define el script al
     * evaluarse, así que basta con volver a cargarlo.
     */
    if (script && script.src !== src) {
      script.remove()
      script = null
    }
    if (!script) {
      script = document.createElement('script')
      script.src = src
      script.async = true
      script.dataset.pwcheckout = '1'
      document.head.appendChild(script)
    }
    const onLoad = () => {
      if (!enganchar() && !cancelado) {
        setEstado('error')
        setMensaje('No se pudo abrir el pago seguro. Recarga la página e intenta de nuevo.')
      }
    }
    script.addEventListener('load', onLoad)
    const onError = () => {
      if (!cancelado) {
        setEstado('error')
        setMensaje('No se pudo abrir el pago seguro. Revisa tu conexión e intenta de nuevo.')
      }
    }
    script.addEventListener('error', onError)

    return () => {
      cancelado = true
      script?.removeEventListener('load', onLoad)
      script?.removeEventListener('error', onError)
    }
  }, [scriptUrl, publicKey, cobrar])

  // Pide al servidor una sesión de captura válida (CaptureURL + UniqueID
  // reales del proveedor; con un id inventado la ventana no abre).
  /**
   * Motivo por el que la última sesión no se pudo crear. Se guarda para no
   * quemar el presupuesto del limitador con reintentos en segundo plano.
   */
  const limitadoRef = useRef(false)
  const motivoSesionRef = useRef<string | null>(null)

  const pedirSesion = useCallback(async (): Promise<SesionCaptura | null> => {
    try {
      const resp = await fetch('/api/pagos/cardnet-token/sesion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = (await resp.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        captureUrl?: string
        scriptUrl?: string
        uniqueId?: string
        publicKey?: string
        conteoPerfiles?: number
        customerId?: string | null
      }
      // 429 del limitador de pagos: NO es un fallo de la pasarela. Se anota
      // para que el prefetch de fondo deje de pedir —cada intento extra
      // renueva el castigo— y para poder decirle al cliente qué pasa de
      // verdad. Antes, este caso salía como «No se pudo iniciar la ventana de
      // pago», que apunta a CardNET y manda a depurar al lugar equivocado.
      limitadoRef.current = resp.status === 429
      if (limitadoRef.current) {
        motivoSesionRef.current = data.error || 'Demasiados intentos. Espera un momento.'
        return null
      }
      if (!data.ok || !data.captureUrl || !data.uniqueId) {
        motivoSesionRef.current = data.error || null
        return null
      }
      motivoSesionRef.current = null
      return {
        captureUrl: data.captureUrl,
        scriptUrl: data.scriptUrl || scriptUrlProp,
        uniqueId: data.uniqueId,
        publicKey: data.publicKey || publicKey,
        creadaEn: Date.now(),
        conteoPerfiles: typeof data.conteoPerfiles === 'number' ? data.conteoPerfiles : 0,
        customerId: typeof data.customerId === 'string' ? data.customerId : null,
      }
    } catch {
      return null
    }
  }, [publicKey, scriptUrlProp])

  // PRE-CREA la sesión en segundo plano apenas la pasarela está lista: así el
  // clic en "Pagar" abre la ventana al instante en vez de esperar al proveedor.
  useEffect(() => {
    // El prefetch NO corre si la última petición chocó con el limitador: el
    // efecto se redispara con cada 'error', así que seguir pidiendo convierte
    // un límite pasajero en uno permanente — se renueva solo.
    if ((estado !== 'listo' && estado !== 'error') || sesionRef.current) return
    if (limitadoRef.current) return
    let cancelado = false
    void pedirSesion().then((s) => {
      if (cancelado || !s) return
      sesionRef.current = s
      // Si CardNET sirve la captura desde otro host del que se cargó el SDK,
      // se recarga el widget desde el host correcto ANTES de que el cliente
      // haga clic. Con los dos en orígenes distintos el token no vuelve.
      // Forma funcional: compara contra el valor vigente sin tener que leerlo
      // aquí, así el efecto no depende de `scriptUrl` y no se reengancha solo.
      if (s.scriptUrl) setScriptUrl((actual) => (s.scriptUrl === actual ? actual : s.scriptUrl))
    })
    return () => {
      cancelado = true
    }
  }, [estado, pedirSesion])

  /**
   * CONFIRMACIÓN POR SERVIDOR (el camino OFICIAL del proveedor): el servidor
   * consulta si ya hay una tarjeta recién registrada y cobra con ella — el
   * navegador no necesita recibir ningún token. Devuelve true si el asunto
   * quedó resuelto (aprobado, rechazado o ya no hay nada pendiente).
   */
  const confirmarEnServidor = useCallback(async (): Promise<boolean> => {
    if (cobrandoRef.current || confirmandoRef.current) return false
    confirmandoRef.current = true
    try {
      const resp = await fetch('/api/pagos/cardnet-token/confirmar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          membershipId,
          guardar: guardarRef.current,
          conteoAntes: conteoAntesRef.current,
          customerId: customerIdRef.current,
        }),
      })
      const data = (await resp.json().catch(() => ({}))) as RespuestaPago
      rastro('[pago] confirmación en servidor:', data.estado ?? resp.status, data.motivo ?? '')
      if (data.estado === 'aprobado') {
        anotarComprobante(data)
        setEstado('aprobado')
        toast.success('¡Pago aprobado! Tu membresía está activa.')
        if (urlExito) router.push(urlExito)
        return true
      }
      if (data.estado === 'rechazado') {
        setTipoError('rechazo')
        setEstado('error')
        // Aquí sí es un rechazo real: el servidor cobró y la pasarela dijo que
        // no. Este camino ya estaba bien acotado; el del cobro directo no.
        setMensaje(data.motivo ?? 'La tarjeta fue rechazada.')
        return true
      }
      if (data.estado === 'pendiente_activacion') {
        // La tarjeta existe pero CardNET la dejó deshabilitada hasta que el
        // cliente ingrese el código que le cobró su banco (§4.1.2.3). Ya no es
        // un callejón: se abre la pantalla de activación, que activa y cobra
        // en el mismo movimiento.
        setTarjetaPendiente((previo) => previo ?? { marca: null, ultimos4: null })
        setEstado('activacion')
        setMensaje(data.motivo ?? 'Tu tarjeta necesita activarse antes de poder cobrarla.')
        return true
      }
      if (data.estado === 'sin_pendiente') {
        // Otro canal ya cobró (u otra pestaña): la página se pone al día.
        setEstado('listo')
        router.refresh()
        return true
      }
      // sin_tarjeta / en_proceso / error transitorio: seguir esperando.
      return false
    } catch {
      return false
    } finally {
      confirmandoRef.current = false
    }
  }, [membershipId, router, urlExito, anotarComprobante])

  // OJO: NO se consulta al proveedor mientras la ventana está abierta —
  // cualquier operación sobre el Customer invalida el UniqueID de la ventana
  // y la mata con INTERNAL_SERVER_ERROR. La confirmación corre únicamente
  // cuando la ventana se cierra (efecto de cierre, más abajo).

  // Lee el token del input oculto PWToken (si el widget lo dejó ahí) y cobra.
  const cobrarDelFormulario = useCallback(() => {
    const input = document.querySelector<HTMLInputElement>(`#${FORM_ID} input[name="PWToken"]`)
    const t = input?.value?.trim()
    if (input && t && !cobrandoRef.current) {
      input.value = ''
      rastro('[pago] token encontrado en el formulario oculto')
      void cobrar(t)
      return true
    }
    return false
  }, [cobrar])

  // PLAN B mientras la ventana está abierta: si el callback del widget no
  // dispara (o cambia de nombre), el token igual aparece en el input oculto
  // PWToken — se vigila y se cobra con él. `cobrandoRef` evita el doble cobro
  // si ambos caminos llegan.
  useEffect(() => {
    if (estado !== 'capturando') return
    const intervalo = setInterval(cobrarDelFormulario, 500)
    return () => clearInterval(intervalo)
  }, [estado, cobrarDelFormulario])

  // PLAN C: algunos widgets "envían" el formulario al terminar en vez de (o
  // además de) disparar el callback. Un submit nativo navegaría la página y
  // perdería el token — se intercepta (tanto el evento como el método
  // programático .submit()) para cobrar aquí mismo.
  useEffect(() => {
    const form = document.getElementById(FORM_ID) as HTMLFormElement | null
    if (!form) return
    const alEnviar = (e: Event) => {
      e.preventDefault()
      cobrarDelFormulario()
    }
    form.addEventListener('submit', alEnviar)
    const originalSubmit = form.submit.bind(form)
    ;(form as unknown as { submit: () => void }).submit = () => {
      cobrarDelFormulario()
    }
    return () => {
      form.removeEventListener('submit', alEnviar)
      ;(form as unknown as { submit: () => void }).submit = originalSubmit
    }
  }, [cobrarDelFormulario])

  // PLAN D: escuchar los mensajes que la ventana del proveedor manda a la
  // página (postMessage). Si en alguno viene el token, se cobra con él.
  useEffect(() => {
    const alMensaje = (ev: MessageEvent) => {
      if (!/gtp-seglan\.com|cardnet\.com\.do/i.test(ev.origin)) return
      if (cobrandoRef.current) return
      const d: unknown = ev.data
      let t = ''
      if (typeof d === 'string') {
        // Solo strings con forma de token o de JSON; el widget también manda
        // mensajes internos (resize, etc.) que no hay que confundir.
        const s = d.trim()
        if (s.startsWith('{') || s.startsWith('[')) t = tokenDe(s, 0)
        else if (/^[A-Za-z0-9]{2,10}__?[A-Za-z0-9_-]{16,}$/.test(s)) t = s
      } else {
        t = tokenDe(d)
      }
      if (t) {
        tokenDataRef.current = typeof d === 'string' ? { Token: t } : d
        rastro('[pago] token recibido por mensaje de la ventana')
        void cobrar(t)
      }
    }
    window.addEventListener('message', alMensaje)
    return () => window.removeEventListener('message', alMensaje)
  }, [cobrar])

  // PLAN E: si a pesar de todo el formulario llegó a navegar (recarga con
  // ?PWToken=... en la URL), se rescata el token al montar y se cobra.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const t = params.get('PWToken')?.trim()
    if (t && !cobrandoRef.current) {
      params.delete('PWToken')
      const query = params.toString()
      window.history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''))
      void cobrar(t)
    }
    // Solo al montar: el token en URL es residuo de una navegación previa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * ¿QUEDÓ UNA TARJETA ESPERANDO SU CÓDIGO? Se pregunta UNA VEZ, al montar.
   *
   * Es la mitad que faltaba del flujo de activación. El código del banco no es
   * un SMS que llega en segundos: es la descripción de un cargo, y aparece
   * cuando el cargo se asienta. El cliente que sale de aquí porque todavía no
   * lo ve necesita poder volver — y hasta ahora, al volver, no había nada que
   * le dijera que su tarjeta seguía pendiente.
   *
   * Es un GET puro: no crea Customer, no invalida la ventana de captura y no
   * gasta ninguno de los 3 intentos. Si falla o se limita, responde
   * `pendiente: false` y esta pantalla se comporta como siempre: la consulta
   * es un atajo, nunca un requisito.
   *
   * El `ref` es la lección del 429 que nos costó una tarde: la precarga de
   * sesión se re-disparaba con `estado === 'error'` y renovaba el límite para
   * siempre. Esta sonda corre exactamente una vez por montaje y no mira el
   * estado.
   */
  const sondaPendienteRef = useRef(false)
  useEffect(() => {
    if (sondaPendienteRef.current) return
    sondaPendienteRef.current = true
    let vivo = true
    void (async () => {
      try {
        const resp = await fetch('/api/pagos/cardnet-token/pendiente', {
          signal: AbortSignal.timeout(30_000),
        })
        const data = (await resp.json().catch(() => ({}))) as {
          pendiente?: boolean
          marca?: string | null
          ultimos4?: string | null
        }
        if (!vivo || data.pendiente !== true) return
        setTarjetaPendiente({ marca: data.marca ?? null, ultimos4: data.ultimos4 ?? null })
      } catch {
        // Silencio a propósito: no hay nada que el cliente pueda hacer con
        // «no pude comprobar si tenías una tarjeta pendiente», y alarmarlo en
        // la pantalla de pago por una consulta opcional es peor que callar.
      }
    })()
    return () => {
      vivo = false
    }
    // Solo al montar. Ver el comentario de arriba sobre el 429. (No lleva
    // `eslint-disable`: este efecto no cierra sobre nada reactivo, así que la
    // lista vacía es correcta y el linter no se queja.)
  }, [])

  // CIERRE DE LA VENTANA: aquí (y solo aquí) se confirma contra el proveedor.
  // La ventana se cierra sola tras "Agregar", así que el cierre es la señal de
  // que probablemente hay una tarjeta nueva. El registro del proveedor puede
  // tardar unos segundos, así que se consulta varias veces antes de rendirse.
  // Si no aparece nada, se libera la pantalla: sin tarjeta nueva NO hubo cobro.
  useEffect(() => {
    if (estado !== 'capturando') return
    let ventanaVista = false
    let cancelado = false
    const chequeo = setInterval(() => {
      const f = document.querySelector<HTMLIFrameElement>(
        'iframe[src*="gtp-seglan"], iframe[src*="cardnet"]'
      )
      const visible = Boolean(f) && (f as HTMLIFrameElement).getBoundingClientRect().width > 10
      if (visible) {
        ventanaVista = true
        return
      }
      if (!ventanaVista) return // todavía no terminó de abrir
      clearInterval(chequeo)
      void (async () => {
        for (let intento = 0; intento < 5; intento++) {
          await new Promise((r) => setTimeout(r, 2500))
          if (cancelado || cobrandoRef.current) return
          if (await confirmarEnServidor()) return
        }
        if (!cancelado && !cobrandoRef.current) {
          setEstado((e) => (e === 'capturando' ? 'listo' : e))
          setMensaje(null)
          toast('Se cerró la ventana de pago sin completar el cobro. Puedes intentarlo de nuevo.')
        }
      })()
    }, 700)
    return () => {
      cancelado = true
      clearInterval(chequeo)
    }
  }, [estado, confirmarEnServidor])

  // La ventana del proveedor a veces se dibuja más alta que la pantalla y el
  // botón de pagar queda fuera de alcance (sin scroll). Mientras está abierta,
  // se le impone un tamaño que quepa en el viewport y se habilita su scroll
  // interno. Es cosmético: no toca el contenido (que es del proveedor).
  useEffect(() => {
    if (estado !== 'capturando') return
    const ajustar = () => {
      const frames = document.querySelectorAll<HTMLIFrameElement>(
        'iframe[src*="gtp-seglan"], iframe[src*="cardnet"]'
      )
      frames.forEach((f) => {
        f.setAttribute('scrolling', 'yes')
        // Un solo modo para TODOS los tamaños: tarjeta modal centrada y
        // acotada al viewport. (Antes había un modo "pantalla completa" para
        // anchos casi totales; al alternar entre modos, el translate de
        // centrado quedaba pegado y en móvil corría la ventana media pantalla
        // a la izquierda/arriba.)
        Object.assign(f.style, {
          position: 'fixed',
          top: '50%',
          left: '50%',
          right: 'auto',
          bottom: 'auto',
          margin: '0',
          transform: 'translate(-50%, -50%)',
          width: 'min(96vw, 430px)',
          maxWidth: '96vw',
          height: 'min(92dvh, 780px)',
          maxHeight: '92dvh',
          border: '0',
          borderRadius: '16px',
          background: '#fff',
          boxShadow: '0 24px 64px rgba(0,0,0,.35)',
          zIndex: '2147483000',
        })
      })
    }
    ajustar()
    const intervalo = setInterval(ajustar, 300)
    window.addEventListener('resize', ajustar)
    return () => {
      clearInterval(intervalo)
      window.removeEventListener('resize', ajustar)
    }
  }, [estado])

  // Abre la ventana de pago: usa la sesión pre-creada si sigue fresca; si no,
  // pide una nueva en el momento.
  const abrirCaptura = useCallback(async () => {
    const sdk = window.PWCheckout
    if (!sdk) {
      setEstado('error')
      // No se manda a recargar a ciegas: recargar no arregla un ambiente mal
      // puesto, y el cliente lo intentaría tres veces antes de rendirse.
      setMensaje(
        'No se pudo cargar el pago seguro. Si acabas de entrar, recarga la página; si sigue igual, avísanos.'
      )
      return
    }
    setEstado('capturando')
    setMensaje(null)
    setTipoError('otro')

    let sesion = sesionRef.current
    sesionRef.current = null // una sesión se usa una sola vez
    if (!sesion || Date.now() - sesion.creadaEn > SESION_TTL_MS) {
      sesion = await pedirSesion()
    }
    if (!sesion) {
      setEstado('error')
      // El motivo real si el servidor lo dio. Un «Demasiados intentos» no se
      // arregla reintentando, y disfrazarlo de fallo de la pasarela manda a
      // buscar el problema donde no está.
      setMensaje(
        motivoSesionRef.current ?? 'No se pudo iniciar la ventana de pago. Intenta de nuevo.'
      )
      return
    }
    conteoAntesRef.current = sesion.conteoPerfiles
    customerIdRef.current = sesion.customerId

    // Los textos van SANEADOS: el widget los arrastra a la URL de la ventana
    // de captura sin escaparlos, y un `&` —como el de «CARTOWN Wash &
    // Detailing»— parte la consulta y CardNET responde 500.
    const marca = textoSeguroWidget(companyName, 'Pago seguro')
    const imagen = imagenSeguraWidget(logoUrl)
    sdk.SetProperties({
      name: marca,
      email: '',
      ...(imagen ? { image: imagen } : {}),
      button_label: textoSeguroWidget(`Pagar ${montoTexto}`, 'Pagar'),
      description: textoSeguroWidget(`Membresia ${marca}`, 'Membresia'),
      currency: 'DOP',
      lang: 'ESP',
      // OBLIGATORIO según el manual (§3.2): el widget inserta el token en el
      // input oculto PWToken de este formulario. Sin form_id, el token nunca
      // llega a la página y el flujo se queda esperando para siempre.
      form_id: FORM_ID,
      checkout_card: 1,
      autoSubmit: 'false',
      empty: 'false',
    })
    // Reaplicar el blindaje del Close por si el widget creó su objeto Iframe
    // después de cargar el script.
    blindarCierre(sdk)
    const url = `${sesion.captureUrl}?key=${encodeURIComponent(sesion.publicKey)}&session_id=${encodeURIComponent(sesion.uniqueId)}`
    const abrir = sdk.OpenIframeCustom ?? sdk.OpenIframe
    if (abrir) abrir(url, sesion.uniqueId)
    else {
      setEstado('error')
      setMensaje('No se pudo abrir la ventana de pago. Recarga la página e intenta de nuevo.')
    }
  }, [pedirSesion, companyName, logoUrl, montoTexto])

  /**
   * ACTIVA LA TARJETA con el código del banco y cobra en el mismo movimiento.
   * El servidor normaliza el código (admite «Cardnet:z2r78v» pegado entero),
   * activa el perfil contra CardNET y, si queda habilitado, cobra por la
   * tubería idempotente de siempre.
   */
  /**
   * El código EXACTO que el servidor va a recibir, derivado en cada render.
   * Se deriva a propósito en vez de guardarse en estado: un segundo estado que
   * hay que mantener sincronizado con el primero es una forma conocida de que
   * la vista previa enseñe una cosa y se envíe otra.
   */
  const codigoNormalizado = normalizarCodigoActivacion(codigoActivacion)

  const activarYCobrar = useCallback(async () => {
    // Mismo criterio que el botón y que el servidor: si al normalizar no
    // quedan 6 caracteres, no se llama a CardNET. Un intento vale demasiado
    // (3 y el banco borra la tarjeta) como para gastarlo en un formato malo.
    if (activando || !codigoNormalizado) return
    setSegundosEsperando(0)
    setActivando(true)
    setMensaje(null)
    setTipoError('otro')
    try {
      const resp = await fetch('/api/pagos/cardnet-token/activar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // TIEMPO LÍMITE del lado del navegador. Sin esto, si el servidor se
        // cae a media secuencia —o la plataforma corta la función por tiempo—
        // la promesa nunca se resuelve y el botón queda girando para siempre.
        // Un spinner eterno es peor que un error: el cliente no sabe si se le
        // cobró, y lo único que puede hacer es recargar y arriesgarse a
        // gastar otro de sus 3 intentos.
        signal: AbortSignal.timeout(70_000),
        body: JSON.stringify({
          membershipId,
          // Se manda el YA normalizado para que «Se enviará: XXXXXX» sea
          // literalmente cierto. El servidor lo normaliza igual (no se confía
          // en el navegador); normalizar lo normalizado no lo cambia.
          codigo: codigoNormalizado,
          customerId: customerIdRef.current,
          guardar: guardarRef.current,
        }),
      })
      const data = (await resp.json().catch(() => ({}))) as RespuestaPago
      rastro('[pago] resultado de la activación:', data.estado ?? resp.status)
      if (data.estado === 'aprobado') {
        // Ya no hay nada pendiente: el aviso de «tarjeta esperando su código»
        // desaparece con ella.
        setTarjetaPendiente(null)
        anotarComprobante(data)
        setEstado('aprobado')
        toast.success('¡Tarjeta activada y pago aprobado! Tu membresía está activa.')
        if (urlExito) router.push(urlExito)
        return
      }
      if (data.estado === 'codigo_rechazado') {
        // Se queda en la pantalla: el cliente corrige y reintenta. El motivo
        // ya le advierte que al tercer fallo el banco elimina la tarjeta.
        //
        // Y SE LIMPIA EL CAMPO. Dejar ahí el código rechazado obliga a
        // borrarlo a mano antes de escribir el bueno, y con el botón activo
        // —porque los 6 caracteres siguen siendo válidos de formato— un
        // segundo clic vuelve a enviar EXACTAMENTE el mismo código y quema
        // otro de los 3 intentos sin cambiar nada.
        setCodigoActivacion('')
        setMensaje(data.motivo ?? 'El código no fue aceptado. Revísalo e intenta de nuevo.')
        // El foco vuelve al campo para que se pueda teclear de inmediato.
        requestAnimationFrame(() => {
          document.getElementById('codigo-activacion')?.focus()
        })
        return
      }
      if (data.estado === 'activada_sin_cobro') {
        // La tarjeta quedó activa pero el cobro no cerró: volver al botón de
        // pagar — ahora el cobro normal encontrará el perfil habilitado. Ya no
        // está pendiente de activar, así que el aviso sobra.
        setTarjetaPendiente(null)
        setTipoError('otro')
        setEstado('error')
        setMensaje(data.motivo ?? 'Tu tarjeta quedó activa. Toca pagar para completar el cobro.')
        return
      }
      // sin_perfil / error: se explica y se vuelve al inicio del flujo. En
      // `sin_perfil` la tarjeta ya no existe —el banco la borró al tercer
      // fallo, o se activó por otra vía—, así que seguir ofreciendo «ya tengo
      // mi código» mandaría al cliente a una pantalla sin tarjeta que activar.
      if (data.estado === 'sin_perfil') setTarjetaPendiente(null)
      setTipoError('otro')
      setEstado('error')
      setMensaje(data.motivo ?? 'No se pudo activar la tarjeta. Intenta de nuevo.')
    } catch (e) {
      // Se distingue «se acabó el tiempo» de «no hay red»: son situaciones
      // distintas y lo que el cliente debe hacer también. Ante un corte por
      // tiempo NO se le invita a reintentar a ciegas — la activación pudo
      // haber ocurrido del otro lado, y reintentar gastaría un intento de los
      // 3 por algo que quizá ya funcionó.
      const porTiempo = e instanceof DOMException && e.name === 'TimeoutError'
      setMensaje(
        porTiempo
          ? 'La pasarela está tardando más de lo normal. NO vuelvas a enviar el código todavía: recarga la página para ver si la activación se completó.'
          : 'No se pudo contactar el servidor. Revisa tu conexión e intenta de nuevo.'
      )
    } finally {
      setActivando(false)
    }
  }, [activando, codigoNormalizado, membershipId, router, urlExito, anotarComprobante])

  /* PAGO COMPLETADO.

     EL REFRESCO YA NO ES AUTOMÁTICO, y es el cambio importante de esta
     pantalla. Antes se llamaba a `router.refresh()` en el mismo instante en
     que el cobro aprobaba; como la página deja de pedir pago en cuanto la
     membresía queda activa, esta pantalla se desmontaba sola antes de que
     nadie alcanzara a leerla. El cliente veía un destello verde y ya. Un
     comprobante que dura menos que un parpadeo no es un comprobante.

     Ahora el pago aprobado se ENSEÑA, y el refresco lo dispara el cliente con
     «Ver mi membresía». Cuando quien monta el componente pide una navegación
     explícita (`urlExito`) esa sigue mandando: allí el destino es otra
     página, no esta.

     LA TABLA SOLO TIENE FILAS CIERTAS. No hay «método», ni «últimos 4», ni
     «código de autorización», ni «próximo cobro»: el servidor no devuelve
     ninguna de esas cosas. Rellenar una tabla de comprobante con datos
     plausibles es la peor forma de ganarse la confianza de alguien que acaba
     de entregar su tarjeta. */
  if (estado === 'aprobado') {
    const cuando = comprobante
      ? new Intl.DateTimeFormat('es-DO', {
          dateStyle: 'long',
          timeStyle: 'short',
        }).format(comprobante.cuando)
      : null
    return (
      <div className="overflow-hidden rounded-2xl border border-success/25 bg-card shadow-sm">
        <div className="flex flex-col items-center border-b border-border/60 bg-success/5 px-6 pb-6 pt-8 text-center">
          {/* El anillo doble da la sensación de sello. `animate-scale-in` ya
              está desactivada globalmente bajo `prefers-reduced-motion`, así
              que no hace falta condicionarla aquí. */}
          <span className="animate-scale-in flex h-20 w-20 items-center justify-center rounded-full bg-success/10">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success/20">
              <CheckCircle2 className="h-8 w-8 text-success" aria-hidden />
            </span>
          </span>
          <h3 className="mt-4 text-lg font-bold uppercase tracking-wide text-success">
            Pago completado
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Tu membresía quedó activa al instante.
          </p>
        </div>

        <dl className="divide-y divide-border/60 px-6 text-sm">
          {companyName ? (
            <div className="flex items-baseline justify-between gap-4 py-3">
              <dt className="text-muted-foreground">Empresa</dt>
              <dd className="text-right font-medium text-foreground">{companyName}</dd>
            </div>
          ) : null}
          <div className="flex items-baseline justify-between gap-4 py-3">
            <dt className="text-muted-foreground">Monto pagado</dt>
            <dd className="text-right text-base font-bold text-foreground">{montoTexto}</dd>
          </div>
          {cuando ? (
            <div className="flex items-baseline justify-between gap-4 py-3">
              <dt className="text-muted-foreground">Fecha y hora</dt>
              <dd className="text-right font-medium text-foreground">{cuando}</dd>
            </div>
          ) : null}
          {comprobante?.referencia ? (
            <div className="flex items-baseline justify-between gap-4 py-3">
              <dt className="shrink-0 text-muted-foreground">Referencia</dt>
              {/* Se enseña entera y seleccionable a propósito: es el dato que
                  el equipo pide cuando alguien escribe por un pago. Recortarla
                  para que quepa la volvería inútil justo cuando hace falta. */}
              <dd className="min-w-0 break-all text-right font-mono text-xs text-muted-foreground">
                {comprobante.referencia}
              </dd>
            </div>
          ) : null}
        </dl>

        <div className="space-y-3 px-6 pb-6 pt-5">
          <Button
            type="button"
            variant="premium"
            onClick={() => router.refresh()}
            className="w-full rounded-full py-6 text-base font-semibold"
          >
            Ver mi membresía
          </Button>
          <p className="text-center text-xs leading-relaxed text-muted-foreground">
            Te enviamos el comprobante de este pago a tu correo.
          </p>
        </div>
      </div>
    )
  }

  const ocupado = estado === 'cargando' || estado === 'capturando' || estado === 'cobrando'

  return (
    <div className="space-y-4">
      {/* El widget del proveedor inserta aquí el token (manual §3.2). */}
      <form id={FORM_ID} className="hidden" aria-hidden>
        <input type="hidden" name="PWToken" id="PWToken" />
      </form>

      {/* PAGO NO COMPLETADO.

          Era una línea de texto en rojo. Ahora tiene el peso que le toca:
          quien acaba de ver fallar un pago necesita tres cosas, y ninguna es
          decoración — qué pasó, si le cobraron, y qué hacer ahora.

          «No se aplicó ningún cargo» SOLO aparece cuando el servidor dijo
          `rechazado`. Este mismo estado se alcanza también por un corte de
          tiempo o por una tarjeta que quedó activa sin cobrar, y en esos
          casos nadie de este lado sabe qué pasó con el dinero. Afirmarlo
          igualmente sería la única clase de error que una pantalla de pago no
          puede permitirse.

          El botón de reintentar NO está aquí: es el mismo de abajo, que ya
          dice «Reintentar pago» en este estado. Duplicarlo daría dos botones
          que hacen lo mismo a un metro de distancia. */}
      {estado === 'error' && mensaje && (
        <div className="animate-fade-in overflow-hidden rounded-2xl border border-destructive/25 bg-card shadow-sm">
          <div className="flex flex-col items-center border-b border-border/60 bg-destructive/5 px-6 pb-5 pt-7 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
              <AlertCircle className="h-7 w-7 text-destructive" aria-hidden />
            </span>
            <h3 className="mt-3 text-base font-bold uppercase tracking-wide text-destructive">
              {tipoError === 'rechazo' ? 'Pago rechazado' : 'El pago no se completó'}
            </h3>
          </div>
          <div className="space-y-3 px-6 py-5">
            <p className="text-center text-sm leading-relaxed text-foreground">{mensaje}</p>
            {tipoError === 'rechazo' ? (
              <p className="rounded-xl border border-border/60 bg-muted/30 p-3 text-center text-xs leading-relaxed text-muted-foreground">
                <strong className="font-semibold text-foreground">
                  No se aplicó ningún cargo por tu membresía.
                </strong>{' '}
                Puedes intentar con la misma tarjeta o registrar otra.
              </p>
            ) : null}
          </div>
        </div>
      )}

      {/* LA PUERTA DE VUELTA.

          Sin esto, el cliente que salió a buscar el código en su banco —y que
          al volver se encuentra la pantalla de pago tal cual— no tiene forma
          de saber que su tarjeta sigue registrada esperando. Volvía a empezar:
          ventana de captura nueva, tarjeta nueva, otro cargo de RD$1.00, y el
          perfil anterior huérfano.

          Solo aparece cuando NO se está tecleando el código ya, y nunca
          durante una operación en curso: interrumpir un cobro con un atajo a
          otra pantalla es cómo se cobra dos veces. */}
      {tarjetaPendiente && estado !== 'activacion' && !ocupado && (
        <div className="flex flex-col gap-3 rounded-2xl border border-warning/30 bg-warning/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-warning/15">
              <ShieldCheck className="h-4 w-4 text-warning" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                Tienes una tarjeta esperando su código
                {tarjetaPendiente.ultimos4 ? (
                  <span className="font-normal text-muted-foreground">
                    {' '}· {tarjetaPendiente.marca ?? 'Tarjeta'} ····{tarjetaPendiente.ultimos4}
                  </span>
                ) : null}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                Ya está registrada. Cuando veas el cargo de RD$1.00 en tu banco,
                entra el código y se completa el pago — no hace falta volver a
                escribir la tarjeta.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setMensaje(null)
              setEstado('activacion')
            }}
            className="shrink-0 rounded-xl"
          >
            Ya tengo mi código
          </Button>
        </div>
      )}

      {/* ACTIVACIÓN (llaves CON autenticación · §4.1.2.3): el banco cobró
          RD$1.00 y mostró un código de 6 caracteres; se ingresa aquí y el
          servidor activa la tarjeta y cobra en el mismo movimiento.

          La pieza que más trabaja de esta pantalla no es el campo: es el
          EJEMPLO del cargo y la vista previa de lo que se va a enviar. El
          cliente tiene 3 intentos y al tercero el banco borra la tarjeta, así
          que cada intento gastado por una confusión de formato —copiar el
          prefijo, un espacio de más— es caro. Enseñarle exactamente qué
          buscar y exactamente qué se va a mandar convierte una apuesta en una
          comprobación. */}
      {/* VERIFICACIÓN DE LA TARJETA.

          Esta pantalla es la CONTINUACIÓN de la ventana donde el cliente acaba
          de escribir su tarjeta, así que habla su mismo idioma visual: el logo
          de la empresa arriba, el título en mayúsculas, el campo tipo píldora y
          un botón de ancho completo. Si pareciera otra cosa, el cliente —que
          está a mitad de una compra y acaba de ver un cargo en su banco— tiene
          motivos para dudar de dónde está.

          NO SE NOMBRA AL PROCESADOR. Para el cliente, todo lo hace MembeGo.
          Quién custodia los datos de su tarjeta está escrito en la política de
          privacidad, enlazada abajo: es información que merece encontrar
          cuando la busque, no un nombre de tercero cruzándose en mitad de un
          pago.

          La única excepción es el ejemplo del cargo, y no es una excepción de
          verdad: ese texto es lo que su BANCO le muestra, literal. Quitarlo
          para no nombrar a nadie dejaría al cliente buscando a ciegas un
          código que no sabría reconocer. */}
      {estado === 'activacion' && (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex flex-col items-center px-6 pb-2 pt-7 text-center">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={companyName ?? 'Logo'}
                className="h-20 w-20 rounded-full object-cover"
              />
            ) : (
              <span className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
                <ShieldCheck className="h-9 w-9 text-primary" aria-hidden />
              </span>
            )}
            <h3 className="mt-4 text-lg font-bold uppercase tracking-wide text-primary">
              Verifica tu tarjeta
            </h3>
            <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
              Último paso para completar tu pago
            </p>
          </div>

          <div className="space-y-5 px-6 pb-6 pt-4">
            <p className="text-center text-sm leading-relaxed text-muted-foreground">
              Tu banco hizo un cargo de{' '}
              <strong className="font-semibold text-foreground">RD$1.00</strong> para
              confirmar que la tarjeta es tuya. En la descripción de ese cargo
              viene un código de{' '}
              <strong className="font-semibold text-foreground">6 caracteres</strong>.
            </p>

            {/* Cómo se ve el cargo en el estado de cuenta. Es un EJEMPLO,
                rotulado como tal: quien nunca lo ha visto no sabe qué está
                buscando, y «búscalo en tu banco» no se lo dice. */}
            <div className="rounded-2xl border border-border bg-muted/40 p-3">
              <p className="text-center text-xs uppercase tracking-wide text-muted-foreground">
                Así aparece en tu app del banco
              </p>
              <div className="mt-2 flex items-center justify-between gap-3 rounded-full bg-background px-4 py-2.5">
                <span className="truncate font-mono text-sm text-foreground">
                  CARDNET:<span className="rounded bg-warning/20 px-1 py-0.5 font-semibold text-foreground">Z2R78V</span>
                </span>
                <span className="shrink-0 font-mono text-sm text-muted-foreground">RD$1.00</span>
              </div>
            </div>

            <div>
              <label
                htmlFor="codigo-activacion"
                className="mb-2 block text-xs font-bold uppercase tracking-wide text-foreground"
              >
                Código de verificación <span className="text-destructive">*</span>
              </label>
              <input
                id="codigo-activacion"
                type="text"
                inputMode="text"
                autoComplete="one-time-code"
                autoCapitalize="characters"
                autoFocus
                spellCheck={false}
                maxLength={24}
                value={codigoActivacion}
                onChange={(e) => setCodigoActivacion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void activarYCobrar()
                  }
                }}
                placeholder="Z2R78V"
                disabled={activando}
                className="w-full rounded-full border border-border bg-background px-5 py-3.5 text-center font-mono text-xl font-semibold uppercase tracking-[0.35em] text-foreground transition-colors placeholder:text-base placeholder:font-normal placeholder:tracking-[0.2em] placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none disabled:opacity-60"
              />
              {/* VISTA PREVIA de lo que realmente se va a enviar.
                  `normalizarCodigoActivacion` es la MISMA función pura que usa
                  el servidor, así que esto no es una aproximación: es el valor
                  exacto. Puedes pegar la línea entera del banco y ver qué sale
                  antes de gastar uno de los 3 intentos. */}
              <p className="mt-2 min-h-[1.25rem] text-center text-xs" aria-live="polite">
                {codigoActivacion.trim() === '' ? (
                  <span className="text-muted-foreground">
                    Puedes pegar la línea completa del banco, con prefijo y todo.
                  </span>
                ) : codigoNormalizado ? (
                  <span className="font-medium text-success">
                    Se enviará: <span className="font-mono tracking-widest">{codigoNormalizado}</span>
                  </span>
                ) : (
                  <span className="font-medium text-muted-foreground">
                    Faltan caracteres — el código tiene 6 letras o números.
                  </span>
                )}
              </p>
            </div>

            {/* El motivo del servidor solo se enseña cuando dice algo que esta
                pantalla no dice ya. Repetir «falta activarla» debajo de un
                título que es justamente eso es ruido; un «código rechazado»,
                en cambio, es la información más importante del momento. */}
            {mensaje && !mensaje.startsWith('Tu tarjeta quedó registrada') ? (
              <p className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {mensaje}
              </p>
            ) : null}

            <Button
              type="button"
              variant="premium"
              onClick={() => void activarYCobrar()}
              disabled={activando || !codigoNormalizado}
              className="w-full rounded-full py-6 text-base font-semibold uppercase tracking-wide"
            >
              {activando ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verificando…
                </>
              ) : (
                <>
                  <Lock className="mr-2 h-4 w-4" /> Verificar y pagar {montoTexto}
                </>
              )}
            </Button>

            {/* Mientras espera: primero se dice qué está pasando, y pasados
                unos segundos —cuando la duda aparece— se dice explícitamente
                que no cierre. Es la instrucción que evita el peor final. */}
            {activando ? (
              <p className="text-center text-xs leading-relaxed text-muted-foreground" aria-live="polite">
                {segundosEsperando < 6 ? (
                  'Verificando tu código y procesando el pago…'
                ) : (
                  <>
                    Esto puede tardar unos segundos más.{' '}
                    <strong className="font-semibold text-foreground">
                      No cierres esta ventana
                    </strong>{' '}
                    ni vuelvas atrás: el cobro está en curso.
                  </>
                )}
              </p>
            ) : null}

            <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                Tienes <strong className="font-semibold text-foreground">3 intentos</strong>. Al
                tercero fallido tu banco elimina la tarjeta y hay que registrarla de nuevo. El
                cargo de RD$1.00 es solo de verificación.
              </span>
            </p>

            {/* La respuesta a «¿y quién guarda mi tarjeta?», a un clic, para
                quien se lo pregunte — sin ponérselo delante a quien no. */}
            <p className="text-center text-xs text-muted-foreground">
              <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-foreground">
                Cómo protegemos los datos de tu tarjeta
              </a>
            </p>
          </div>

          {/* DOS SALIDAS, y no son la misma.

              «Lo haré después» es la que faltaba. El código vive en la
              descripción de un cargo, y ese cargo puede tardar en asentarse:
              obligar a resolverlo aquí o perder la tarjeta es pedirle al
              cliente que controle los tiempos de su banco. Sale sin tocar
              nada —la tarjeta sigue registrada y esperando— y al volver el
              aviso de arriba lo trae de vuelta.

              «Usar otra tarjeta» es lo contrario: la anterior no le sirve y
              va a registrar una nueva. */}
          <div className="flex flex-col gap-2 border-t border-border px-6 py-3 sm:flex-row-reverse sm:items-center sm:justify-between">
            <button
              type="button"
              disabled={activando}
              onClick={() => {
                // El cliente dice que esta tarjeta no es la que quiere usar:
                // se retira el atajo para volver a ella. El perfil sigue
                // existiendo en la pasarela —no lo borramos— así que si
                // recarga y sigue pendiente, la sonda lo encontrará otra vez.
                setTarjetaPendiente(null)
                setEstado('listo')
                setMensaje(null)
                setCodigoActivacion('')
              }}
              className="text-xs font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:opacity-50"
            >
              Usar otra tarjeta
            </button>
            <button
              type="button"
              disabled={activando}
              onClick={() => {
                // A diferencia de «usar otra tarjeta», ESTA salida conserva
                // `tarjetaPendiente`: es justo lo que hace que se pueda
                // volver sin registrar la tarjeta de nuevo.
                setEstado('listo')
                setMensaje(null)
                setCodigoActivacion('')
              }}
              className="text-xs font-semibold text-primary underline-offset-4 transition-colors hover:underline disabled:opacity-50"
            >
              Lo haré después — mi banco aún no muestra el cargo
            </button>
          </div>
        </div>
      )}

      {/* EL BLOQUE DE PAGO, EN UNA SOLA PIEZA.

          Antes eran cuatro elementos sueltos apilados —interruptor, botón,
          aviso del RD$1.00 y sellos— separados por aire sobre el fondo de la
          página. Leídos así, ninguno parecía tener que ver con el de al lado:
          el aviso del cargo de verificación se leía como una advertencia
          suelta en vez de como la letra pequeña del botón que está justo
          encima.

          Metidos en una sola tarjeta se leen como lo que son: un formulario
          de pago. No se añade ni un dato nuevo — el resumen del cobro y el
          total ya los enseña la página, y repetirlos aquí sería dar dos
          versiones del mismo número en la misma pantalla. */}
      {estado !== 'activacion' && (
        <div className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
        {/* Fase 2: renovación automática, con interruptor. Solo antes de pagar. */}
        {(estado === 'listo' || estado === 'error') && (
          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-border/60 bg-card p-4 transition-colors hover:border-primary/30">
            <span className="text-sm">
              <span className="font-semibold text-foreground">Renovación automática</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                Guarda tu tarjeta de forma encriptada y renueva sola cada período.
                Puedes quitarla cuando quieras.
              </span>
            </span>
            <span className="relative inline-flex shrink-0">
              <input
                type="checkbox"
                checked={guardar}
                onChange={(e) => setGuardar(e.target.checked)}
                className="peer sr-only"
              />
              <span
                className="block h-6 w-11 rounded-full bg-muted transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40"
                aria-hidden
              />
              <span
                className="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5"
                aria-hidden
              />
            </span>
          </label>
        )}

        <Button
          type="button"
          variant="premium"
          onClick={() => void abrirCaptura()}
          disabled={ocupado}
          className="w-full rounded-2xl py-7 text-base font-semibold"
        >
          {estado === 'cargando' ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Preparando pago seguro…
            </>
          ) : estado === 'cobrando' ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Procesando pago…
            </>
          ) : estado === 'capturando' ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Abriendo ventana segura…
            </>
          ) : estado === 'error' ? (
            <>
              <CreditCard className="mr-2 h-5 w-5" /> Reintentar pago
            </>
          ) : (
            <>
              <Lock className="mr-2 h-4 w-4" /> Pagar {montoTexto}
            </>
          )}
        </Button>

        {/* Salida de emergencia: si el cliente cerró la ventana del proveedor,
            la pantalla no se queda colgada. */}
        {estado === 'capturando' && (
          <button
            type="button"
            onClick={() => {
              setEstado('listo')
              setMensaje(null)
            }}
            className="mx-auto block text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            ¿Cerraste la ventana de pago? Volver a intentar
          </button>
        )}

        {/* EL CARGO DE RD$1.00, DICHO ANTES DE QUE OCURRA.

            Estaba explicado solo dentro de la pantalla de activación, o sea
            DESPUÉS de que el banco ya lo había hecho. Al cliente le aparecía un
            cobro que nadie le había anunciado — y un cargo inesperado en la
            tarjeta es exactamente lo que hace que la gente llame al banco a
            reclamar un fraude.

            Se redacta en condicional a propósito, y no es una evasiva: la
            verificación depende del juego de llaves con el que opera la empresa.
            Con las llaves CON autenticación la tarjeta nace deshabilitada y hay
            cargo; sin ellas no lo hay. Prometer un cargo que puede no ocurrir
            sería tan inexacto como callarlo. */}
        {(estado === 'listo' || estado === 'error') && !tarjetaPendiente && (
          <p className="flex items-start gap-2 rounded-xl border border-border/60 bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              Si tu banco pide verificar la tarjeta, verás un cargo de{' '}
              <strong className="font-semibold text-foreground">RD$1.00</strong> con un
              código de 6 caracteres en su descripción. Sirve solo para confirmar que
              la tarjeta es tuya, y te lo pediremos aquí para completar el pago.
            </span>
          </p>
        )}

        {/* Sellos de confianza: discretos, debajo del CTA.

            Iban con `text-xs` y `emerald-600/400`. Lo primero es texto por
            debajo del mínimo legible que se fijó para una plataforma que se usa
            de pie; lo segundo es un verde crudo que no sigue el tema y que en
            modo oscuro había que parchear a mano. Los dos son deuda medida por
            el auditor de diseño, y esta pantalla se estaba tocando de todos
            modos. */}
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-xs font-medium text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <ShieldCheck className="h-3.5 w-3.5 text-success" aria-hidden />
            Encriptación bancaria
          </span>
          <span className="inline-flex items-center gap-1">
            <Lock className="h-3.5 w-3.5 text-success" aria-hidden />
            Ventana de pago segura
          </span>
          <span className="inline-flex items-center gap-1">
            <CreditCard className="h-3.5 w-3.5 text-success" aria-hidden />
            Nunca guardamos tu número
          </span>
        </div>
        </div>
      )}
    </div>
  )
}

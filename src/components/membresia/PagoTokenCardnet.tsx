'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CreditCard, Loader2, CheckCircle2, ShieldCheck, AlertCircle, Lock } from 'lucide-react'
import { toast } from 'sonner'
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

type Estado = 'cargando' | 'listo' | 'capturando' | 'cobrando' | 'aprobado' | 'error'

const CLAVES_TOKEN = ['Token', 'token', 'TrxToken', 'trxToken', 'PWToken'] as const
// Anidaciones típicas donde los proveedores esconden el payload real.
const CLAVES_ANIDADAS = ['data', 'Data', 'detail', 'payload', 'Response', 'response'] as const

/**
 * Extrae el token del payload de `tokenCreated`, sea string, JSON en string,
 * objeto plano u objeto anidado (hasta 3 niveles). El proveedor no documenta
 * la forma exacta, así que se buscan todas las variantes conocidas.
 */
function tokenDe(data: unknown, nivel = 0): string {
  if (typeof data === 'string') {
    const s = data.trim()
    if ((s.startsWith('{') || s.startsWith('[')) && nivel < 3) {
      try {
        return tokenDe(JSON.parse(s), nivel + 1)
      } catch {
        return ''
      }
    }
    // En el primer nivel (callback directo del SDK) un string ES el token.
    return nivel === 0 ? s : ''
  }
  if (data && typeof data === 'object' && nivel < 4) {
    const o = data as Record<string, unknown>
    for (const k of CLAVES_TOKEN) {
      const v = o[k]
      if (typeof v === 'string' && v.trim().length > 8) return v.trim()
    }
    for (const k of CLAVES_ANIDADAS) {
      if (o[k]) {
        const t = tokenDe(o[k], nivel + 1)
        if (t) return t
      }
    }
  }
  return ''
}

/**
 * Referencias REUTILIZABLES para guardar la tarjeta (Fase 2). Salen del mismo
 * payload de `tokenCreated`. VERIFICAR-QA: los nombres exactos se confirman con
 * CardNET; se cubren las grafías probables. Nunca incluye datos de tarjeta.
 */
function refsGuardado(data: unknown): {
  customerId: string | null
  paymentProfileId: string | null
  token: string | null
  marca: string | null
  ultimos4: string | null
} {
  const o = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  // El payload puede venir plano o envuelto (Response/data/…): se busca en ambos.
  const capas = [o, ...CLAVES_ANIDADAS.map((k) => o[k])].filter(
    (c): c is Record<string, unknown> => Boolean(c) && typeof c === 'object'
  )
  const g = (...ks: string[]) => {
    for (const capa of capas) {
      for (const k of ks) {
        const v = capa[k]
        if (typeof v === 'string' && v) return v
        if (typeof v === 'number') return String(v)
      }
    }
    return null
  }
  return {
    customerId: g('CustomerId', 'customerId'),
    paymentProfileId: g('PaymentProfileId', 'paymentProfileId', 'ProfileId'),
    token: g('Token', 'token', 'TrxToken', 'PWToken'),
    marca: g('Brand', 'CardBrand', 'marca'),
    ultimos4: g('Last4', 'LastFour', 'ultimos4'),
  }
}

export function PagoTokenCardnet({
  membershipId,
  montoTexto,
  publicKey,
  scriptUrl,
  companyName,
  logoUrl,
  urlExito,
}: Props) {
  const router = useRouter()
  const [estado, setEstado] = useState<Estado>('cargando')
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [guardar, setGuardar] = useState(false)
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
      try {
        const resp = await fetch('/api/pagos/cardnet-token/cobrar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ membershipId, trxToken }),
        })
        const data = (await resp.json().catch(() => ({}))) as { estado?: string; motivo?: string }
        if (data.estado === 'aprobado') {
          if (guardarRef.current) await guardarTarjeta()
          setEstado('aprobado')
          toast.success('¡Pago aprobado! Tu membresía está activa.')
          if (urlExito) router.push(urlExito)
          else router.refresh()
        } else {
          setEstado('error')
          setMensaje(data.motivo ?? 'La tarjeta fue rechazada.')
        }
      } catch {
        setEstado('error')
        setMensaje('No se pudo confirmar el pago. Revisa tu conexión e intenta de nuevo.')
      } finally {
        cobrandoRef.current = false
      }
    },
    [membershipId, router, urlExito, guardarTarjeta]
  )

  // Carga el script de CardNET una sola vez y engancha el callback del token.
  useEffect(() => {
    let cancelado = false

    function enganchar() {
      const sdk = window.PWCheckout
      if (!sdk) return false
      const manejarToken = (data: unknown) => {
        tokenDataRef.current = data
        const t = tokenDe(data)
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
        setMensaje('No se pudo cargar la pasarela de pago.')
      }
    }
    script.addEventListener('load', onLoad)
    const onError = () => {
      if (!cancelado) {
        setEstado('error')
        setMensaje('No se pudo cargar la pasarela de pago. Revisa tu conexión.')
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
  const pedirSesion = useCallback(async (): Promise<SesionCaptura | null> => {
    try {
      const resp = await fetch('/api/pagos/cardnet-token/sesion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = (await resp.json().catch(() => ({}))) as {
        ok?: boolean
        captureUrl?: string
        uniqueId?: string
        publicKey?: string
        conteoPerfiles?: number
        customerId?: string | null
      }
      if (!data.ok || !data.captureUrl || !data.uniqueId) return null
      return {
        captureUrl: data.captureUrl,
        uniqueId: data.uniqueId,
        publicKey: data.publicKey || publicKey,
        creadaEn: Date.now(),
        conteoPerfiles: typeof data.conteoPerfiles === 'number' ? data.conteoPerfiles : 0,
        customerId: typeof data.customerId === 'string' ? data.customerId : null,
      }
    } catch {
      return null
    }
  }, [publicKey])

  // PRE-CREA la sesión en segundo plano apenas la pasarela está lista: así el
  // clic en "Pagar" abre la ventana al instante en vez de esperar al proveedor.
  useEffect(() => {
    if ((estado !== 'listo' && estado !== 'error') || sesionRef.current) return
    let cancelado = false
    void pedirSesion().then((s) => {
      if (!cancelado && s) sesionRef.current = s
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
      const data = (await resp.json().catch(() => ({}))) as { estado?: string; motivo?: string }
      if (data.estado === 'aprobado') {
        setEstado('aprobado')
        toast.success('¡Pago aprobado! Tu membresía está activa.')
        if (urlExito) router.push(urlExito)
        else router.refresh()
        return true
      }
      if (data.estado === 'rechazado') {
        setEstado('error')
        setMensaje(data.motivo ?? 'La tarjeta fue rechazada.')
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
  }, [membershipId, router, urlExito])

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
        // Si el iframe ocupa casi todo el ancho es un overlay de pantalla
        // completa; si no, es la tarjeta modal y se centra acotada.
        const esCompleto = f.getBoundingClientRect().width >= window.innerWidth * 0.9
        if (esCompleto) {
          Object.assign(f.style, {
            position: 'fixed',
            inset: '0',
            width: '100vw',
            height: '100dvh',
            maxHeight: '100dvh',
            border: '0',
            zIndex: '2147483000',
          })
        } else {
          Object.assign(f.style, {
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 'min(96vw, 430px)',
            height: 'min(92dvh, 780px)',
            maxHeight: '92dvh',
            border: '0',
            borderRadius: '16px',
            background: '#fff',
            boxShadow: '0 24px 64px rgba(0,0,0,.35)',
            zIndex: '2147483000',
          })
        }
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
      setMensaje('La pasarela no está lista. Recarga la página.')
      return
    }
    setEstado('capturando')
    setMensaje(null)

    let sesion = sesionRef.current
    sesionRef.current = null // una sesión se usa una sola vez
    if (!sesion || Date.now() - sesion.creadaEn > SESION_TTL_MS) {
      sesion = await pedirSesion()
    }
    if (!sesion) {
      setEstado('error')
      setMensaje('No se pudo iniciar la ventana de pago. Intenta de nuevo.')
      return
    }
    conteoAntesRef.current = sesion.conteoPerfiles
    customerIdRef.current = sesion.customerId

    sdk.SetProperties({
      name: companyName ?? 'Pago seguro',
      email: '',
      ...(logoUrl ? { image: logoUrl } : {}),
      button_label: `Pagar ${montoTexto}`,
      description: companyName ? `Membresía ${companyName}` : 'Membresía',
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
    const url = `${sesion.captureUrl}?key=${encodeURIComponent(sesion.publicKey)}&session_id=${encodeURIComponent(sesion.uniqueId)}`
    const abrir = sdk.OpenIframeCustom ?? sdk.OpenIframe
    if (abrir) abrir(url, sesion.uniqueId)
    else {
      setEstado('error')
      setMensaje('La pasarela no expone el método de apertura esperado.')
    }
  }, [pedirSesion, companyName, logoUrl, montoTexto])

  if (estado === 'aprobado') {
    return (
      <div className="rounded-2xl border border-success/25 bg-success/10 p-6 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success/15">
          <CheckCircle2 className="h-8 w-8 text-success" aria-hidden />
        </span>
        <p className="mt-3 text-lg font-bold text-success">¡Pago aprobado!</p>
        <p className="mt-1 text-sm text-foreground">Tu membresía quedó activa.</p>
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

      {estado === 'error' && mensaje && (
        <p className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {mensaje}
        </p>
      )}

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

      {/* Sellos de confianza: discretos, debajo del CTA. */}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[11px] font-medium text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
          Encriptación bancaria
        </span>
        <span className="inline-flex items-center gap-1">
          <Lock className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
          Ventana de pago segura
        </span>
        <span className="inline-flex items-center gap-1">
          <CreditCard className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
          Nunca guardamos tu número
        </span>
      </div>
    </div>
  )
}

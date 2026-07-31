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
}

// Una sesión pre-creada se considera fresca por 4 minutos; después se pide otra.
const SESION_TTL_MS = 4 * 60 * 1000

// Formulario oculto donde el widget del proveedor inserta el token (manual
// §3.2: `form_id` es obligatorio; el input debe llamarse PWToken).
const FORM_ID = 'membego_pago_form'

type Estado = 'cargando' | 'listo' | 'capturando' | 'cobrando' | 'aprobado' | 'error'

/** Extrae el token del payload de `tokenCreated`, sea string u objeto. */
function tokenDe(data: unknown): string {
  if (typeof data === 'string') return data
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>
    for (const k of ['Token', 'token', 'TrxToken', 'trxToken', 'PWToken']) {
      if (typeof o[k] === 'string') return o[k] as string
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
  const g = (...ks: string[]) => {
    for (const k of ks) if (typeof o[k] === 'string' && o[k]) return o[k] as string
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
      sdk.Bind('tokenCreated', (data: unknown) => {
        tokenDataRef.current = data
        const t = tokenDe(data)
        if (t) void cobrar(t)
        else {
          setEstado('error')
          setMensaje('No se recibió la tarjeta. Intenta de nuevo.')
        }
      })
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
      }
      if (!data.ok || !data.captureUrl || !data.uniqueId) return null
      return {
        captureUrl: data.captureUrl,
        uniqueId: data.uniqueId,
        publicKey: data.publicKey || publicKey,
        creadaEn: Date.now(),
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

  // PLAN B mientras la ventana está abierta: si el callback del widget no
  // dispara (o cambia de nombre), el token igual aparece en el input oculto
  // PWToken — se vigila y se cobra con él. `cobrandoRef` evita el doble cobro
  // si ambos caminos llegan.
  useEffect(() => {
    if (estado !== 'capturando') return
    const intervalo = setInterval(() => {
      const input = document.querySelector<HTMLInputElement>(`#${FORM_ID} input[name="PWToken"]`)
      const t = input?.value?.trim()
      if (input && t && !cobrandoRef.current) {
        input.value = ''
        void cobrar(t)
      }
    }, 500)
    return () => clearInterval(intervalo)
  }, [estado, cobrar])

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

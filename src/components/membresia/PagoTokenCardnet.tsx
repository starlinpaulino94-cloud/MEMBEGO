'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CreditCard, Loader2, CheckCircle2, ShieldCheck, AlertCircle } from 'lucide-react'
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
  /** Config PÚBLICA de CardNET (no incluye la llave privada). */
  publicKey: string
  captureUrl: string
  scriptUrl: string
  /** A dónde ir cuando el pago aprueba. */
  urlExito?: string
}

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
  urlExito,
}: Props) {
  const router = useRouter()
  const [estado, setEstado] = useState<Estado>('cargando')
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [guardar, setGuardar] = useState(false)
  const cobrandoRef = useRef(false)
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

  // Abre el iframe de captura de CardNET. Primero pide al servidor una SESIÓN
  // válida (CaptureURL + UniqueID reales); no se puede abrir con un id inventado.
  const abrirCaptura = useCallback(async () => {
    const sdk = window.PWCheckout
    if (!sdk) {
      setEstado('error')
      setMensaje('La pasarela no está lista. Recarga la página.')
      return
    }
    setEstado('capturando')
    setMensaje(null)

    let sesion: { captureUrl: string; uniqueId: string; publicKey: string }
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
        error?: string
      }
      if (!data.ok || !data.captureUrl || !data.uniqueId) {
        setEstado('error')
        setMensaje(data.error ?? 'No se pudo iniciar la ventana de pago. Intenta de nuevo.')
        return
      }
      sesion = { captureUrl: data.captureUrl, uniqueId: data.uniqueId, publicKey: data.publicKey || publicKey }
    } catch {
      setEstado('error')
      setMensaje('No se pudo iniciar la ventana de pago. Revisa tu conexión.')
      return
    }

    sdk.SetProperties({
      name: 'CARTOWN Wash & Detailing',
      email: '',
      button_label: `Pagar ${montoTexto}`,
      description: 'Membresía CARTOWN',
      currency: 'DOP',
      lang: 'ESP',
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
  }, [publicKey, montoTexto])

  if (estado === 'aprobado') {
    return (
      <div className="rounded-2xl border border-success/25 bg-success/10 p-5 text-center">
        <CheckCircle2 className="mx-auto h-8 w-8 text-success" aria-hidden />
        <p className="mt-2 font-semibold text-success">¡Pago aprobado!</p>
        <p className="mt-1 text-sm text-foreground">Tu membresía quedó activa.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border/60 bg-muted/30 p-4">
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
          Pago seguro procesado por CardNET
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Tus datos de tarjeta se ingresan directamente en la ventana de CardNET.
          {' '}CARTOWN y MembeGo nunca ven ni guardan tu número de tarjeta.
        </p>
      </div>

      {estado === 'error' && mensaje && (
        <p className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {mensaje}
        </p>
      )}

      {/* Fase 2: renovación automática. Solo aparece antes de pagar. */}
      {(estado === 'listo' || estado === 'error') && (
        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border/60 bg-card p-3">
          <input
            type="checkbox"
            checked={guardar}
            onChange={(e) => setGuardar(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
          />
          <span className="text-sm">
            <span className="font-medium text-foreground">Guardar mi tarjeta para renovar automáticamente</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              La tarjeta se guarda de forma segura en CardNET. Podrás quitarla cuando quieras.
            </span>
          </span>
        </label>
      )}

      <Button
        type="button"
        onClick={() => void abrirCaptura()}
        disabled={estado === 'cargando' || estado === 'capturando' || estado === 'cobrando'}
        className="w-full py-6 text-base font-semibold"
      >
        {estado === 'cargando' ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando pasarela…
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
            <CreditCard className="mr-2 h-4 w-4" /> Reintentar pago con tarjeta
          </>
        ) : (
          <>
            <CreditCard className="mr-2 h-4 w-4" /> Pagar {montoTexto} con tarjeta
          </>
        )}
      </Button>
    </div>
  )
}

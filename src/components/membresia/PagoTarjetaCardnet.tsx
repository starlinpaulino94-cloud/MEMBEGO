'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CreditCard, Loader2, Lock, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * PAGO CON TARJETA (CardNET 3DS) — lado del cliente.
 *
 * ── PCI: LA TARJETA VIVE SOLO AQUÍ, EN MEMORIA ──────────────────────────────
 *
 * El número y el CVV se guardan en el estado de este componente y se mandan al
 * servidor (que los reenvía a CardNET y los descarta). NUNCA se escriben en
 * `localStorage`/`sessionStorage` ni en la URL: si sobrevivieran a un refresco,
 * quedarían en disco. Por eso el reto del banco se abre en un IFRAME y no como
 * navegación completa — así esta página (y la tarjeta que tiene en memoria)
 * sigue viva mientras el cliente hace el OTP, y al volver se completa el cobro.
 *
 * ── EL FLUJO ────────────────────────────────────────────────────────────────
 *
 *   1. Enviar la tarjeta → POST /iniciar.
 *   2a. Respuesta 'aprobado'/'rechazado' → listo (no hubo reto).
 *   2b. Respuesta 'reto' → se abre el iframe con la pantalla del banco. Cuando
 *       el banco termina, el iframe (ya de vuelta en nuestro dominio) hace
 *       postMessage; aquí se recibe y se llama a POST /completar con la tarjeta
 *       que seguimos teniendo en memoria.
 */

interface Props {
  /** Uno de los dos. */
  membershipId?: string
  compraId?: string
  /** Para mostrar cuánto se va a cobrar. El monto REAL lo fija el servidor. */
  montoTexto: string
  /** A dónde llevar al cliente cuando el pago se aprueba. */
  urlExito: string
}

type Reto = {
  intentoId: string
  integratorTxId: string
  threeDSServerTransID: string
  challengeUrl: string
  challengeToken: string
}

type Fase = 'form' | 'procesando' | 'reto' | 'ok' | 'error'

export function PagoTarjetaCardnet({ membershipId, compraId, montoTexto, urlExito }: Props) {
  const [numero, setNumero] = useState('')
  const [vencimiento, setVencimiento] = useState('')
  const [cvv, setCvv] = useState('')
  const [nombre, setNombre] = useState('')
  const [fase, setFase] = useState<Fase>('form')
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [reto, setReto] = useState<Reto | null>(null)

  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const formRetoRef = useRef<HTMLFormElement | null>(null)
  // La tarjeta se guarda en un ref para tenerla disponible al volver del reto
  // sin re-render, y para poder borrarla al terminar.
  const tarjetaRef = useRef({ numero: '', vencimiento: '', cvv: '' })

  const objetivo = membershipId ? { membershipId } : { compraId }

  const limpiarTarjeta = useCallback(() => {
    tarjetaRef.current = { numero: '', vencimiento: '', cvv: '' }
    setNumero('')
    setCvv('')
    setVencimiento('')
  }, [])

  const aplicarResultado = useCallback(
    (data: { estado?: string; motivo?: string }) => {
      if (data.estado === 'aprobado') {
        limpiarTarjeta()
        setFase('ok')
        setMensaje(null)
        // Pequeña pausa para que se vea el estado antes de salir.
        setTimeout(() => {
          window.location.href = urlExito
        }, 900)
        return
      }
      // rechazado / error
      setFase('error')
      setMensaje(data.motivo ?? 'No se pudo completar el pago.')
    },
    [limpiarTarjeta, urlExito]
  )

  const completarTrasReto = useCallback(
    async (r: Reto) => {
      setFase('procesando')
      try {
        const resp = await fetch('/api/pagos/cardnet/completar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            intentoId: r.intentoId,
            integratorTxId: r.integratorTxId,
            threeDSServerTransID: r.threeDSServerTransID,
            pan: tarjetaRef.current.numero,
            cvv: tarjetaRef.current.cvv,
            vencimiento: tarjetaRef.current.vencimiento,
          }),
        })
        aplicarResultado((await resp.json()) as { estado?: string; motivo?: string })
      } catch {
        setFase('error')
        setMensaje('Se perdió la conexión al completar el pago. Revisa tu historial antes de reintentar.')
      }
    },
    [aplicarResultado]
  )

  // Escucha el aviso del iframe ("el reto terminó").
  useEffect(() => {
    if (fase !== 'reto' || !reto) return
    function onMensaje(e: MessageEvent) {
      // Solo de nuestro propio origen: el iframe, al volver del banco, ya está
      // en nuestro dominio.
      if (e.origin !== window.location.origin) return
      const d = e.data as { tipo?: string } | null
      if (d && d.tipo === 'cardnet-reto-listo' && reto) {
        window.removeEventListener('message', onMensaje)
        void completarTrasReto(reto)
      }
    }
    window.addEventListener('message', onMensaje)
    // Autoenvía el formulario del reto hacia el iframe.
    formRetoRef.current?.submit()
    return () => window.removeEventListener('message', onMensaje)
  }, [fase, reto, completarTrasReto])

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (fase === 'procesando') return
    setMensaje(null)

    const panDigitos = numero.replace(/\D/g, '')
    if (panDigitos.length < 13) return setMensaje('Revisa el número de tarjeta.')
    if (cvv.replace(/\D/g, '').length < 3) return setMensaje('Revisa el código CVV.')
    if (vencimiento.replace(/\D/g, '').length < 4) return setMensaje('Revisa la fecha de vencimiento (MM/AA).')

    tarjetaRef.current = { numero: panDigitos, vencimiento, cvv }
    setFase('procesando')

    try {
      const resp = await fetch('/api/pagos/cardnet/iniciar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...objetivo,
          pan: panDigitos,
          cvv,
          vencimiento,
          cardholderName: nombre || undefined,
          browser: {
            screenWidth: window.screen?.width,
            screenHeight: window.screen?.height,
            tz: -(new Date().getTimezoneOffset() / 60),
            language: navigator.language,
          },
        }),
      })
      const data = (await resp.json()) as Reto & { estado?: string; motivo?: string }

      if (data.estado === 'reto') {
        setReto({
          intentoId: data.intentoId,
          integratorTxId: data.integratorTxId,
          threeDSServerTransID: data.threeDSServerTransID,
          challengeUrl: data.challengeUrl,
          challengeToken: data.challengeToken,
        })
        setFase('reto')
        return
      }
      aplicarResultado(data)
    } catch {
      setFase('error')
      setMensaje('No se pudo contactar la pasarela. Intenta de nuevo.')
    }
  }

  if (fase === 'ok') {
    return (
      <div className="rounded-2xl border border-success/25 bg-success/10 p-5 text-center">
        <ShieldCheck className="mx-auto h-8 w-8 text-success" aria-hidden />
        <p className="mt-2 font-semibold text-success">Pago aprobado</p>
        <p className="mt-1 text-sm text-muted-foreground">Activando tu compra…</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* El reto del banco se pinta en un iframe; la página no se recarga. */}
      {fase === 'reto' && reto && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Tu banco pide confirmar la compra. Completa el paso en el recuadro.
          </p>
          <iframe
            ref={iframeRef}
            name="cardnet-reto"
            title="Autenticación del banco"
            className="h-96 w-full rounded-xl border border-border/60 bg-white"
          />
          {/* Formulario que abre la pantalla del banco DENTRO del iframe. */}
          <form
            ref={formRetoRef}
            action={reto.challengeUrl}
            method="POST"
            target="cardnet-reto"
            className="hidden"
          >
            <input type="hidden" name="browserChallengeToken" value={reto.challengeToken} />
          </form>
        </div>
      )}

      {fase !== 'reto' && (
        <form onSubmit={enviar} className="space-y-3">
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
            <p className="flex items-center gap-1.5 font-medium text-foreground">
              <Lock className="h-3.5 w-3.5 text-primary" aria-hidden /> Pago seguro
            </p>
            <p className="mt-1">
              Tus datos viajan cifrados a la pasarela del banco. El car wash no
              guarda tu número de tarjeta.
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="cn-num" className="text-sm font-medium text-foreground">
              Número de tarjeta
            </label>
            <div className="relative">
              <CreditCard className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                id="cn-num"
                inputMode="numeric"
                autoComplete="cc-number"
                maxLength={23}
                placeholder="0000 0000 0000 0000"
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                className="h-11 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="cn-exp" className="text-sm font-medium text-foreground">
                Vence (MM/AA)
              </label>
              <input
                id="cn-exp"
                inputMode="numeric"
                autoComplete="cc-exp"
                maxLength={7}
                placeholder="12/27"
                value={vencimiento}
                onChange={(e) => setVencimiento(e.target.value)}
                className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="cn-cvv" className="text-sm font-medium text-foreground">
                CVV
              </label>
              <input
                id="cn-cvv"
                inputMode="numeric"
                autoComplete="cc-csc"
                maxLength={4}
                placeholder="123"
                value={cvv}
                onChange={(e) => setCvv(e.target.value)}
                className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="cn-name" className="text-sm font-medium text-foreground">
              Nombre en la tarjeta
            </label>
            <input
              id="cn-name"
              autoComplete="cc-name"
              placeholder="Como aparece en la tarjeta"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
            />
          </div>

          {mensaje && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-sm text-destructive">
              {mensaje}
            </p>
          )}

          <Button type="submit" disabled={fase === 'procesando'} className="w-full py-6 text-base font-semibold">
            {fase === 'procesando' ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Procesando…
              </>
            ) : (
              <>Pagar {montoTexto}</>
            )}
          </Button>
        </form>
      )}
    </div>
  )
}

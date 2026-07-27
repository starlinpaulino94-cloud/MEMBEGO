'use client'

/**
 * Regalos P2P: tarjetas de regalos recibidos y enviados.
 *
 * Hay DOS clases de regalo y la tarjeta se comporta distinto en cada una:
 *
 *  · TRANSFERENCIA DE USOS — el remitente ya tenía esos usos y los cede. El
 *    destinatario acepta o rechaza; al aceptar va a la pantalla de celebración.
 *
 *  · REGALO PAGADO (promoción o membresía) — el remitente lo está comprando.
 *    Nadie acepta nada: al confirmarse el pago el beneficio aparece solo en la
 *    wallet del amigo. Aquí la tarjeta muestra el estado del pago, y al
 *    remitente además cómo completarlo.
 */

import { useActionState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Clock, CreditCard, Gift, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  responderRegalo,
  cancelarRegalo,
  type RegaloActionState,
} from '@/modules/regalos/actions'
import type { RegaloItem } from '@/modules/regalos/queries'

const initial: RegaloActionState = {}

export const ESTADO_REGALO: Record<string, { label: string; clase: string }> = {
  PENDIENTE: { label: 'Pendiente', clase: 'bg-warning/15 text-warning-foreground' },
  ACEPTADO: { label: 'Aceptado', clase: 'bg-success/15 text-success' },
  RECHAZADO: { label: 'Rechazado', clase: 'bg-destructive/10 text-destructive' },
  EXPIRADO: { label: 'Expirado', clase: 'bg-muted text-muted-foreground' },
  CANCELADO: { label: 'Cancelado', clase: 'bg-muted text-muted-foreground' },
}

/**
 * "Pendiente" a secas no dice nada. Un regalo pendiente puede estar esperando
 * que el amigo responda, o esperando que el remitente pague — y quien mira la
 * pantalla solo puede actuar en uno de los dos casos.
 */
function etiquetaPendiente(r: RegaloItem): string {
  if (r.estado !== 'PENDIENTE') return ESTADO_REGALO[r.estado]?.label ?? r.estado
  return r.espera === 'PAGO' ? 'Falta el pago' : 'Esperando respuesta'
}

function EstadoChip({ r }: { r: RegaloItem }) {
  const base = ESTADO_REGALO[r.estado] ?? { label: r.estado, clase: 'bg-muted text-muted-foreground' }
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${base.clase}`}>
      {etiquetaPendiente(r)}
    </span>
  )
}

/** Bloque de pago: referencia para cobrar en caja y/o enlace para completarlo. */
function BloquePago({ r, mio }: { r: RegaloItem; mio: boolean }) {
  if (r.espera !== 'PAGO' || !r.pago) return null
  return (
    <div className="mt-3 rounded-xl border border-warning/30 bg-warning/10 p-3">
      <p className="flex items-center gap-1.5 text-xs font-bold text-foreground">
        <CreditCard className="h-3.5 w-3.5" />
        {mio ? 'Este regalo espera tu pago' : 'Tu amigo todavía está pagándolo'}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {mio
          ? 'Tu amigo lo recibirá automáticamente en cuanto el negocio confirme el pago. No tienes que avisarle.'
          : 'No tienes que hacer nada: te llegará solo cuando el pago se confirme.'}
      </p>
      {/* La referencia solo la ve QUIEN PAGA. Enseñársela al destinatario le
          sugiere que tiene que pagar algo, que es justo lo contrario. */}
      {mio && r.pago.referencia && (
        <p className="mt-2 text-xs text-muted-foreground">
          Referencia para pagar en caja:{' '}
          <span className="font-mono text-sm font-bold tracking-widest text-foreground">
            {r.pago.referencia}
          </span>
        </p>
      )}
      {mio && r.pago.href && (
        <Link
          href={r.pago.href}
          className="mt-2 inline-flex rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-background"
        >
          Completar el pago
        </Link>
      )}
    </div>
  )
}

function fmtFecha(d: Date) {
  return new Intl.DateTimeFormat('es-DO', {
    timeZone: 'America/Santo_Domingo',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(d))
}

function CabeceraRegalo({ r, prefijo }: { r: RegaloItem; prefijo: string }) {
  // Una membresía regalada no se cuenta en "usos": decir "0 usos de Membresía
  // Oro" es ruido. Solo se antepone la cantidad cuando de verdad son usos.
  const titulo =
    r.tipo === 'REGALO_MEMBRESIA' || r.usos <= 0
      ? r.beneficio
      : `${r.usos} uso${r.usos !== 1 ? 's' : ''} de ${r.beneficio}`
  return (
    <div className="min-w-0 flex-1">
      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
        <Gift className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        {titulo}
        <EstadoChip r={r} />
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {prefijo} <strong>{r.contraparte}</strong> · {fmtFecha(r.createdAt)}
        {r.estado === 'PENDIENTE' && (
          <span className="ml-2 inline-flex items-center gap-1">
            <Clock className="h-3 w-3" /> expira {fmtFecha(r.expiraAt)}
          </span>
        )}
      </p>
      {r.mensaje && (
        <p className="mt-2 rounded-xl bg-muted/60 p-2 text-xs italic text-foreground">
          “{r.mensaje}”
        </p>
      )}
    </div>
  )
}

export function RegaloRecibidoCard({ regalo }: { regalo: RegaloItem }) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(responderRegalo, initial)
  const decisionRef = useRef<'aceptar' | 'rechazar'>('aceptar')

  useEffect(() => {
    if (state.error) toast.error(state.error)
    if (state.success && state.detalle) {
      toast.success(state.detalle)
      if (decisionRef.current === 'aceptar') router.push('/cliente/celebracion')
    }
  }, [state, router])

  return (
    <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-start gap-3">
        <CabeceraRegalo r={regalo} prefijo="De" />
        {/* Aceptar/Rechazar SOLO cuando de verdad hay algo que decidir. Un
            regalo que el remitente está pagando no se acepta: llega solo. */}
        {regalo.espera === 'RESPUESTA' && (
          <form action={formAction} className="flex shrink-0 gap-2">
            <input type="hidden" name="regaloId" value={regalo.id} />
            <Button
              type="submit"
              name="decision"
              value="aceptar"
              size="sm"
              disabled={pending}
              onClick={() => (decisionRef.current = 'aceptar')}
              className="gap-1.5"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Aceptar
            </Button>
            <Button
              type="submit"
              name="decision"
              value="rechazar"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => (decisionRef.current = 'rechazar')}
              className="gap-1.5 text-destructive"
            >
              <X className="h-3.5 w-3.5" /> Rechazar
            </Button>
          </form>
        )}
      </div>
      <BloquePago r={regalo} mio={false} />
    </div>
  )
}

export function RegaloEnviadoCard({ regalo }: { regalo: RegaloItem }) {
  const [state, formAction, pending] = useActionState(cancelarRegalo, initial)

  useEffect(() => {
    if (state.error) toast.error(state.error)
    if (state.success && state.detalle) toast.success(state.detalle)
  }, [state])

  return (
    <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-start gap-3">
        <CabeceraRegalo r={regalo} prefijo="Para" />
        {regalo.estado === 'PENDIENTE' && (
          <form action={formAction} className="shrink-0">
            <input type="hidden" name="regaloId" value={regalo.id} />
            <Button type="submit" size="sm" variant="ghost" disabled={pending} className="gap-1.5 text-muted-foreground">
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Cancelar
            </Button>
          </form>
        )}
      </div>
      <BloquePago r={regalo} mio />
    </div>
  )
}

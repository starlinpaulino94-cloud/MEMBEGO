import { urlComprobante } from '@/modules/storage/comprobantes'
import { ComprobanteLink } from '@/components/pagos/ComprobanteLink'
import Link from 'next/link'
import {
  CreditCard,
  ArrowRightLeft,
  XCircle,
  ArrowLeft,
  Receipt,
  Sparkles,
} from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { getClientePagos } from '@/modules/cliente/queries'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { formatMoney, formatDate } from '@/lib/format'
import { membresiaEstadoUi, type BadgeVariant } from '@/lib/estados'
import { Button } from '@/components/ui/button'
import { BillingCycleHeader } from '@/components/cliente/pagos/BillingCycleHeader'
import { EmptyState } from '@/components/system/EmptyState'
import { PagosLedger } from '@/components/cliente/pagos/PagosLedger'
import { cn } from '@/lib/utils'
import { SinEmpresaTodavia } from '@/components/cliente/SinEmpresaTodavia'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Mis pagos',
  description: 'Estado de tu membresía e historial de pagos',
}

function fmtDate(d: Date | null) {
  if (!d) return '—'
  return formatDate(d)
}

const NECESITA_PAGO = ['PENDIENTE', 'RECHAZADA']

/** Color del micro-punto de estado según la variante semántica del estado. */
const DOT_COLOR: Record<BadgeVariant, string> = {
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  info: 'bg-sky-500',
  destructive: 'bg-rose-500',
  secondary: 'bg-slate-400',
  outline: 'bg-slate-400',
  default: 'bg-primary',
}

/**
 * Micro-badge de estado minimalista (`● Activa`): la mitad de tamaño que un
 * badge tradicional; cuando el servicio está vivo (Activa) el punto late con
 * un pulso muy lento.
 */
function EstadoDot({ estado }: { estado: string }) {
  const ui = membresiaEstadoUi(estado)
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
      <span
        aria-hidden
        className={cn(
          'h-2 w-2 rounded-full',
          DOT_COLOR[ui.variant],
          estado === 'ACTIVA' && 'animate-pulse [animation-duration:2.5s]'
        )}
      />
      {ui.label}
    </span>
  )
}

/**
 * Aviso del retorno de la pasarela (`?pago=`). Lo escribe /api/pagos/cardnet/retorno.
 *
 * "pendiente" no es un error del cliente: es que el cobro no se pudo confirmar
 * contra la pasarela en ese momento. Se le dice la verdad —que no active nada
 * y que no vuelva a pagar— en vez de un "algo salió mal" que invita a
 * reintentar y pagar dos veces.
 */
const AVISO_PAGO: Record<string, { tono: string; titulo: string; texto: string }> = {
  ok: {
    tono: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100',
    titulo: 'Pago aprobado',
    texto: 'Tu compra ya está activa. Puedes usarla desde tus beneficios.',
  },
  rechazado: {
    tono: 'border-rose-500/30 bg-rose-500/10 text-rose-900 dark:text-rose-100',
    titulo: 'Pago rechazado',
    texto: 'El banco no aprobó la transacción. No se te cobró nada. Puedes intentar con otra tarjeta.',
  },
  pendiente: {
    tono: 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100',
    titulo: 'Estamos confirmando tu pago',
    texto:
      'No pudimos confirmar el resultado con el banco todavía. No vuelvas a pagar: si el cobro se realizó, tu compra se activará sola y te avisaremos.',
  },
  error: {
    tono: 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100',
    titulo: 'No pudimos procesar el retorno',
    texto: 'Si crees que se te cobró, escríbenos con la fecha y hora antes de intentar de nuevo.',
  },
}

export default async function PagosPage({
  searchParams,
}: {
  searchParams: Promise<{ pago?: string }>
}) {
  const { pago } = await searchParams
  const aviso = pago ? AVISO_PAGO[pago] : undefined
  const user = await requireRole('CLIENTE')
  const clienteId = user.metadata.clienteId
  // Una cuenta de Membego que todavía no es cliente de ningún negocio. No
  // es un error ni una falta de permiso: es el primer día. Ver
  // `SinEmpresaTodavia`.
  if (!clienteId) {
    return <SinEmpresaTodavia que="pagos"
      detalle="Aquí aparecerán tus pagos cuando adquieras una membresía o una promoción." />
  }
  if (!clienteId) {
    return (
      <main className="container max-w-5xl py-8">
        <p className="text-muted-foreground">No autorizado.</p>
      </main>
    )
  }

  const prefs = await getRegionalPrefs(user.metadata.companyId)
  const fmtMonto = (n: number | null) => (n ? formatMoney(n, prefs) : '—')

  let data: Awaited<ReturnType<typeof getClientePagos>> = { membership: null, historial: [] }
  let loadError = false
  try {
    data = await getClientePagos(clienteId)
  } catch (e) {
    loadError = true
    console.error('[cliente-pagos]', e)
  }

  const { membership: m, historial: historialCrudo } = data

  // El bucket de comprobantes es privado (auditoría · C-01): lo que se guarda
  // es la ruta, no una URL. Aquí se firma cada una —5 minutos, previa
  // comprobación de permiso— antes de pasársela al visor, que es un componente
  // de cliente y no puede firmar nada por su cuenta.
  const historial = m
    ? await Promise.all(
        historialCrudo.map(async (item) => ({
          ...item,
          comprobanteUrl: await urlComprobante('membresia', m.id, item.comprobanteUrl),
        }))
      )
    : historialCrudo
  const necesitaPago = m ? NECESITA_PAGO.includes(m.estado) : false
  const cambioPendiente = !!m?.planSolicitadoNombre

  return (
    <main className="container max-w-5xl py-8">
      {aviso && (
        <div className={cn('mb-6 rounded-2xl border p-4', aviso.tono)}>
          <p className="font-bold">{aviso.titulo}</p>
          <p className="mt-1 text-small opacity-90">{aviso.texto}</p>
        </div>
      )}

      {/* ── Cabecera ──────────────────────────────────────────────────────── */}
      <header className="mb-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
              Finanzas
            </p>
            <h1 className="mt-1.5 text-h1 tracking-tight text-foreground">
              Mis pagos
            </h1>
            <p className="mt-1 text-small text-muted-foreground">
              Tu plan, tu ciclo y cada pago. Todo claro, sin sorpresas.
            </p>
          </div>
          <Button asChild variant="outline" className="shrink-0">
            <Link href="/mis-membresias">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Mis membresías
            </Link>
          </Button>
        </div>
      </header>

      {loadError ? (
        <EmptyState
          icon={XCircle}
          title="No pudimos cargar tus pagos"
          description="Intenta de nuevo en unos momentos."
          action={
            <Button asChild variant="outline">
              <Link href="/cliente/pagos">Reintentar</Link>
            </Button>
          }
        />
      ) : !m ? (
        <EmptyState
          icon={Receipt}
          title="Sin pagos todavía"
          description="Selecciona un plan para comenzar tu membresía y aquí verás todos tus pagos."
          action={
            <Button asChild size="lg">
              <Link href="/cliente/planes">
                <Sparkles className="mr-2 h-4 w-4" />
                Ver planes
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-8">
          {/* ── Membresía actual: panel de suscripción estilo Stripe Billing ─
               Sin sub-cajas grises ni datos repetidos: el monto y el estado
               aparecen UNA sola vez. */}
          <section className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
            <div className="flex items-center justify-between border-b border-border/40 px-5 py-3">
              <h2 className="text-sm font-semibold text-muted-foreground">Membresía actual</h2>
              <EstadoDot estado={m.estado} />
            </div>

            <div className="p-5">
              {/* Plan + monto: única aparición del precio en la tarjeta */}
              <div className="mb-6 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                <h3 className="text-xl font-bold text-foreground">{m.planNombre}</h3>
                {m.montoPagado != null && (
                  <span className="font-mono text-2xl font-bold tabular-nums tracking-tight text-foreground">
                    {fmtMonto(m.montoPagado)}
                  </span>
                )}
              </div>

              {/* Ciclo de facturación en fila fluida con divisores finos */}
              <div className="mb-6">
                <BillingCycleHeader
                  items={[
                    {
                      label: 'Ciclo de facturación',
                      value:
                        m.fechaInicio || m.fechaVencimiento
                          ? `${fmtDate(m.fechaInicio)} – ${fmtDate(m.fechaVencimiento)}`
                          : '—',
                    },
                    { label: 'Método', value: m.metodoPagoNombre ?? '—' },
                    {
                      label: 'Próximo cobro',
                      value: m.estado === 'ACTIVA' ? fmtDate(m.fechaVencimiento) : '—',
                    },
                  ]}
                />
              </div>

              <ComprobanteLink
                tipo="membresia"
                id={m.id}
                valor={m.comprobanteUrl}
                className="mb-4 inline-flex items-center gap-2 rounded-xl border border-border/70 px-3.5 py-2 text-sm text-primary transition hover:bg-muted"
              />

              {m.estado === 'RECHAZADA' && m.rechazadoReason && (
                <div className="mb-4 rounded-xl border border-destructive/25 bg-destructive/5 p-3.5 text-sm text-destructive">
                  <strong>Motivo del rechazo:</strong> {m.rechazadoReason}
                </div>
              )}

              {cambioPendiente && (
                <div className="mb-4 flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <ArrowRightLeft className="h-4 w-4 text-primary" />
                  </span>
                  <div className="text-sm">
                    <p className="font-semibold text-foreground">
                      Cambio a {m.planSolicitadoNombre} solicitado
                    </p>
                    <p className="mt-0.5 text-muted-foreground">
                      Sube el comprobante del nuevo plan para que el equipo lo apruebe.
                    </p>
                  </div>
                </div>
              )}

              {(necesitaPago || cambioPendiente) && (
                <Button asChild className="shadow-glow">
                  <Link href={`/membresia/${m.id}`}>
                    <CreditCard className="mr-2 h-4 w-4" />
                    {m.estado === 'RECHAZADA'
                      ? 'Reenviar comprobante'
                      : cambioPendiente
                        ? 'Subir comprobante del cambio'
                        : 'Completar pago'}
                  </Link>
                </Button>
              )}
            </div>
          </section>

          {/* ── Historial ─────────────────────────────────────────────────── */}
          <section>
            <div className="mb-4 flex items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight text-foreground">
                Historial de pagos
              </h2>
              {historial.length > 0 && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                  {historial.length}
                </span>
              )}
            </div>

            {/* Extracto contable limpio con visor de comprobantes integrado */}
            <PagosLedger items={historial} prefs={prefs} />
          </section>
        </div>
      )}
    </main>
  )
}

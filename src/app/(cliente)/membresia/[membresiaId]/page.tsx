import { notFound, redirect } from 'next/navigation'
import { getUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { membresiaEstadoUi } from '@/lib/estados'
import { differenceInCalendarDays } from 'date-fns'
import Link from 'next/link'
import {
  ArrowLeft,
  Car,
  Check,
  Gift,
  Infinity as InfinityIcon,
  History,
  Share2,
  Store,
  Utensils,
  Calendar,
  Gauge,
} from 'lucide-react'
import { QRShareCard } from '@/components/qr/QRShareCard'
import { OpcionesPago } from '@/components/membresia/OpcionesPago'
import { Reveal } from '@/components/ui/reveal'
import { formatMoney } from '@/lib/format'
import { ofrecerTransferencia } from '@/modules/pagos/metodosDisponibles'

export const metadata = {
  title: 'Detalles de Membresía',
}

const TZ = 'America/Santo_Domingo'
const fmtFechaLarga = (d: Date) =>
  new Intl.DateTimeFormat('es-DO', { timeZone: TZ, dateStyle: 'long' }).format(d)
const fmtFechaHora = (d: Date) =>
  new Intl.DateTimeFormat('es-DO', {
    timeZone: TZ,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d)
const fmtHora = (d: Date) =>
  new Intl.DateTimeFormat('es-DO', { timeZone: TZ, timeStyle: 'short' }).format(d)
const fmtDiaClave = (d: Date) =>
  new Intl.DateTimeFormat('es-DO', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
const fmtDiaCorto = (d: Date) =>
  new Intl.DateTimeFormat('es-DO', { timeZone: TZ, day: 'numeric', month: 'long' }).format(d)

/** Cabecera de fecha relativa del timeline: Hoy · Ayer · "12 de julio". */
function labelDiaRelativo(d: Date, now: Date): string {
  const clave = fmtDiaClave(d)
  if (clave === fmtDiaClave(now)) return 'Hoy'
  if (clave === fmtDiaClave(new Date(now.getTime() - 24 * 60 * 60 * 1000))) return 'Ayer'
  return fmtDiaCorto(d)
}

/** Icono temático del timeline según el rubro del negocio. */
function iconoNegocio(type: string) {
  if (type === 'carwash') return Car
  if (type === 'restaurante') return Utensils
  return Store
}

export default async function MembershipDetail({ params }: { params: Promise<{ membresiaId: string }> }) {
  const { membresiaId } = await params
  const user = await getUser()
  if (!user || user.metadata.role !== 'CLIENTE') {
    redirect('/login')
  }

  let membership = null
  try {
    membership = await prisma.membership.findUnique({
      where: { id: membresiaId },
      include: {
        cliente: {
          include: { company: true },
        },
        plan: true,
        planSolicitado: true,
        metodoPago: { select: { tipo: true } },
      },
    })
  } catch (error) {
    console.error('[membresia-detail] Error loading membership:', error)
    notFound()
  }

  if (!membership) {
    notFound()
  }

  const esPropietario =
    membership.cliente.supabaseId === user.supabaseId ||
    membership.cliente.id === user.metadata.clienteId
  if (!esPropietario) {
    notFound()
  }

  const now = new Date()
  const isActive = membership.estado === 'ACTIVA' && (!membership.fechaVencimiento || membership.fechaVencimiento > now)

  const visits = await prisma.visit.findMany({
    where: { membershipId: membresiaId },
    include: { vehiculo: true },
    orderBy: { fechaVisita: 'desc' },
    take: 20,
  })

  const qrToken = await prisma.qrToken.findFirst({
    where: { membresiaId: membresiaId, activo: true },
    orderBy: { createdAt: 'desc' },
  })

  const enviosQr = await prisma.auditLog.findMany({
    where: {
      accion: 'QR_COMPARTIDO',
      payload: { path: ['membresiaId'], equals: membresiaId },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, createdAt: true },
  }).catch(() => [])

  const diasRestantes = membership.fechaVencimiento
    ? differenceInCalendarDays(membership.fechaVencimiento, now)
    : null

  const needsInitialPayment = ['PENDIENTE', 'RECHAZADA'].includes(membership.estado)
  const isChangePending = isActive && membership.planIdSolicitado != null
  const needsPayment = needsInitialPayment || isChangePending
  const planAPagar = isChangePending ? membership.planSolicitado : membership.plan

  const descuentoBienvenida =
    !isChangePending && membership.fechaInicio == null
      ? Number(membership.descuentoBienvenida ?? 0)
      : 0
  const montoAPagar = Math.max(0, Number(planAPagar?.precio ?? 0) - descuentoBienvenida)

  // La transferencia se ofrece si la empresa la tiene encendida O si esta
  // membresía ya se comprometió con ella (eligió cuenta o subió comprobante).
  // Apagar el método no puede dejar tirado a quien ya iba por ese camino.
  // PRESENCIAL no se toca: pagar en el local sigue existiendo siempre.
  const comprometidaConTransferencia =
    membership.metodoPago?.tipo === 'TRANSFERENCIA' || membership.comprobanteUrl != null
  const transferenciaActiva =
    needsPayment &&
    (await ofrecerTransferencia(membership.cliente.companyId, comprometidaConTransferencia))

  const [metodosPago, sucursales] = needsPayment
    ? await Promise.all([
        prisma.metodoPago.findMany({
          where: {
            companyId: membership.cliente.companyId,
            activo: true,
            ...(transferenciaActiva ? {} : { tipo: 'PRESENCIAL' as const }),
          },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.sucursal.findMany({
          where: { companyId: membership.cliente.companyId, activa: true },
          select: { id: true, nombre: true, direccion: true },
          orderBy: { nombre: 'asc' },
        }),
      ])
    : [[], []]

  const estadoLabel = membresiaEstadoUi(membership.estado).label
  const company = membership.cliente.company

  // Tono del chip de estado en la cabecera.
  const tone = isActive
    ? 'active'
    : membership.estado === 'VENCIDA' ||
        (membership.fechaVencimiento && membership.fechaVencimiento <= now)
      ? 'expired'
      : 'pending'
  const IconoVisita = iconoNegocio(company.type)

  // Timeline agrupado por día relativo (Hoy / Ayer / "12 de julio").
  const visitasPorDia: { label: string; visitas: typeof visits }[] = []
  for (const visit of visits) {
    const label = labelDiaRelativo(visit.fechaVisita, now)
    const grupo = visitasPorDia[visitasPorDia.length - 1]
    if (grupo && grupo.label === label) grupo.visitas.push(visit)
    else visitasPorDia.push({ label, visitas: [visit] })
  }

  return (
    <main className="container max-w-2xl py-8">
      <Link
        href="/mis-membresias"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Mis membresías
      </Link>

      {/* Cabecera simple: la tarjeta visual vive en Mis membresías */}
      <header className="mb-8 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{company.name}</p>
          <h1 className="mt-0.5 truncate text-h2 text-foreground">
            {membership.plan.nombre}
          </h1>
        </div>
        <span
          className={`mt-1 shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
            tone === 'active'
              ? 'bg-success/15 text-success'
              : tone === 'expired'
                ? 'bg-destructive/10 text-destructive'
                : 'bg-warning/15 text-warning-foreground'
          }`}
        >
          {estadoLabel}
        </span>
      </header>

      <div className="space-y-6">
        {/* Sección de pago */}
        {needsPayment && (
          <section className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
            <div className="mb-5">
              <h2 className="text-lg font-semibold text-foreground">
                {isChangePending ? 'Pago del cambio de plan' : 'Completar pago'}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {isChangePending
                  ? `Cambio al plan ${planAPagar?.nombre}. Sube el comprobante para que el equipo lo apruebe; tu plan actual sigue activo mientras tanto.`
                  : 'Realiza el pago con uno de los métodos y sube tu comprobante para activar tu membresía.'}
              </p>
            </div>

            <div className="rounded-xl bg-muted/50 p-4">
              {descuentoBienvenida > 0 && (
                <>
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>Plan {planAPagar?.nombre}</span>
                    <span>{formatMoney(Number(planAPagar?.precio ?? 0), company)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm text-emerald-600 dark:text-emerald-400">
                    <span className="inline-flex items-center gap-1.5">
                      <Gift className="h-4 w-4" /> Descuento de bienvenida
                    </span>
                    <span>-{formatMoney(descuentoBienvenida, company)}</span>
                  </div>
                  <div className="my-2 border-t border-border/60" />
                </>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Monto a pagar</span>
                <span className="text-2xl font-bold tracking-tight text-foreground">
                  {formatMoney(montoAPagar, company)}
                </span>
              </div>
            </div>

            {membership.estado === 'RECHAZADA' && membership.rechazadoReason && (
              <div className="mt-4 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
                <strong>Motivo del rechazo:</strong> {membership.rechazadoReason}
              </div>
            )}

            <div className="mt-5">
              <OpcionesPago
                membershipId={membership.id}
                companyName={company.name}
                transferencias={metodosPago
                  .filter((m) => m.tipo === 'TRANSFERENCIA')
                  .map((m) => ({
                    id: m.id,
                    nombre: m.nombre,
                    titular: m.titular,
                    numeroCuenta: m.numeroCuenta,
                    tipoCuenta: m.tipoCuenta,
                    instrucciones: m.instrucciones,
                  }))}
                presenciales={metodosPago
                  .filter((m) => m.tipo === 'PRESENCIAL')
                  .map((m) => ({ id: m.id, nombre: m.nombre, instrucciones: m.instrucciones }))}
                sucursales={sucursales}
                avisoPresencialEnviado={
                  membership.metodoPago?.tipo === 'PRESENCIAL' && !membership.comprobanteUrl
                }
                referencia={membership.referencia}
                transferenciaDisponible={transferenciaActiva}
              />
            </div>
          </section>
        )}

        {/* QR */}
        {qrToken && isActive ? (
          <QRShareCard
            qrTokenId={qrToken.id}
            token={qrToken.token}
            companyName={company.name}
            diasRestantes={diasRestantes}
            esIlimitado={membership.plan.esIlimitado ?? false}
            lavadosRestantes={membership.lavadosRestantes ?? 0}
            compartidoCount={qrToken.compartidoCount}
            ultimoCompartidoISO={qrToken.ultimoCompartido?.toISOString() ?? null}
          />
        ) : !qrToken && isActive && !membership.plan.esIlimitado && (membership.lavadosRestantes ?? 0) <= 0 ? (
          <div className="rounded-2xl border border-border/60 bg-card p-6 text-center text-sm text-muted-foreground shadow-sm">
            Sin usos disponibles en este período. Renueva tu membresía para seguir
            usando tus beneficios.
          </div>
        ) : !qrToken && isActive ? (
          <div className="rounded-2xl border border-border/60 bg-card p-6 text-center text-sm text-muted-foreground shadow-sm">
            Tu código para canjear se está generando. Vuelve a cargar la página en un
            momento.
          </div>
        ) : null}

        {/* Historial de visitas: timeline con fechas relativas e iconos del rubro */}
        {visits.length > 0 ? (
          <section className="rounded-3xl border border-border/60 bg-card p-6 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-foreground">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/10 dark:bg-violet-500/15">
                <History className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
              </div>
              Historial de visitas
            </h2>
            <div className="space-y-5">
              {visitasPorDia.map((grupo, gIdx) => (
                <Reveal key={grupo.label} delay={Math.min(gIdx, 4) * 60}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {grupo.label}
                  </p>
                  <div className="space-y-0 divide-y divide-border/50">
                    {grupo.visitas.map((visit) => (
                      <div
                        key={visit.id}
                        className="flex items-center gap-3 py-3 text-sm first:pt-0 last:pb-0"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                          <IconoVisita className="h-4.5 w-4.5" aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-foreground">
                            {visit.servicio}
                          </p>
                          {visit.vehiculo && (
                            <p className="truncate text-xs text-muted-foreground">
                              {visit.vehiculo.marca} {visit.vehiculo.modelo}
                              {visit.vehiculo.color ? ` · ${visit.vehiculo.color}` : ''}
                              {visit.vehiculo.placa ? ` · Placa ${visit.vehiculo.placa}` : ''}
                            </p>
                          )}
                        </div>
                        <span className="shrink-0 text-muted-foreground">
                          {fmtHora(visit.fechaVisita)}
                        </span>
                      </div>
                    ))}
                  </div>
                </Reveal>
              ))}
            </div>
          </section>
        ) : (
          <div className="rounded-3xl border border-dashed border-border/80 bg-muted/20 p-8 text-center text-sm text-muted-foreground">
            <Gauge className="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />
            Cuando uses tu membresía, tus visitas aparecerán aquí.
          </div>
        )}

        {/* Beneficios */}
        {membership.plan.beneficios && membership.plan.beneficios.length > 0 && (
          <section className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-foreground">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 dark:bg-emerald-500/15">
                <Gift className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              </div>
              Beneficios del plan
            </h2>
            <ul className="space-y-3">
              {membership.plan.beneficios.map((benefit, idx) => (
                <li key={idx} className="flex items-start gap-3 text-sm text-foreground">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 dark:bg-emerald-500/15">
                    <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                  </span>
                  {benefit}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Detalles */}
        <section className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-foreground">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-500/10 dark:bg-slate-500/15">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            Detalles de la membresía
          </h2>
          <div className="space-y-0 divide-y divide-border/50">
            {membership.fechaInicio && (
              <div className="flex justify-between py-3 text-sm first:pt-0">
                <span className="text-muted-foreground">Fecha de inicio</span>
                <span className="font-medium text-foreground">
                  {fmtFechaLarga(membership.fechaInicio)}
                </span>
              </div>
            )}
            {membership.fechaVencimiento && (
              <div className="flex justify-between py-3 text-sm">
                <span className="text-muted-foreground">Fecha de vencimiento</span>
                <span className="font-medium text-foreground">
                  {fmtFechaLarga(membership.fechaVencimiento)}
                </span>
              </div>
            )}
            {!membership.plan.esIlimitado && (
              <div className="flex justify-between py-3 text-sm">
                <span className="text-muted-foreground">Usos restantes</span>
                <span className="font-semibold text-foreground">{membership.lavadosRestantes}</span>
              </div>
            )}
            {membership.plan.esIlimitado && (
              <div className="flex items-center justify-between py-3 text-sm last:pb-0">
                <span className="text-muted-foreground">Tipo</span>
                <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                  <InfinityIcon className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" /> Ilimitado
                </span>
              </div>
            )}
          </div>
        </section>

        {/* Envíos QR */}
        {enviosQr.length > 0 && (
          <section className="rounded-3xl border border-border/60 bg-card p-6 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-foreground">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10 dark:bg-blue-500/15">
                <Share2 className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              </div>
              Envíos de tu QR
            </h2>
            <div className="space-y-0 divide-y divide-border/50">
              {enviosQr.map((envio) => (
                <div
                  key={envio.id}
                  className="flex items-center justify-between py-3 text-sm first:pt-0 last:pb-0"
                >
                  <span className="inline-flex items-center gap-1.5 text-foreground">
                    <Share2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> QR compartido
                  </span>
                  <span className="text-muted-foreground">
                    {fmtFechaHora(envio.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}

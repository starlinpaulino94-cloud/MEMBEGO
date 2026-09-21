import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import {
  ArrowLeft,
  CheckCircle2,
  Infinity as InfinityIcon,
  ArrowUpCircle,
  Clock,
  Store,
  Gift,
} from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { sinEmpresa } from '@/lib/tenant'
import { planesElegibles } from '@/modules/elegibilidad'
import { getResenasEmpresa } from '@/modules/marketplace/queries'
import { formatMoney, type RegionalPrefs } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { RatingStars } from '@/components/ui/rating-stars'
import { calcularPagoCambioPlan } from '@/modules/membresia/prorrateo'
import { UpgradeCtaButton } from './upgrade-cta-button'

export const dynamic = 'force-dynamic'

interface PlanDetallePageProps {
  params: Promise<{ planId: string }>
}

/**
 * Detalle de un plan en el área del cliente.
 *
 * Espeja la ruta pública `/plan/[id]` pero con el contexto del cliente:
 * - Precio calculado por el motor de elegibilidad (NO `plan.precio` crudo).
 * - Relación del cliente con la empresa: si ya tiene membresía, se muestra;
 *   si el plan visto es mejor, se ofrece el bloque de mejora (sin cobro —
 *   eso es todo 29).
 * - Si no tiene membresía, el CTA lleva a `/cliente/planes` (la compra).
 */
export default async function PlanDetalleClientePage({
  params,
}: PlanDetallePageProps) {
  const { planId } = await params
  const user = await requireRole('CLIENTE')

  // 1. Buscar el plan y su empresa (sin filtro de empresa: el cliente puede
  //    ver planes de cualquier negocio publicado).
  const planBase = await sinEmpresa('detalle plan cliente: plan + empresa', (tx) =>
    tx.plan.findUnique({
      where: { id: planId },
      select: {
        id: true,
        nombre: true,
        descripcion: true,
        precio: true,
        esIlimitado: true,
        lavadosIncluidos: true,
        beneficios: true,
        vigenciaDias: true,
        condiciones: true,
        color: true,
        imagenUrl: true,
        activo: true,
        companyId: true,
        company: {
          select: {
            id: true,
            name: true,
            slug: true,
            logoUrl: true,
            moneda: true,
            idioma: true,
            isPublished: true,
            isActive: true,
          },
        },
      },
    })
  )

  if (!planBase || !planBase.activo || !planBase.company) notFound()
  if (!planBase.company.isPublished || !planBase.company.isActive) notFound()

  const companyId = planBase.companyId
  const prefs: RegionalPrefs = {
    moneda: planBase.company.moneda,
    idioma: planBase.company.idioma,
  }

  // 2. Relación del cliente con esta empresa: ¿tiene membresía aquí?
  //    Se consulta por supabaseId O clienteId (respaldo: datos migrados).
  const clienteId = user.metadata.clienteId
  const supabaseId = user.supabaseId

  const relacion = await sinEmpresa('detalle plan cliente: membresía en esta empresa', async (tx) => {
    // Buscar el cliente del usuario en esta empresa específica.
    const or = [
      ...(supabaseId ? [{ supabaseId }] : []),
      ...(clienteId ? [{ id: clienteId }] : []),
    ]
    const clientes = await tx.cliente.findMany({
      where: { OR: or, companyId },
      select: { id: true },
    })
    if (clientes.length === 0) return { membership: null, clienteId: null }

    const clienteIds = clientes.map((c) => c.id)
    const membership = await tx.membership.findFirst({
      where: { clienteId: { in: clienteIds } },
      select: {
        id: true,
        estado: true,
        planId: true,
        planIdSolicitado: true,
        fechaVencimiento: true,
        plan: { select: { id: true, nombre: true, precio: true, vigenciaDias: true } },
        planSolicitado: { select: { id: true, nombre: true, precio: true } },
      },
      // La más relevante: ACTIVA primero, luego por fecha de vencimiento.
      orderBy: [{ estado: 'asc' }, { fechaVencimiento: 'desc' }],
    })
    return { membership, clienteId: clienteIds[0] }
  })

  // 3. Precio personal vía motor de elegibilidad (NO `planBase.precio`).
  //    Si el cliente tiene membresía en esta empresa, usa modo vitrina para
  //    que pueda ver el plan aunque no tenga vehículo registrado.
  const resultado = await planesElegibles({
    companyId,
    clienteId: relacion.clienteId ?? clienteId ?? '',
    vitrinaSinRequisitos: !!relacion.membership,
  }).catch((e) => {
    console.error('[plan-detalle] elegibilidad', e)
    return null
  })

  // Si el motor falla, caemos al precio base (mejor que no mostrar nada).
  const planElegible = resultado?.planes.find((p) => p.id === planId)
  const precio = planElegible?.decision.precio ?? Number(planBase.precio)

  // 4. Reseñas de la empresa (rating promedio).
  const resenas = await getResenasEmpresa(companyId)

  // 5. Determinar el estado de relación.
  const membership = relacion.membership
  const isActive = membership?.estado === 'ACTIVA'
  const currentPlanPrecio = isActive ? Number(membership?.plan.precio ?? 0) : null
  const isUpgrade =
    isActive && currentPlanPrecio != null && precio > currentPlanPrecio
  const isDowngrade =
    isActive && currentPlanPrecio != null && precio < currentPlanPrecio
  const isSamePlan = isActive && membership?.planId === planId
  const hasPendingChange = isActive && membership?.planIdSolicitado != null
  const pendingPlan = hasPendingChange ? membership?.planSolicitado : null

  // 6. ¿Este plan es de una empresa donde el cliente NO tiene membresía?
  //    En ese caso, no se ofrece "mejorar" — solo la compra normal.
  const hasMembershipInThisCompany = !!membership

  // 7. Desglose del cambio de plan (solo si es mejora y hay membresía ACTIVA).
  //    El cálculo viene SIEMPRE del servidor (prorrateo.ts), nunca del navegador.
  const desgloseCambio =
    isUpgrade && membership
      ? calcularPagoCambioPlan({
          precioNuevo: precio,
          precioVigente: currentPlanPrecio ?? 0,
          fechaVencimiento: membership.fechaVencimiento,
          vigenciaDias: membership.plan.vigenciaDias,
        })
      : null

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Volver al catálogo */}
      <Link
        href="/cliente/planes"
        className="mb-6 inline-flex min-h-11 items-center gap-1.5 text-small text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Volver a planes
      </Link>

      <div className="overflow-hidden rounded-2xl border border-border/80 shadow-premium">
        {/* Imagen del plan */}
        {planBase.imagenUrl && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={planBase.imagenUrl}
            alt=""
            className="aspect-[16/9] w-full max-w-full object-cover"
          />
        )}

        {/* Encabezado con color del plan */}
        <div
          className="p-6 text-white sm:p-8"
          style={{
            background: planBase.color
              ? `linear-gradient(135deg, ${planBase.color}, var(--accent))`
              : 'linear-gradient(135deg, var(--primary), var(--accent))',
          }}
        >
          <div className="flex items-center gap-3">
            {planBase.company.logoUrl && (
              <div className="relative h-10 w-10 overflow-hidden rounded-full bg-white/20">
                <Image
                  src={planBase.company.logoUrl}
                  alt={planBase.company.name}
                  fill
                  className="object-cover"
                />
              </div>
            )}
            <span className="font-semibold">{planBase.company.name}</span>
          </div>
          <h1 className="mt-4 text-h1">{planBase.nombre}</h1>
          <p className="mt-2 text-h1">
            {precio > 0 ? formatMoney(precio, prefs) : 'Gratis'}
            <span className="text-base font-medium opacity-80">
              {' '}
              / {planBase.vigenciaDias} días
            </span>
          </p>
          {/* Rating de la empresa, si existe */}
          {resenas.promedio != null && resenas.total > 0 && (
            <div className="mt-3">
              <RatingStars value={resenas.promedio} total={resenas.total} />
            </div>
          )}
        </div>

        <div className="space-y-6 p-6 sm:p-8">
          {/* ── Bloque de relación ───────────────────────────────────────── */}
          {hasMembershipInThisCompany ? (
            <div className="space-y-4">
              {isSamePlan ? (
                /* Ya tiene ESTE plan */
                <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-brand-primary-soft/50 p-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-primary-soft">
                    <CheckCircle2 className="h-4.5 w-4.5 text-primary" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="text-h4 text-foreground">Ya tienes este plan</p>
                    <p className="mt-0.5 text-small text-muted-foreground">
                      Tu membresía {membership?.plan.nombre} está{' '}
                      {isActive ? 'activa' : `en estado ${membership?.estado?.toLowerCase()}`}.
                    </p>
                  </div>
                </div>
              ) : hasPendingChange ? (
                /* Ya tiene un cambio pendiente */
                <div className="flex items-start gap-3 rounded-lg border border-warning/25 bg-warning/8 p-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning/15">
                    <Clock className="h-4.5 w-4.5 text-warning" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="text-h4 text-foreground">
                      Cambio a {pendingPlan?.nombre} solicitado
                    </p>
                    <p className="mt-0.5 text-small text-muted-foreground">
                      Tu plan actual ({membership?.plan.nombre}) sigue activo. Sube el
                      comprobante del nuevo plan para completar el cambio.
                    </p>
                    <Button asChild size="sm" variant="outline" className="mt-3 rounded-full">
                      <Link href={`/membresia/${membership?.id}`}>
                        Ver detalle de la membresía
                      </Link>
                    </Button>
                  </div>
                </div>
              ) : isUpgrade ? (
                /* Plan mejor → desglose del cambio (precio nuevo, crédito, total) */
                <div className="space-y-4 rounded-lg border border-primary/20 bg-brand-primary-soft/50 p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-primary-soft">
                      <ArrowUpCircle className="h-4.5 w-4.5 text-primary" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-h4 text-foreground">Mejorar tu plan</p>
                      <p className="mt-0.5 text-small text-muted-foreground">
                        Actualmente tienes{' '}
                        <span className="font-medium text-foreground">
                          {membership?.plan.nombre}
                        </span>
                        . Este plan es mejor y incluye más beneficios.
                      </p>
                    </div>
                  </div>

                  {/* Desglose del cambio: precio nuevo, crédito, total */}
                  {desgloseCambio && (
                    <div className="relative overflow-hidden rounded-xl bg-gradient-brand p-4 text-white shadow-glow">
                      <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/10 blur-2xl" aria-hidden />
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm text-white/80">
                          <span>Plan {planBase.nombre}</span>
                          <span>{formatMoney(desgloseCambio.precioNuevo, prefs)}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm font-medium text-white">
                          <span className="inline-flex items-center gap-1.5">
                            <Gift className="h-4 w-4" /> Crédito por tiempo no usado
                          </span>
                          <span>-{formatMoney(desgloseCambio.credito, prefs)}</span>
                        </div>
                        <div className="border-t border-white/20 pt-2">
                          <div className="flex items-end justify-between gap-4">
                            <div>
                              <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-white/80">
                                Total a pagar
                              </p>
                              <p className="mt-0.5 text-3xl font-bold tracking-tight">
                                {formatMoney(desgloseCambio.aPagar, prefs, 2)}
                              </p>
                            </div>
                            <p className="max-w-[40%] truncate text-right text-xs font-medium text-white/80">
                              {planBase.nombre}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* CTA: registra el cambio y lleva a la pantalla de pago existente */}
                  {membership && (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      {desgloseCambio && desgloseCambio.aPagar === 0 ? (
                        <div className="flex-1">
                          <p className="text-small text-muted-foreground">
                            El crédito cubre el plan nuevo. El cambio se aplicará al aprobarse.
                          </p>
                          <UpgradeCtaButton
                            membershipId={membership.id}
                            planId={planId}
                            label="Solicitar cambio"
                          />
                        </div>
                      ) : (
                        <div className="flex-1">
                          <p className="text-small text-muted-foreground">
                            Al solicitar el cambio, podrás subir el comprobante o pagar con tarjeta.
                          </p>
                          <UpgradeCtaButton
                            membershipId={membership.id}
                            planId={planId}
                            label="Solicitar cambio y pagar"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : isDowngrade ? (
                /* Plan peor → informativo, sin acción */
                <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/50 p-4">
                  <div className="min-w-0">
                    <p className="text-h4 text-foreground">
                      Tienes un plan mejor activo
                    </p>
                    <p className="mt-0.5 text-small text-muted-foreground">
                      Actualmente tienes{' '}
                      <span className="font-medium text-foreground">
                        {membership?.plan.nombre}
                      </span>
                      . Este plan tiene menos beneficios.
                    </p>
                  </div>
                </div>
              ) : (
                /* Tiene membresía pero no es este plan (ej. membresía vencida) */
                <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/50 p-4">
                  <div className="min-w-0">
                    <p className="text-h4 text-foreground">
                      Ya tienes una membresía aquí
                    </p>
                    <p className="mt-0.5 text-small text-muted-foreground">
                      Tu membresía{' '}
                      <span className="font-medium text-foreground">
                        {membership?.plan.nombre}
                      </span>{' '}
                      está en estado{' '}
                      <span className="font-medium text-foreground">
                        {membership?.estado?.toLowerCase()}
                      </span>
                      .
                    </p>
                    <Button asChild size="sm" variant="outline" className="mt-3 rounded-full">
                      <Link href={`/membresia/${membership?.id}`}>
                        Ver mi membresía
                      </Link>
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Sin membresía en esta empresa → CTA a la compra */
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild className="flex-1 min-h-12 rounded-full">
                <Link href="/cliente/planes">Elegir este plan</Link>
              </Button>
              <Button asChild variant="outline" className="flex-1 min-h-12 rounded-full">
                <Link href={`/cliente/empresas/${planBase.company.slug}`}>
                  <Store className="mr-2 h-4 w-4" />
                  Ver empresa
                </Link>
              </Button>
            </div>
          )}

          {/* ── Qué incluye ──────────────────────────────────────────────── */}
          <div className="rounded-xl bg-muted p-5">
            <h2 className="mb-3 font-semibold text-foreground">Qué incluye</h2>
            <ul className="space-y-2 text-sm text-foreground">
              <li className="flex items-center gap-2">
                {planBase.esIlimitado ? (
                  <>
                    <InfinityIcon className="h-4 w-4 shrink-0 text-success" />
                    Servicios ilimitados
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                    {planBase.lavadosIncluidos} servicio
                    {planBase.lavadosIncluidos !== 1 ? 's' : ''} incluido
                    {planBase.lavadosIncluidos !== 1 ? 's' : ''}
                  </>
                )}
              </li>
              {planBase.beneficios.map((b) => (
                <li key={b} className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                  {b}
                </li>
              ))}
            </ul>
          </div>

          {/* ── Descripción ──────────────────────────────────────────────── */}
          {planBase.descripcion && (
            <div>
              <h2 className="mb-2 text-h2 text-foreground">Descripción</h2>
              <p className="whitespace-pre-wrap leading-relaxed text-foreground">
                {planBase.descripcion}
              </p>
            </div>
          )}

          {/* ── Condiciones ──────────────────────────────────────────────── */}
          {planBase.condiciones && (
            <div className="rounded-xl border border-border p-4">
              <h3 className="mb-2 font-semibold text-foreground">Condiciones</h3>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {planBase.condiciones}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Pie de página ────────────────────────────────────────────────── */}
      {!hasMembershipInThisCompany && (
        <div className="mt-8 rounded-2xl bg-muted p-6 text-center">
          <p className="text-foreground">
            Al adquirir el plan crearás tu cuenta en {planBase.company.name} y
            activarás tu membresía con QR de acceso.
          </p>
          <Button asChild className="mt-4 min-h-12 rounded-full">
            <Link href="/cliente/planes">Elegir este plan</Link>
          </Button>
        </div>
      )}
    </div>
  )
}

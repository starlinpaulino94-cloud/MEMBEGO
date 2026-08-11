import Link from 'next/link'
import {
  CheckCircle2,
  Clock,
  ArrowRightLeft,
  CreditCard,
  ArrowLeft,
  Sparkles,
  Car,
} from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { conEmpresa } from '@/lib/tenant'
import { safeInternalPath } from '@/lib/utils'
import { planesElegibles } from '@/modules/elegibilidad'
import { Button } from '@/components/ui/button'
import { PlanesGrid, type PlanItem } from '@/components/cliente/PlanesGrid'
import { EmptyState } from '@/components/system/EmptyState'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Planes',
  description: 'Elige o cambia tu plan de membresía',
}

const PENDIENTE_PAGO_ESTADOS = ['PENDIENTE', 'PENDIENTE_PAGO', 'RECHAZADA']

export default async function PlanesPage({
  searchParams,
}: {
  searchParams: Promise<{ vehiculo?: string; retorno?: string }>
}) {
  const user = await requireRole('CLIENTE')
  const { vehiculo: vehiculoParam, retorno: retornoParam } = await searchParams
  // Fase 4: quien viene del mapa conserva el contexto de ubicación (el botón
  // volver de la membresía lo devuelve al detalle de la empresa).
  const retorno = safeInternalPath(retornoParam, '/cliente/empresas')
  const conRetorno = retornoParam != null
  const planesHref = conRetorno ? `/cliente/planes?retorno=${encodeURIComponent(retorno)}` : '/cliente/planes'
  const vehiculoNext = `/cliente/vehiculos/nuevo?next=${encodeURIComponent(planesHref)}`

  if (!user.metadata.clienteId || !user.metadata.companyId) {
    return (
      <main className="container max-w-5xl py-8">
        <p className="text-muted-foreground">Tu cuenta no está completamente configurada.</p>
      </main>
    )
  }
  const clienteId = user.metadata.clienteId
  const companyId = user.metadata.companyId

  let cliente
  try {
    cliente = await conEmpresa(companyId, (tx) =>
      tx.cliente.findUnique({
        where: { id: clienteId },
        select: {
          id: true,
          nombre: true,
          vehiculos: {
            select: { id: true, marca: true, modelo: true },
            orderBy: [{ esPrincipal: 'desc' }, { createdAt: 'desc' }],
          },
          company: {
            select: {
              id: true, name: true, moneda: true, idioma: true,
              bienvenidaActiva: true, bienvenidaTipo: true, bienvenidaValor: true,
            },
          },
          memberships: {
            select: {
              id: true,
              estado: true,
              planId: true,
              planIdSolicitado: true,
              fechaInicio: true,
              plan: { select: { nombre: true, precio: true } },
              planSolicitado: { select: { nombre: true } },
            },
            take: 1,
          },
        },
      })
    )
  } catch (e) {
    console.error('[cliente-planes]', e)
    return (
      <main className="container max-w-5xl py-8">
        <p className="text-muted-foreground">No pudimos cargar tu información. Intenta más tarde.</p>
      </main>
    )
  }

  if (!cliente) {
    return (
      <main className="container max-w-5xl py-8">
        <p className="text-muted-foreground">No se encontró tu información.</p>
      </main>
    )
  }

  const membership = cliente.memberships[0] ?? null

  // ── Motor de elegibilidad: ÚNICA fuente de planes y precios (§9/§10) ───────
  // La respuesta trae solo lo autorizado: planes con el precio de la categoría
  // del vehículo elegido, o vacía si faltan requisitos. REGLA DE
  // COMPATIBILIDAD: quien ya tiene una membresía en la empresa (miembro de
  // antes del rediseño) recibe VITRINA en vez de bloqueo — sigue viendo la
  // oferta como siempre; solo la compra nueva exige vehículo.
  const resultado = await planesElegibles({
    companyId,
    clienteId,
    vehiculoId: vehiculoParam,
    vitrinaSinRequisitos: !!membership,
  }).catch((e) => {
    console.error('[cliente-planes] elegibilidad', e)
    return null
  })

  if (!resultado) {
    return (
      <main className="container max-w-5xl py-8">
        <p className="text-muted-foreground">No pudimos cargar los planes. Intenta más tarde.</p>
      </main>
    )
  }

  const planes: PlanItem[] = resultado.planes.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    precio: p.decision.precio,
    esIlimitado: p.esIlimitado,
    descripcion: p.descripcion,
    lavadosIncluidos: p.lavadosIncluidos,
    beneficios: p.beneficios,
    vigenciaDias: p.vigenciaDias,
    condiciones: p.condiciones,
    comprable: p.decision.puedeComprar,
    nivelSuperior: !p.decision.puedeComprar,
    precioDeCategoria: p.decision.precioOrigen === 'CATEGORIA',
  }))

  const isActive = membership?.estado === 'ACTIVA'
  const elegibleBienvenida = !membership || membership.fechaInicio == null
  const bienvenida =
    elegibleBienvenida &&
    cliente.company.bienvenidaActiva &&
    cliente.company.bienvenidaValor != null
      ? {
          tipo: cliente.company.bienvenidaTipo,
          valor: Number(cliente.company.bienvenidaValor),
        }
      : null
  const pendingPayment =
    membership && PENDIENTE_PAGO_ESTADOS.includes(membership.estado) ? membership : null
  const pendingChange = isActive && membership?.planIdSolicitado ? membership : null

  // §10: cliente NUEVO sin vehículo → no se enseñan planes; se le lleva al
  // registro de vehículo y vuelve aquí (`next`).
  const faltanRequisitos = !resultado.requisitos.canProceed && !resultado.vitrina

  return (
    <main className="container max-w-5xl py-8">
      {/* ── Cabecera integrada y limpia (adiós al banner gigante) ─────────── */}
      <header className="animate-fade-up mb-8">
        <div className="flex items-start justify-between gap-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-primary">
            Membresías · {cliente.company.name}
          </p>
          <Button asChild variant="ghost" size="sm" className="-mt-1 shrink-0 text-muted-foreground">
            <Link href="/mis-membresias">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Mis membresías
            </Link>
          </Button>
        </div>
        <h1 className="mt-2 max-w-2xl text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
          {cliente.nombre
            ? `Hola ${cliente.nombre.split(' ')[0]}, elige tu plan ideal`
            : 'Elige tu plan ideal'}
        </h1>
        <p className="mt-2 max-w-xl text-muted-foreground">
          Paga menos por lo que ya haces. Aquí tienes cada plan con todos sus
          detalles para decidir con calma.
        </p>
      </header>

      {/* ── Banners de estado ─────────────────────────────────────────────── */}
      <div className="mb-8 space-y-3">
        {pendingPayment && (
          <div className="flex flex-col gap-3 rounded-2xl border border-warning/25 bg-warning/8 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-warning/15">
                <Clock className="h-4.5 w-4.5 text-warning" />
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-foreground">
                  Plan {pendingPayment.plan.nombre} pendiente de pago
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {pendingPayment.estado === 'RECHAZADA'
                    ? 'Tu comprobante fue rechazado. Envía uno nuevo para activarlo.'
                    : 'Sube tu comprobante para que el equipo active tu membresía.'}
                </p>
              </div>
            </div>
            <Button asChild size="sm" className="shrink-0 bg-warning-foreground hover:bg-warning-foreground/90">
              <Link href={`/membresia/${pendingPayment.id}`}>
                <CreditCard className="mr-2 h-4 w-4" /> Completar pago
              </Link>
            </Button>
          </div>
        )}

        {pendingChange && (
          <div className="flex flex-col gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                <ArrowRightLeft className="h-4.5 w-4.5 text-primary" />
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-foreground">
                  Cambio a {pendingChange.planSolicitado?.nombre} solicitado
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Tu plan actual sigue activo. Sube el comprobante del nuevo plan para completar el cambio.
                </p>
              </div>
            </div>
            <Button asChild size="sm" variant="outline" className="shrink-0">
              <Link href={`/membresia/${pendingChange.id}`}>
                <CreditCard className="mr-2 h-4 w-4" /> Subir comprobante
              </Link>
            </Button>
          </div>
        )}

        {/* Miembro de antes del rediseño sin vehículo: puede seguir viendo la
            vitrina, con la invitación (no obligación) a registrar su vehículo
            para precios exactos y compra en línea. Solo donde el vehículo
            significa algo: en un restaurante esta tarjeta no tiene sentido. */}
        {resultado.vitrina && resultado.requiereVehiculo && (
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted">
                <Car className="h-4.5 w-4.5 text-muted-foreground" />
              </span>
              <p className="text-sm text-muted-foreground">
                Registra tu vehículo para ver el precio exacto de tu categoría y comprar en línea.
              </p>
            </div>
            <Button asChild size="sm" variant="outline" className="shrink-0">
              <Link href={vehiculoNext}>Registrar vehículo</Link>
            </Button>
          </div>
        )}
      </div>

      {/* ── Contenido ─────────────────────────────────────────────────────── */}
      {/* EL ORDEN IMPORTA. Primero "¿hay algo que enseñar?" y después "¿puedes
          verlo?". Al revés, una empresa sin un solo plan le exigía al cliente
          registrar su vehículo —un trámite— para llegar a una pantalla vacía. */}
      {resultado.planesPublicados === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="Sin planes disponibles"
          description={`${cliente.company.name} aún no tiene planes de membresía publicados. Vuelve pronto.`}
          action={
            <Button asChild variant="outline">
              <Link href="/mis-membresias">Volver a mis membresías</Link>
            </Button>
          }
        />
      ) : faltanRequisitos ? (
        /* §10: sin vehículo no hay planes ni precios — la consulta ya volvió
           vacía (esto no es CSS). El asistente lo resuelve y regresa aquí. */
        <EmptyState
          icon={Car}
          title="Registra tu vehículo para ver los planes"
          description="Los planes y precios dependen de la categoría de tu vehículo. Regístralo en un minuto y te los mostramos al instante."
          action={
            <Button asChild>
              <Link href={vehiculoNext}>Registrar mi vehículo</Link>
            </Button>
          }
        />
      ) : planes.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="Sin planes disponibles"
          description="Esta empresa aún no tiene planes publicados. Vuelve pronto."
          action={
            <Button asChild variant="outline">
              <Link href="/mis-membresias">Volver a mis membresías</Link>
            </Button>
          }
        />
      ) : (
        <>
          <PlanesGrid
            planes={planes}
            currentPlanId={isActive ? membership!.planId : null}
            requestedPlanId={membership?.planIdSolicitado ?? null}
            hasActive={!!isActive}
            activeMembershipId={membership?.id ?? null}
            currentPlanPrecio={isActive ? Number(membership!.plan.precio) : null}
            prefs={cliente.company}
            bienvenida={bienvenida}
            vehiculos={cliente.vehiculos}
            vehiculoSeleccionadoId={resultado.vehiculo?.id ?? null}
            vitrina={resultado.vitrina}
            retorno={conRetorno ? retorno : undefined}
          />

          {/* Confianza: reduce la fricción de compra sin agregar ruido. */}
          <div className="animate-fade-up delay-500 mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
              Pago verificado por el equipo
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
              Tu QR se activa al aprobarse el pago
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
              Sin contratos ni permanencia
            </span>
          </div>
        </>
      )}
    </main>
  )
}

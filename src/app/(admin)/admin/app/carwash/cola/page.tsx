import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { prisma } from '@/lib/prisma'
import { tieneCapacidad } from '@/modules/capacidades/resolver'
import {
  getColaTablero,
  COLA_ACTIVOS,
  COLA_TRANSICIONES,
  COLA_ACCION_LABELS,
  COLA_ESTADO_LABELS,
  type ColaEstado,
  type ColaEntrada,
} from '@/modules/carwash/cola'
import { hmEnTz, ymdEnTz, utcDesdeLocal } from '@/modules/citas/disponibilidad'
import { ColaRegistrarForm } from '@/components/carwash/ColaRegistrarForm'
import { ColaAcciones } from '@/components/carwash/ColaAcciones'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { ArrowLeft, Camera, ListOrdered } from 'lucide-react'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Cola de vehículos' }

/**
 * App Car Wash · E5 — COLA DE VEHÍCULOS: el estado de la pista en vivo.
 * Tres columnas (en espera / en servicio / listo) + terminados del día.
 * Capacidad COLA_VEHICULOS: nace apagada; se enciende en /superadmin/capacidades.
 */
export default async function ColaPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId as string | undefined
  if (!companyId) {
    return <p className="text-muted-foreground">Tu cuenta no está vinculada a una empresa.</p>
  }

  const volver = (
    <Link
      href="/admin/app/carwash"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" /> Car Wash
    </Link>
  )

  if (!(await tieneCapacidad(companyId, 'COLA_VEHICULOS'))) {
    return (
      <div className="space-y-6">
        {volver}
        <EmptyState
          icon={<ListOrdered className="h-7 w-7" />}
          title="La cola de vehículos está apagada"
          description="Este módulo se activa por empresa desde el panel de capacidades (superadmin)."
        />
      </div>
    )
  }

  const empresa = await prisma.company
    .findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
    .catch(() => null)
  const tz = empresa?.zonaHoraria || 'America/Santo_Domingo'
  const inicioDia = utcDesdeLocal(ymdEnTz(new Date(), tz), '00:00', tz)

  let tablero: Awaited<ReturnType<typeof getColaTablero>> | null = null
  try {
    tablero = await getColaTablero(companyId, inicioDia)
  } catch (e) {
    console.error('[cola] tablero:', e)
  }

  if (!tablero) {
    return (
      <div className="space-y-6">
        {volver}
        <EmptyState
          icon={<ListOrdered className="h-7 w-7" />}
          title="No se pudo cargar la cola"
          description="Si acabas de instalar esta versión, corre la migración 20260759_e5_carwash en la base de datos."
        />
      </div>
    )
  }

  const columnas = COLA_ACTIVOS.map((estado) => ({
    estado,
    label: COLA_ESTADO_LABELS[estado],
    entradas: tablero.activos.filter((e) => e.estado === estado),
  }))

  return (
    <div className="space-y-6">
      {volver}
      <PageHeader
        title="Cola de vehículos"
        description="El estado de la pista en vivo: registra la entrada y avanza cada vehículo hasta la entrega."
      />

      <ColaRegistrarForm />

      <div className="grid gap-4 lg:grid-cols-3">
        {columnas.map((col) => (
          <section key={col.estado} className="rounded-2xl border border-border/70 bg-card p-4">
            <h2 className="mb-3 flex items-center justify-between text-sm font-bold uppercase tracking-wide text-muted-foreground">
              {col.label}
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">
                {col.entradas.length}
              </span>
            </h2>
            {col.entradas.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Sin vehículos.</p>
            ) : (
              <ul className="space-y-3">
                {col.entradas.map((e) => (
                  <TarjetaCola key={e.id} entrada={e} tz={tz} />
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      {tablero.terminadosHoy.length > 0 && (
        <section className="rounded-2xl border border-border/70 bg-card p-4">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Terminados hoy
          </h2>
          <ul className="divide-y divide-border/50">
            {tablero.terminadosHoy.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <span className="font-mono text-xs font-bold uppercase">{e.placa || '—'}</span>{' '}
                  <span className="text-foreground">
                    {e.vehiculo ? `${e.vehiculo.marca} ${e.vehiculo.modelo}` : e.descripcion}
                  </span>
                  {e.cliente && (
                    <span className="text-muted-foreground"> · {e.cliente.nombre}</span>
                  )}
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${
                    e.estado === 'ENTREGADO'
                      ? 'bg-success/15 text-success-foreground'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {COLA_ESTADO_LABELS[e.estado as ColaEstado] ?? e.estado}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function TarjetaCola({ entrada, tz }: { entrada: ColaEntrada; tz: string }) {
  const destinos = (COLA_TRANSICIONES[entrada.estado as ColaEstado] ?? []).map((d) => ({
    estado: d,
    label: COLA_ACCION_LABELS[d] ?? d,
  }))
  return (
    <li className="rounded-xl border border-border/60 bg-background/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-sm font-bold uppercase text-foreground">
            {entrada.placa || '—'}
          </p>
          <p className="truncate text-sm text-foreground">
            {entrada.vehiculo
              ? `${entrada.vehiculo.marca} ${entrada.vehiculo.modelo}`
              : entrada.descripcion}
          </p>
          {entrada.cliente && (
            <Link
              href={`/admin/clientes/${entrada.cliente.id}`}
              className="text-xs text-primary hover:underline"
            >
              {entrada.cliente.nombre}
            </Link>
          )}
          <p className="mt-0.5 text-xs text-muted-foreground">
            Entró {hmEnTz(entrada.createdAt, tz)}
            {entrada.servicio ? ` · ${entrada.servicio}` : ''}
          </p>
          {entrada.notaInterna && (
            <p className="mt-0.5 text-xs italic text-muted-foreground">{entrada.notaInterna}</p>
          )}
        </div>
        {/* Pista (F4): blanco táctil de 44 px. Antes era un chip de 11 px que
            había que apuntar con precisión para tomar una foto. */}
        <Link
          href={`/admin/app/carwash/evidencias?cola=${entrada.id}`}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl bg-muted px-3 text-sm font-semibold text-muted-foreground hover:text-foreground"
          title="Fotos antes/después"
          aria-label={`Fotos de este vehículo (${entrada._count.evidencias})`}
        >
          <Camera className="h-4 w-4" /> {entrada._count.evidencias}
        </Link>
      </div>
      <div className="mt-2">
        <ColaAcciones id={entrada.id} destinos={destinos} />
      </div>
    </li>
  )
}

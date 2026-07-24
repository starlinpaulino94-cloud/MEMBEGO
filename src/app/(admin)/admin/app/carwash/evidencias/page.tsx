import Link from 'next/link'
import Form from 'next/form'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { prisma } from '@/lib/prisma'
import { tieneCapacidad } from '@/modules/capacidades/resolver'
import {
  getEvidencias,
  EVIDENCIA_MOMENTO_LABELS,
  type EvidenciaMomento,
} from '@/modules/carwash/evidencias'
import { EvidenciaForm } from '@/components/carwash/EvidenciaForm'
import { EvidenciaEliminar } from '@/components/carwash/EvidenciaEliminar'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Camera, Search } from 'lucide-react'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Fotos antes/después' }

/**
 * App Car Wash · E5 — EVIDENCIA FOTOGRÁFICA: fotos antes/después por vehículo
 * (control de daños y prueba del trabajo). Con ?cola=<id> las fotos nuevas se
 * ligan a esa entrada de la cola. Capacidad EVIDENCIA_FOTOS (nace apagada).
 */
export default async function EvidenciasPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cola?: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId as string | undefined
  const { q, cola } = await searchParams
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

  if (!(await tieneCapacidad(companyId, 'EVIDENCIA_FOTOS'))) {
    return (
      <div className="space-y-6">
        {volver}
        <EmptyState
          icon={<Camera className="h-7 w-7" />}
          title="Las fotos antes/después están apagadas"
          description="Este módulo se activa por empresa desde el panel de capacidades (superadmin)."
        />
      </div>
    )
  }

  // Contexto de la cola cuando llegan desde una tarjeta de la pista.
  const entradaCola = cola
    ? await prisma.colaVehiculo
        .findFirst({
          where: { id: cola, companyId },
          select: { id: true, placa: true, descripcion: true },
        })
        .catch(() => null)
    : null

  let evidencias: Awaited<ReturnType<typeof getEvidencias>> | null = null
  try {
    evidencias = await getEvidencias(companyId, {
      q,
      colaId: entradaCola?.id,
    })
  } catch (e) {
    console.error('[evidencias] cargar:', e)
  }

  if (!evidencias) {
    return (
      <div className="space-y-6">
        {volver}
        <EmptyState
          icon={<Camera className="h-7 w-7" />}
          title="No se pudieron cargar las fotos"
          description="Si acabas de instalar esta versión, corre la migración 20260759_e5_carwash en la base de datos."
        />
      </div>
    )
  }

  const texto = (q ?? '').trim()

  return (
    <div className="space-y-6">
      {volver}
      <PageHeader
        title="Fotos antes/después"
        description={
          entradaCola
            ? `Evidencia de ${entradaCola.placa || entradaCola.descripcion || 'la entrada seleccionada'} — las fotos nuevas quedan ligadas a esta visita.`
            : 'Evidencia y control de daños: fotografía el vehículo al entrar y al entregar.'
        }
      />

      {entradaCola && (
        <Link
          href="/admin/app/carwash/evidencias"
          className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
        >
          ✕ Quitar filtro de esta visita
        </Link>
      )}

      <EvidenciaForm
        colaId={entradaCola?.id}
        placaInicial={entradaCola?.placa ?? undefined}
      />

      {!entradaCola && (
        <Form
          action="/admin/app/carwash/evidencias"
          className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/70 bg-card p-4"
        >
          <div className="relative min-w-64 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input name="q" defaultValue={texto} placeholder="Buscar por placa o cliente…" className="pl-9" />
          </div>
          <Button type="submit" variant="secondary">Buscar</Button>
          {texto && (
            <Button asChild variant="ghost">
              <Link href="/admin/app/carwash/evidencias">Limpiar</Link>
            </Button>
          )}
        </Form>
      )}

      {evidencias.length === 0 ? (
        <EmptyState
          icon={<Camera className="h-7 w-7" />}
          title={texto ? 'Sin resultados' : 'Aún no hay fotos'}
          description="Sube la primera con «Nueva foto» — ideal: una al recibir el vehículo y otra al entregarlo."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {evidencias.map((e) => (
            <figure
              key={e.id}
              className="overflow-hidden rounded-2xl border border-border/70 bg-card"
            >
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={e.url} alt={`Evidencia ${e.placa ?? ''}`} className="h-44 w-full object-cover" />
                <span
                  className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase text-white ${
                    e.momento === 'ANTES' ? 'bg-amber-600/90' : 'bg-emerald-600/90'
                  }`}
                >
                  {EVIDENCIA_MOMENTO_LABELS[e.momento as EvidenciaMomento] ?? e.momento}
                </span>
                <span className="absolute right-2 top-2">
                  <EvidenciaEliminar id={e.id} />
                </span>
              </div>
              <figcaption className="space-y-0.5 p-3 text-sm">
                <p className="font-mono text-xs font-bold uppercase text-foreground">
                  {e.placa || '—'}
                </p>
                {e.cliente && (
                  <Link
                    href={`/admin/clientes/${e.cliente.id}`}
                    className="block truncate text-xs text-primary hover:underline"
                  >
                    {e.cliente.nombre}
                  </Link>
                )}
                <p className="text-xs text-muted-foreground">
                  {new Intl.DateTimeFormat('es-DO', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(e.createdAt)}
                  {e.subidaPor ? ` · ${e.subidaPor.name}` : ''}
                </p>
                {e.nota && <p className="text-xs italic text-muted-foreground">{e.nota}</p>}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  )
}

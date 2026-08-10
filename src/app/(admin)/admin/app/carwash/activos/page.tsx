import Link from 'next/link'
import Form from 'next/form'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { prisma } from '@/lib/prisma'
import { tieneCapacidad } from '@/modules/capacidades/resolver'
import { normalizarRango } from '@/modules/apps/reportes'
import { utcDesdeLocal, sumarDias } from '@/modules/citas/disponibilidad'
import { getPanelActivos } from '@/modules/carwash/activos'
import { ActivosPanel } from '@/components/carwash/ActivosPanel'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowLeft, TriangleAlert, Wrench } from 'lucide-react'
import { anotarFallo } from '@/lib/prisma-errors'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Equipos y mantenimiento' }

/**
 * App Car Wash · Fase 3 — EQUIPOS Y MANTENIMIENTO.
 * Capacidad ACTIVOS (nace apagada).
 */
export default async function ActivosPage({
  searchParams,
}: {
  searchParams: Promise<{ editar?: string; desde?: string; hasta?: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId as string | undefined
  const sp = await searchParams
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

  if (!(await tieneCapacidad(companyId, 'ACTIVOS'))) {
    return (
      <div className="space-y-6">
        {volver}
        <EmptyState
          icon={<Wrench className="h-7 w-7" />}
          title="Los equipos están apagados"
          description="Este módulo se activa por empresa desde el panel de capacidades (superadmin)."
        />
      </div>
    )
  }

  const empresa = await prisma.company
    .findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
    .catch(anotarFallo('carwash:activos:company'))
  const tz = empresa?.zonaHoraria || 'America/Santo_Domingo'
  const { rango } = normalizarRango(sp.desde, sp.hasta, tz)
  const inicio = utcDesdeLocal(rango.desde, '00:00', tz)
  const fin = utcDesdeLocal(sumarDias(rango.hasta, 1), '00:00', tz)

  const panel = await getPanelActivos(companyId, inicio, fin)

  return (
    <div className="space-y-6">
      {volver}
      <PageHeader
        title="Equipos y mantenimiento"
        description="Lo que mide este módulo no es el equipo: es la pista parada. Un equipo dañado es capacidad que no se puede vender."
      />

      <Form action="/admin/app/carwash/activos" className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-muted-foreground">
          Desde
          <Input type="date" name="desde" defaultValue={rango.desde} className="mt-1" />
        </label>
        <label className="text-xs text-muted-foreground">
          Hasta
          <Input type="date" name="hasta" defaultValue={rango.hasta} className="mt-1" />
        </label>
        <Button type="submit" variant="secondary">Aplicar</Button>
      </Form>

      {panel === null ? (
        <div className="flex items-start gap-2 rounded-2xl border border-warning/30 bg-warning/10 p-5 text-sm">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div>
            <p className="font-bold text-foreground">Falta correr la migración</p>
            <p className="mt-1 text-muted-foreground">
              La tabla de equipos todavía no existe. Corre{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                prisma/migrations/20260765_carwash_fase3/migration.sql
              </code>{' '}
              en Supabase y vuelve a entrar.
            </p>
          </div>
        </div>
      ) : (
        <ActivosPanel
          panel={panel}
          editando={panel.filas.find((f) => f.id === sp.editar) ?? null}
        />
      )}
    </div>
  )
}

import Link from 'next/link'
import Form from 'next/form'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { prisma } from '@/lib/prisma'
import { tieneCapacidad } from '@/modules/capacidades/resolver'
import { normalizarRango } from '@/modules/apps/reportes'
import { utcDesdeLocal, sumarDias } from '@/modules/citas/disponibilidad'
import { getPanelTurnos } from '@/modules/carwash/turnos'
import { TurnosPanel } from '@/components/carwash/TurnosPanel'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowLeft, Clock, TriangleAlert } from 'lucide-react'
import { anotarFallo } from '@/lib/prisma-errors'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Turnos y asistencia' }

/**
 * App Car Wash · Fase 3 — TURNOS Y ASISTENCIA.
 * Capacidad TURNOS (nace apagada).
 */
export default async function TurnosPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>
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

  if (!(await tieneCapacidad(companyId, 'TURNOS'))) {
    return (
      <div className="space-y-6">
        {volver}
        <EmptyState
          icon={<Clock className="h-7 w-7" />}
          title="Los turnos están apagados"
          description="Este módulo se activa por empresa desde el panel de capacidades (superadmin)."
        />
      </div>
    )
  }

  const empresa = await prisma.company
    .findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
    .catch(anotarFallo('carwash:turnos:company'))
  const tz = empresa?.zonaHoraria || 'America/Santo_Domingo'
  const { rango } = normalizarRango(sp.desde, sp.hasta, tz)
  const inicio = utcDesdeLocal(rango.desde, '00:00', tz)
  const fin = utcDesdeLocal(sumarDias(rango.hasta, 1), '00:00', tz)

  const panel = await getPanelTurnos(companyId, inicio, fin)

  return (
    <div className="space-y-6">
      {volver}
      <PageHeader
        title="Turnos y asistencia"
        description="Quién trabajó y cuánto. Cruzado con los vehículos entregados da el costo laboral por lavado — el número que dice si el precio de lista tiene sentido."
      />

      <Form action="/admin/app/carwash/turnos" className="flex flex-wrap items-end gap-3">
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
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning-foreground" />
          <div>
            <p className="font-bold text-foreground">Falta correr la migración</p>
            <p className="mt-1 text-muted-foreground">
              La tabla de turnos todavía no existe. Corre{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                prisma/migrations/20260765_carwash_fase3/migration.sql
              </code>{' '}
              en Supabase y vuelve a entrar.
            </p>
          </div>
        </div>
      ) : (
        <TurnosPanel panel={panel} />
      )}
    </div>
  )
}

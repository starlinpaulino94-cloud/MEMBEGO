import Link from 'next/link'
import Form from 'next/form'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { prisma } from '@/lib/prisma'
import { tieneCapacidad } from '@/modules/capacidades/resolver'
import { normalizarRango } from '@/modules/apps/reportes'
import { utcDesdeLocal, sumarDias } from '@/modules/citas/disponibilidad'
import { getPanelComisiones } from '@/modules/carwash/comisiones'
import { ComisionesPanel, type ServicioTarifa } from '@/components/carwash/ComisionesPanel'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowLeft, TriangleAlert, Wallet } from 'lucide-react'
import { anotarFallo } from '@/lib/prisma-errors'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Comisiones' }

/**
 * App Car Wash · Fase 2 — COMISIONES POR LAVADOR.
 * Capacidad COMISIONES (nace apagada y devenga cero hasta llenar tarifas).
 */
export default async function ComisionesPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId as string | undefined
  const { desde, hasta } = await searchParams
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

  if (!(await tieneCapacidad(companyId, 'COMISIONES'))) {
    return (
      <div className="space-y-6">
        {volver}
        <EmptyState
          icon={<Wallet className="h-7 w-7" />}
          title="Las comisiones están apagadas"
          description="Este módulo se activa por empresa desde el panel de capacidades (superadmin)."
        />
      </div>
    )
  }

  const empresa = await prisma.company
    .findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
    .catch(anotarFallo('carwash:comisiones:company'))
  const tz = empresa?.zonaHoraria || 'America/Santo_Domingo'
  const { rango } = normalizarRango(desde, hasta, tz)
  // El rango se convierte a UTC desde la zona del negocio: si se usara la del
  // servidor, un turno de la noche caería en el día equivocado.
  const inicio = utcDesdeLocal(rango.desde, '00:00', tz)
  const fin = utcDesdeLocal(sumarDias(rango.hasta, 1), '00:00', tz)

  const [panel, servicios] = await Promise.all([
    getPanelComisiones(companyId, inicio, fin),
    prisma.servicio
      .findMany({
        where: { companyId, activo: true },
        orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
        select: { id: true, nombre: true, comisionPorcentaje: true, comisionMonto: true },
      })
      .catch(() => []),
  ])

  const tarifas: ServicioTarifa[] = servicios.map((s) => ({
    id: s.id,
    nombre: s.nombre,
    comisionPorcentaje: s.comisionPorcentaje == null ? null : Number(s.comisionPorcentaje),
    comisionMonto: s.comisionMonto == null ? null : Number(s.comisionMonto),
  }))

  return (
    <div className="space-y-6">
      {volver}
      <PageHeader
        title="Comisiones"
        description="Lo que se le debe a cada lavador. Se devenga al ENTREGAR el vehículo y se congela: cambiar una tarifa después no reescribe lo ya trabajado."
      />

      <Form action="/admin/app/carwash/comisiones" className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-muted-foreground">
          Desde
          <Input type="date" name="desde" defaultValue={rango.desde} className="mt-1" />
        </label>
        <label className="text-xs text-muted-foreground">
          Hasta
          <Input type="date" name="hasta" defaultValue={rango.hasta} className="mt-1" />
        </label>
        <Button type="submit" variant="secondary">
          Aplicar
        </Button>
      </Form>

      {panel === null ? (
        <div className="flex items-start gap-2 rounded-2xl border border-warning/30 bg-warning/10 p-5 text-sm">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning-foreground" />
          <div>
            <p className="font-bold text-foreground">Falta correr la migración</p>
            <p className="mt-1 text-muted-foreground">
              La tabla de comisiones todavía no existe. Corre{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                prisma/migrations/20260764_carwash_fase2/migration.sql
              </code>{' '}
              en Supabase y vuelve a entrar.
            </p>
          </div>
        </div>
      ) : (
        <ComisionesPanel panel={panel} servicios={tarifas} />
      )}
    </div>
  )
}

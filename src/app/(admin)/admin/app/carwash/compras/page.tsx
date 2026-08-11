import Link from 'next/link'
import { conEmpresaOTodas } from '@/lib/tenant'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { tieneCapacidad } from '@/modules/capacidades/resolver'
import { normalizarRango } from '@/modules/apps/reportes'
import { utcDesdeLocal, sumarDias } from '@/modules/citas/disponibilidad'
import { getPanelCompras, getProveedores } from '@/modules/carwash/compras'
import { ComprasPanel } from '@/components/carwash/ComprasPanel'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { ArrowLeft, ShoppingCart, TriangleAlert } from 'lucide-react'
import { anotarFallo } from '@/lib/prisma-errors'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Compras' }

/**
 * App Car Wash · Fase 3 — PROVEEDORES Y ÓRDENES DE COMPRA.
 * Capacidad COMPRAS (nace apagada).
 */
export default async function ComprasPage({
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

  if (!(await tieneCapacidad(companyId, 'COMPRAS'))) {
    return (
      <div className="space-y-6">
        {volver}
        <EmptyState
          icon={<ShoppingCart className="h-7 w-7" />}
          title="Las compras están apagadas"
          description="Este módulo se activa por empresa desde el panel de capacidades (superadmin)."
        />
      </div>
    )
  }

  const empresa = await conEmpresaOTodas(
    companyId,
    'app · carwash · compras: sin empresa activa es el superadmin',
    (tx) => tx.company
      .findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
      .catch(anotarFallo('carwash:compras:company'))
  )
  const tz = empresa?.zonaHoraria || 'America/Santo_Domingo'
  const { rango } = normalizarRango(sp.desde, sp.hasta, tz)
  const inicio = utcDesdeLocal(rango.desde, '00:00', tz)
  const fin = utcDesdeLocal(sumarDias(rango.hasta, 1), '00:00', tz)

  const [panel, proveedores] = await Promise.all([
    getPanelCompras(companyId, inicio, fin),
    getProveedores(companyId),
  ])

  return (
    <div className="space-y-6">
      {volver}
      <PageHeader
        title="Compras"
        description="A quién se le compra y qué viene en camino. Recibir una orden es lo único que suma stock al inventario."
      />

      {panel === null || proveedores === null ? (
        <div className="flex items-start gap-2 rounded-2xl border border-warning/30 bg-warning/10 p-5 text-sm">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div>
            <p className="font-bold text-foreground">Falta correr la migración</p>
            <p className="mt-1 text-muted-foreground">
              Las tablas de compras todavía no existen. Corre{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                prisma/migrations/20260765_carwash_fase3/migration.sql
              </code>{' '}
              en Supabase y vuelve a entrar.
            </p>
          </div>
        </div>
      ) : (
        <ComprasPanel
          panel={panel}
          proveedores={proveedores}
          editando={proveedores.find((p) => p.id === sp.editar) ?? null}
        />
      )}
    </div>
  )
}

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { prisma } from '@/lib/prisma'
import { tieneCapacidad } from '@/modules/capacidades/resolver'
import { getOrdenDetalle } from '@/modules/carwash/compras'
import { OrdenDetalle, type ProductoOpcion } from '@/components/carwash/OrdenDetalle'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { ArrowLeft, ShoppingCart } from 'lucide-react'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Orden de compra' }

/** App Car Wash · Fase 3 — detalle de una orden de compra. */
export default async function OrdenPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId as string | undefined
  const { id } = await params
  if (!companyId) {
    return <p className="text-muted-foreground">Tu cuenta no está vinculada a una empresa.</p>
  }

  const volver = (
    <Link
      href="/admin/app/carwash/compras"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" /> Compras
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

  // getOrdenDetalle filtra por companyId: una orden de otra empresa da 404.
  const orden = await getOrdenDetalle(companyId, id)
  if (!orden) notFound()

  const productos = await prisma.productoInventario
    .findMany({
      where: { companyId, activo: true },
      orderBy: { nombre: 'asc' },
      select: { id: true, nombre: true, unidad: true, costo: true },
    })
    .catch(() => [])

  const opciones: ProductoOpcion[] = productos.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    unidad: p.unidad,
    costo: p.costo == null ? null : Number(p.costo),
  }))

  return (
    <div className="space-y-6">
      {volver}
      <PageHeader
        title={`Orden ${orden.numero}`}
        description={`${orden.proveedor.nombre}${orden.recibidaAt ? ' · recibida' : orden.pedidaAt ? ' · en camino' : ' · borrador'}`}
      />
      <OrdenDetalle orden={orden} productos={opciones} />
    </div>
  )
}

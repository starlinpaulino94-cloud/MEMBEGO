import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { puedeFuncion, requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { OrdenCompraForm } from '@/components/inventario/OrdenCompraForm'
import { fechaPrevistaATexto } from '@/modules/inventory/compras'
import { ordenDetalleEnTx, proveedoresActivosEnTx } from '@/modules/inventory/compras-queries'
import { sucursalesActivasEnTx } from '@/modules/inventory/queries'
import { nombreCompleto } from '@/modules/inventory/formato'
import { describirFalloDeCarga } from '@/modules/inventory/errores-pantalla'

export const dynamic = 'force-dynamic'

export default async function EditarOrdenCompraPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const { id } = await params
  const puedeComprar = await puedeFuncion('inventario', 'comprar')
  if (!puedeComprar) {
    return (
      <Alert>
        <AlertDescription>No tienes permiso para editar órdenes de compra.</AlertDescription>
      </Alert>
    )
  }

  let datos: {
    orden: Awaited<ReturnType<typeof ordenDetalleEnTx>>
    proveedores: Awaited<ReturnType<typeof proveedoresActivosEnTx>>
    sucursales: Awaited<ReturnType<typeof sucursalesActivasEnTx>>
  } | null = null
  let fallo = ''
  try {
    datos = await conEmpresa(companyId, async (tx) => ({
      orden: await ordenDetalleEnTx(tx, companyId, id),
      proveedores: await proveedoresActivosEnTx(tx, companyId),
      sucursales: await sucursalesActivasEnTx(tx, companyId),
    }))
  } catch (e) {
    fallo = describirFalloDeCarga('admin-inventario-compra-editar', e)
  }
  if (fallo) {
    return (
      <Alert>
        <AlertDescription>{fallo}</AlertDescription>
      </Alert>
    )
  }
  // «No existe» y «es de otra empresa» se ven igual a propósito.
  if (!datos?.orden) notFound()
  const { orden: o, proveedores, sucursales } = datos

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link href={`/admin/inventario/compras/${o.id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" aria-hidden />
            {o.numero}
          </Link>
        }
        title={`Editar ${o.numero}`}
        description="Solo un borrador se edita. Al guardar, el contenido nuevo reemplaza al anterior."
      />
      {o.estado !== 'DRAFT' ? (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            {o.estado === 'CANCELLED' ? 'Esta orden está cancelada' : o.estado === 'RECEIVED' ? 'Esta orden ya está recibida' : 'Esta orden ya se pidió'}: no se edita.
            <Button asChild size="sm" variant="outline">
              <Link href={`/admin/inventario/compras/${o.id}`}>Ver la orden</Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : proveedores.length === 0 || sucursales.length === 0 ? (
        <Alert>
          <AlertDescription>Para editar la orden hace falta al menos un proveedor activo y una sucursal activa.</AlertDescription>
        </Alert>
      ) : (
        <OrdenCompraForm
          proveedores={proveedores}
          sucursales={sucursales}
          inicial={{
            ordenId: o.id,
            proveedorId: o.proveedorId,
            sucursalId: o.sucursalId,
            referencia: o.referencia ?? '',
            nota: o.nota ?? '',
            fechaPrevista: fechaPrevistaATexto(o.previstaEn),
            lineas: o.detalle.map((l) => ({ varianteId: l.varianteId, nombre: nombreCompleto(l.itemNombre, l.nombreVariante, l.esDefault), sku: l.sku, cantidad: String(l.pedido), costo: l.costoCampo })),
          }}
        />
      )}
    </div>
  )
}

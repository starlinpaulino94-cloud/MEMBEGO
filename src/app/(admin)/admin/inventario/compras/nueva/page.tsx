import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { puedeFuncion, requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { OrdenCompraForm } from '@/components/inventario/OrdenCompraForm'
import { proveedoresActivosEnTx } from '@/modules/inventory/compras-queries'
import { sucursalesActivasEnTx } from '@/modules/inventory/queries'
import { describirFalloDeCarga } from '@/modules/inventory/errores-pantalla'

export const dynamic = 'force-dynamic'

export default async function NuevaOrdenCompraPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const puedeComprar = await puedeFuncion('inventario', 'comprar')

  let datos: { proveedores: Awaited<ReturnType<typeof proveedoresActivosEnTx>>; sucursales: Awaited<ReturnType<typeof sucursalesActivasEnTx>> } | null = null
  let fallo = ''
  if (puedeComprar) {
    try {
      datos = await conEmpresa(companyId, async (tx) => ({ proveedores: await proveedoresActivosEnTx(tx, companyId), sucursales: await sucursalesActivasEnTx(tx, companyId) }))
    } catch (e) {
      fallo = describirFalloDeCarga('admin-inventario-compra-nueva', e)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link href="/admin/inventario/compras" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" aria-hidden />
            Compras
          </Link>
        }
        title="Nueva orden de compra"
        description="Lo que le vas a pedir a un proveedor, cuánto y a qué costo. Un borrador no mueve el inventario: eso pasa cuando llega la mercancía."
      />
      {fallo ? (
        <Alert>
          <AlertDescription>{fallo}</AlertDescription>
        </Alert>
      ) : !puedeComprar ? (
        <Alert>
          <AlertDescription>No tienes permiso para hacer órdenes de compra.</AlertDescription>
        </Alert>
      ) : !datos || datos.proveedores.length === 0 ? (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            Para hacer una orden primero registra a tu proveedor.
            <Button asChild size="sm" variant="outline">
              <Link href="/admin/inventario/proveedores">Ir a proveedores</Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : datos.sucursales.length === 0 ? (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            Necesitas al menos una sucursal activa para recibir la mercancía.
            <Button asChild size="sm" variant="outline">
              <Link href="/admin/sucursales">Ir a sucursales</Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <OrdenCompraForm proveedores={datos.proveedores} sucursales={datos.sucursales} />
      )}
    </div>
  )
}

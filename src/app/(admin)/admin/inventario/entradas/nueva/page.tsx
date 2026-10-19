import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { puedeFuncion, requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { EntradaMultipleForm } from '@/components/inventario/EntradaMultipleForm'
import { sucursalesActivasEnTx } from '@/modules/inventory/queries'
import { describirFalloDeCarga } from '@/modules/inventory/errores-pantalla'

export const dynamic = 'force-dynamic'

export default async function NuevaEntradaInventarioPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const [puedeAjustar, puedeCostos] = await Promise.all([puedeFuncion('inventario', 'ajustar'), puedeFuncion('inventario', 'costos')])

  let sucursales: Awaited<ReturnType<typeof sucursalesActivasEnTx>> | null = null
  let fallo = ''
  try {
    sucursales = await conEmpresa(companyId, (tx) => sucursalesActivasEnTx(tx, companyId))
  } catch (e) {
    fallo = describirFalloDeCarga('admin-inventario-entrada-nueva', e)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link href="/admin/inventario/entradas" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" aria-hidden />
            Entradas
          </Link>
        }
        title="Nueva entrada de mercancía"
        description="Registra juntos todos los productos de una factura. Escanea el código de barras de cada uno y ajusta la cantidad."
      />
      {fallo ? (
        <Alert>
          <AlertDescription>{fallo}</AlertDescription>
        </Alert>
      ) : !puedeAjustar ? (
        <Alert>
          <AlertDescription>No tienes permiso para registrar entradas de mercancía.</AlertDescription>
        </Alert>
      ) : !sucursales || sucursales.length === 0 ? (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            Para recibir mercancía necesitas al menos una sucursal activa.
            <Button asChild size="sm" variant="outline">
              <Link href="/admin/sucursales">Ir a sucursales</Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <EntradaMultipleForm sucursales={sucursales} conCostos={puedeCostos} />
      )}
    </div>
  )
}

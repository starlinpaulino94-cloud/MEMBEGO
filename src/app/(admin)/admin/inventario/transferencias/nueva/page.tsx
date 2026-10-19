import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { puedeFuncion, requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { EnviarTransferenciaForm } from '@/components/inventario/EnviarTransferenciaForm'
import { sucursalesActivasEnTx } from '@/modules/inventory/queries'
import { describirFalloDeCarga } from '@/modules/inventory/errores-pantalla'

export const dynamic = 'force-dynamic'

export default async function NuevaTransferenciaInventarioPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const puedeTransferir = await puedeFuncion('inventario', 'transferir')

  let sucursales: Awaited<ReturnType<typeof sucursalesActivasEnTx>> | null = null
  let fallo = ''
  try {
    sucursales = await conEmpresa(companyId, (tx) => sucursalesActivasEnTx(tx, companyId))
  } catch (e) {
    fallo = describirFalloDeCarga('admin-inventario-transferencia-nueva', e)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link href="/admin/inventario/transferencias" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" aria-hidden />
            Transferencias
          </Link>
        }
        title="Nueva transferencia con envío"
        description="Manda mercancía a otra sucursal. Sale del origen ahora y queda en camino hasta que el destino la reciba."
      />
      {fallo ? (
        <Alert>
          <AlertDescription>{fallo}</AlertDescription>
        </Alert>
      ) : !puedeTransferir ? (
        <Alert>
          <AlertDescription>No tienes permiso para transferir mercancía entre sucursales.</AlertDescription>
        </Alert>
      ) : !sucursales || sucursales.length < 2 ? (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            Para transferir necesitas al menos dos sucursales activas.
            <Button asChild size="sm" variant="outline">
              <Link href="/admin/sucursales">Ir a sucursales</Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <EnviarTransferenciaForm sucursales={sucursales} />
      )}
    </div>
  )
}

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { puedeFuncion, requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { PageHeader } from '@/components/ui/page-header'
import { ImportarConteoForm } from '@/components/inventario/ImportarConteoForm'
import { conteoDetalleEnTx } from '@/modules/inventory/queries'
import { describirFalloDeCarga } from '@/modules/inventory/errores-pantalla'

export const dynamic = 'force-dynamic'

export default async function ImportarConteoInventarioPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const { id } = await params
  const puedeAjustar = await puedeFuncion('inventario', 'ajustar')

  let conteo: Awaited<ReturnType<typeof conteoDetalleEnTx>> = null
  let fallo = ''
  try {
    // A ciegas: esta pantalla no necesita (ni recibe) lo que decía el sistema.
    conteo = await conEmpresa(companyId, (tx) => conteoDetalleEnTx(tx, companyId, id, { conEsperado: false }))
  } catch (e) {
    fallo = describirFalloDeCarga('admin-inventario-conteo-importar', e)
  }
  if (fallo) {
    return (
      <Alert>
        <AlertDescription>{fallo}</AlertDescription>
      </Alert>
    )
  }
  if (!conteo) notFound()
  if (conteo.estado !== 'OPEN') redirect(`/admin/inventario/conteos/${conteo.id}`)

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link href={`/admin/inventario/conteos/${conteo.id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" aria-hidden />
            {conteo.numero}
          </Link>
        }
        title={`Importar lo contado en ${conteo.numero}`}
        description={`${conteo.sucursalNombre}. Descarga la hoja en blanco, cuenta en papel o en Excel, llena la columna «contado» y súbela. Se revisa fila por fila antes de cargar nada.`}
      />
      {puedeAjustar ? (
        <ImportarConteoForm conteoId={conteo.id} />
      ) : (
        <Alert>
          <AlertDescription>Cargar lo contado requiere el permiso de ajustar existencias.</AlertDescription>
        </Alert>
      )}
    </div>
  )
}

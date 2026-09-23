import { redirect } from 'next/navigation'
import Link from 'next/link'
import { requireUser } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { conEmpresa } from '@/lib/tenant'
import { PageHeader } from '@/components/ui/page-header'
import { guardiaProveedor } from '@/modules/supply/permisos'
import { EscanerSupply } from '@/components/supply/escaner-supply'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Escáner Membego Supply' }

/**
 * MEMBEGO SUPPLY · escáner del comercio (Fase 14).
 *
 * Separado del escáner de membresías a propósito: lo que se canjea aquí no es
 * un beneficio de la empresa, es una unidad que Membego ya pagó. Mezclarlos en
 * la misma pantalla haría que un empleado confundiera «le di un lavado de su
 * membresía» con «entregué una pizza que Membego compró», que son dos
 * operaciones con consecuencias económicas distintas.
 */
export default async function EscanerSupplyPage() {
  const user = await requireUser()
  const companyId = await requireCompanyContext(user)

  const permitido = await guardiaProveedor(companyId)
  if (!permitido) redirect('/admin/dashboard')

  const sucursales = await conEmpresa(companyId, (tx) =>
    tx.sucursal.findMany({
      where: { companyId, activa: true },
      orderBy: { nombre: 'asc' },
      select: { id: true, nombre: true },
    })
  )

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <PageHeader
        title="Escáner Membego"
        description="Lee el código del cliente, comprueba que es válido y confirma la entrega."
        eyebrow={
          <Link href="/admin/supply" className="hover:underline">
            Membego Supply
          </Link>
        }
      />
      <EscanerSupply companyId={companyId} sucursales={sucursales} />
    </div>
  )
}

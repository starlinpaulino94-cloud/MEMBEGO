import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { vendedoresParaSupervisor } from '@/modules/excursiones/vendedores/queries'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { VendedorWizard } from '@/components/excursiones/VendedorWizard'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Nuevo vendedor' }

export default async function NuevoVendedorPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="los vendedores de excursiones" />

  const supervisores = await vendedoresParaSupervisor(companyId)

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link
        href="/admin/excursiones/vendedores"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Vendedores
      </Link>
      <h2 className="text-h2 text-foreground">Nuevo vendedor</h2>
      <VendedorWizard supervisores={supervisores} />
    </div>
  )
}

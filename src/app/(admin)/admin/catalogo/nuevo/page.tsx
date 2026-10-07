import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { PageHeader } from '@/components/ui/page-header'
import { ItemNuevoForm } from '@/components/catalogo/ItemNuevoForm'

export const dynamic = 'force-dynamic'

export default async function NuevoItemPage() {
  const user = await requireRole(ADMIN_ROLES)
  await requireCompanyContext(user)
  return (
    <div className="space-y-6">
      <PageHeader
        title="Nuevo producto o servicio"
        description="Empieza con lo básico. Las variantes (tallas, tamaños), las fotos y las categorías se agregan después."
      />
      <ItemNuevoForm />
    </div>
  )
}

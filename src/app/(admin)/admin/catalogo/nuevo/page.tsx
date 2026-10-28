import Link from 'next/link'
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
    <div className="mx-auto w-full max-w-[720px] space-y-6">
      <PageHeader
        variant="formulario"
        className="mb-0 sm:mb-0"
        back={
          <Link href="/admin/catalogo" className="text-muted-foreground hover:text-foreground">
            ‹ Catálogo
          </Link>
        }
        title="Nuevo producto o servicio"
        description="Empieza con lo básico. Las variantes (tallas, tamaños), las fotos y las categorías se agregan después."
      />
      <ItemNuevoForm />
    </div>
  )
}

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { getGrowthAdminData, getGrowthRule } from '@/modules/growth/queries'
import { PageHeader } from '@/components/ui/page-header'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { ReglaRecompensaForm } from '@/components/growth/ReglaRecompensaForm'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Editar regla de recompensa' }

export default async function EditarReglaPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await resolveCompanyId(user)
  if (!companyId) return <SinEmpresaActiva seccion="tus reglas de recompensa" />

  const { id } = await params
  // La consulta filtra por empresa: una regla de otra empresa es un 404, no un
  // formulario que se pueda guardar.
  const [regla, { promos, plans }] = await Promise.all([
    getGrowthRule(companyId, id),
    getGrowthAdminData(companyId),
  ])
  if (!regla) notFound()

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-6">
      <PageHeader
        variant="formulario"
        className="mb-0 sm:mb-0"
        back={
          <Link href="/admin/crecimiento/recompensas" className="text-muted-foreground hover:text-foreground">
            ‹ Reglas de recompensa
          </Link>
        }
        title={regla.nombre}
        description="Los cambios aplican a las recompensas que se entreguen a partir de ahora; lo ya entregado no se toca."
      />

      <ReglaRecompensaForm promos={promos} plans={plans} regla={regla} />
    </div>
  )
}

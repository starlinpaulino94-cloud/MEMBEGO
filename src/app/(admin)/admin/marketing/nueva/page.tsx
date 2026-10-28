import { requireRole } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { ADMIN_ROLES } from '@/types'
import { PageHeader } from '@/components/ui/page-header'
import { MarketingCampaignForm } from '@/components/engagement/MarketingCampaignForm'
import { getDealsParaMarketing } from '@/modules/engagement/campanas'
import Link from 'next/link'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Nueva campaña de marketing' }

export default async function NuevaCampanaMarketingPage() {
  const user = await requireRole(ADMIN_ROLES)
  // Hace falta para construir la ruta del banner: la empresa va en el primer
  // segmento y es lo que comprueba la política de storage. Puede ser null si
  // un superadmin entra sin empresa activa; entonces el formulario deshabilita
  // la subida en vez de escribir en una ruta sin dueño.
  const companyId = await resolveCompanyId(user)
  const deals = companyId ? await getDealsParaMarketing(companyId) : []
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <PageHeader
        className="mb-0 sm:mb-0"
        back={
          <Link href="/admin/marketing" className="text-muted-foreground hover:text-foreground">
            ‹ Campañas de Marketing
          </Link>
        }
        title="Nueva campaña"
        description="Diseña una oferta con contador que aparecerá viva en el inicio de tus clientes."
      />
      <MarketingCampaignForm companyId={companyId} deals={deals} />
    </div>
  )
}

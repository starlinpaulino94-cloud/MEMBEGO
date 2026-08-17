import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { getCampanaMarketing } from '@/modules/engagement/campanas'
import { PageHeader } from '@/components/ui/page-header'
import {
  MarketingCampaignForm,
  type MarketingExisting,
} from '@/components/engagement/MarketingCampaignForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Editar campaña de marketing' }

export default async function EditarCampanaMarketingPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await resolveCompanyId(user)
  if (!companyId) notFound()

  const c = await getCampanaMarketing(id, companyId)
  if (!c) notFound()

  const existing: MarketingExisting = {
    id: c.id,
    tipo: c.tipo,
    titulo: c.titulo,
    descripcion: c.descripcion,
    bannerUrl: c.bannerUrl,
    imagenUrl: c.imagenUrl,
    ctaTexto: c.ctaTexto,
    ctaHref: c.ctaHref,
    colorPrimario: c.colorPrimario,
    colorSecundario: c.colorSecundario,
    fechaInicio: c.fechaInicio.toISOString(),
    fechaFin: c.fechaFin.toISOString(),
    horaInicioMin: c.horaInicioMin,
    horaFinMin: c.horaFinMin,
    diasSemana: c.diasSemana,
    prioridad: c.prioridad,
    destacada: c.destacada,
    maxReclamos: c.maxReclamos,
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Editar campaña" description="Ajusta tu oferta y su ventana de tiempo." />
      <MarketingCampaignForm existing={existing} companyId={companyId} />
    </div>
  )
}

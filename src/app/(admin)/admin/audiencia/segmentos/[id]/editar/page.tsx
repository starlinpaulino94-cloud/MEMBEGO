import { notFound } from 'next/navigation'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { SegmentoServicio } from '@/modules/geo/segmentacion/segmentos'
import { opcionesConstructor } from '@/modules/geo/segmentacion/catalogos'
import SegmentoBuilder from '@/components/audiencia/SegmentoBuilder'
import { PageHeader } from '@/components/ui/page-header'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export default async function EditarSegmentoPage({ params }: Props) {
  const { id } = await params
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="el constructor de segmentos" />

  const [segmento, opciones] = await Promise.all([
    SegmentoServicio.obtener(companyId, id),
    opcionesConstructor(companyId),
  ])
  if (!segmento) notFound()

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Editar · ${segmento.nombre}`}
        description="Cambia las condiciones y vuelve a estimar la audiencia."
      />
      <SegmentoBuilder
        segmentoId={segmento.id}
        initial={segmento.raiz}
        initialNombre={segmento.nombre}
        initialDescripcion={segmento.descripcion ?? ''}
        opciones={opciones}
      />
    </div>
  )
}

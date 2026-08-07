import { notFound } from 'next/navigation'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { CampanaDirigidaService } from '@/modules/geo/segmentacion/campanas'
import { SegmentoServicio } from '@/modules/geo/segmentacion/segmentos'
import { opcionesConstructor } from '@/modules/geo/segmentacion/catalogos'
import CampanaForm from '@/components/audiencia/CampanaForm'
import { PageHeader } from '@/components/ui/page-header'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export default async function EditarCampanaPage({ params }: Props) {
  const { id } = await params
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="las campañas dirigidas" />

  const [campana, segmentos, opciones] = await Promise.all([
    CampanaDirigidaService.obtener(companyId, id),
    SegmentoServicio.listar(companyId),
    opcionesConstructor(companyId),
  ])
  if (!campana) notFound()
  if (campana.estado !== 'BORRADOR') notFound()

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Editar · ${campana.nombre}`}
        description="Solo se edita una campaña en borrador. Una vez programada o activada, los cambios se hacen en una nueva versión."
      />
      <CampanaForm
        campanaId={campana.id}
        segmentos={segmentos
          .filter((s) => s.estado !== 'ARCHIVADO')
          .map((s) => ({ id: s.id, nombre: s.nombre }))}
        sucursales={opciones.sucursales.map((s) => ({
          id: s.id,
          nombre: s.label,
          radioServicioKm: s.radioServicioKm,
        }))}
        initial={{
          nombre: campana.nombre,
          mensaje: campana.mensaje,
          canales: campana.canales,
          programadaEn: campana.programadaEn
            ? new Date(campana.programadaEn.getTime() - campana.programadaEn.getTimezoneOffset() * 60000)
                .toISOString()
                .slice(0, 16)
            : null,
          maxPorDia: campana.maxPorDia,
          maxPorSemana: campana.maxPorSemana,
          prioridad: campana.prioridad,
          segmentoId: campana.segmentId,
          sucursalId: campana.sucursalId,
          radioKm: campana.radioKm,
        }}
      />
    </div>
  )
}

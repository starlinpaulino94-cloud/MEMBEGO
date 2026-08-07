import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { SegmentoServicio } from '@/modules/geo/segmentacion/segmentos'
import { opcionesConstructor } from '@/modules/geo/segmentacion/catalogos'
import CampanaForm from '@/components/audiencia/CampanaForm'
import { PageHeader } from '@/components/ui/page-header'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'

export const dynamic = 'force-dynamic'

export default async function NuevaCampanaPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="las campañas dirigidas" />

  const [segmentos, opciones] = await Promise.all([
    SegmentoServicio.listar(companyId),
    opcionesConstructor(companyId),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nueva campaña dirigida"
        description="Define la audiencia (segmento guardado o radio de sucursal), el mensaje y la frecuencia."
      />
      <CampanaForm
        segmentos={segmentos
          .filter((s) => s.estado !== 'ARCHIVADO')
          .map((s) => ({ id: s.id, nombre: s.nombre }))}
        sucursales={opciones.sucursales.map((s) => ({
          id: s.id,
          nombre: s.label,
          radioServicioKm: s.radioServicioKm,
        }))}
      />
    </div>
  )
}

import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { opcionesConstructor } from '@/modules/geo/segmentacion/catalogos'
import SegmentoBuilder from '@/components/audiencia/SegmentoBuilder'
import { PageHeader } from '@/components/ui/page-header'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function NuevoSegmentoPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="el constructor de segmentos" />

  const opciones = await opcionesConstructor(companyId)

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <PageHeader
        className="mb-0 sm:mb-0"
        back={
          <Link href="/admin/audiencia/segmentos" className="text-muted-foreground hover:text-foreground">
            ‹ Segmentos
          </Link>
        }
        title="Nuevo segmento"
        description="Arma la audiencia con condiciones reales: ciudad, sector, radio, membresía, vehículo y más."
      />
      <SegmentoBuilder opciones={opciones} />
    </div>
  )
}

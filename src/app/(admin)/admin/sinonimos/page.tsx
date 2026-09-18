import { redirect } from 'next/navigation'
import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { PageHeader } from '@/components/ui/page-header'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { SinonimosPanel } from '@/components/busqueda/SinonimosPanel'
import { listarSinonimos } from '@/modules/busqueda/sinonimos'
import { eliminarSinonimoEmpresa, guardarSinonimoEmpresa } from '@/modules/busqueda/actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Sinónimos de búsqueda' }

/**
 * Sinónimos DE LA EMPRESA. Se aplican a las búsquedas de sus clientes y
 * mandan sobre los globales de la plataforma. El caso típico: el nombre
 * local de un servicio («lavado premium») apuntando al término con que
 * está publicado el catálogo.
 */
export default async function SinonimosAdminPage() {
  const user = await requireSection('sinonimos')
  if (!user) redirect('/admin/dashboard')
  const companyId = await resolveCompanyId(user)
  if (!companyId) {
    return <SinEmpresaActiva seccion="los sinónimos de búsqueda" />
  }

  const filas = await listarSinonimos(companyId)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sinónimos de búsqueda"
        description="Cuando tus clientes busquen un término, encontrarán también su equivalencia. Tus sinónimos mandan sobre los globales de la plataforma."
      />
      <SinonimosPanel
        filas={filas}
        guardar={guardarSinonimoEmpresa}
        eliminar={eliminarSinonimoEmpresa}
      />
    </div>
  )
}

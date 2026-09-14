import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { SinonimosPanel } from '@/components/busqueda/SinonimosPanel'
import { listarSinonimos } from '@/modules/busqueda/sinonimos'
import { eliminarSinonimoGlobal, guardarSinonimoGlobal } from '@/modules/busqueda/actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Sinónimos de búsqueda' }

/**
 * Sinónimos GLOBALES del buscador (plataforma). Aplican a todas las
 * búsquedas de la app; los que cada empresa define en /admin/sinonimos
 * mandan sobre estos para sus propios clientes.
 */
export default async function BusquedaSuperadminPage() {
  await requireRole('SUPERADMIN')
  const filas = await listarSinonimos(null)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sinónimos de búsqueda"
        description="Equivalencias globales del buscador: cuando alguien busca un término, encuentra también su equivalencia. Los sinónimos de cada empresa mandan sobre estos para sus clientes."
      />
      <SinonimosPanel
        filas={filas}
        guardar={guardarSinonimoGlobal}
        eliminar={eliminarSinonimoGlobal}
      />
    </div>
  )
}

import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { PanelCategoriasVehiculo } from '@/components/supply-v2/panel-categorias-vehiculo'
import { categoriasVehiculo } from '@/modules/supply-v2/categories/queries'
import { BASE_SUPPLY_V2 } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Categorías de vehículo · Supply 2.0' }

/**
 * MEMBEGO SUPPLY 2.0 · categorías de vehículo de PLATAFORMA.
 *
 * NO tiene pestaña propia en la navegación, a propósito: ya hay once y este es
 * un catálogo de cuatro filas que se toca una vez al año. Se llega desde
 * Ofertas, que es donde está quien pone precios y por tanto quien necesita
 * mirarlo. La pestaña marcada es «Ofertas» porque es la sección a la que
 * pertenece.
 */
export default async function CategoriasVehiculoPage() {
  await requireRole('SUPERADMIN')
  const categorias = await categoriasVehiculo()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Categorías de vehículo"
        description="El catálogo de Membego con el que una oferta pone precio según el carro del cliente."
        eyebrow={
          <Link href={`${BASE_SUPPLY_V2}/ofertas`} className="hover:underline">
            Volver a ofertas
          </Link>
        }
        nav={<NavSupplyV2 activa="ofertas" />}
      />
      <PanelCategoriasVehiculo categorias={categorias} />
    </div>
  )
}

import { campanasPublicas } from '@/modules/supply-v2/campaigns/queries'
import { ListaDeCampanas } from '@/components/supply-v2/ListaDeCampanas'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Campañas y promociones Membego' }

/**
 * MEMBEGO SUPPLY · SLICE 7 · CAMPAÑAS en el marketplace (§18): CONSULTA. Sin sesión: lo que es «para ti» se ve
 * dentro de la app (`/cliente/campanas`), donde se conoce al cliente.
 */
export default async function CampanasPublicasPage() {
  const campanas = await campanasPublicas(null)
  return <ListaDeCampanas campanas={campanas} espacio="publico" />
}

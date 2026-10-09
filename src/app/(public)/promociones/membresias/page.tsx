import { membresiasEnElMarketplace } from '@/modules/supply-v2/loyalty/queries'
import { rutaDeMembresias } from '@/modules/comercio/rutas'
import { ListaDeMembresias } from '@/components/supply-v2/ListaDeMembresias'
import { EnlaceDeTraspaso } from '@/components/public/TraspasoALaApp'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Membresías · Membego',
  description: 'Planes de membresía de los negocios de la red, con lo que incluye cada uno.',
}

/**
 * MEMBEGO SUPPLY · SLICE 8 · escaparate público de membresías (§15): CONSULTA. Contratar un plan se hace dentro
 * de la app (`/cliente/membresias-membego`); aquí cada plan ofrece el traspaso.
 */
export default async function MembresiasPublicasPage() {
  const planes = await membresiasEnElMarketplace()
  return (
    <ListaDeMembresias
      planes={planes}
      espacio="publico"
      accionDelPlan={() => <EnlaceDeTraspaso destino={rutaDeMembresias('app')} etiqueta="Contratar en la app" />}
    />
  )
}

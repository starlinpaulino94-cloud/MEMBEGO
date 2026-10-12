import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/site'
import { membresiasEnElMarketplace } from '@/modules/supply-v2/loyalty/queries'
import { ListaDeMembresias } from '@/components/supply-v2/ListaDeMembresias'
import { BotonContratarMembresia } from '@/components/supply-v2/boton-contratar-membresia'

export const dynamic = 'force-dynamic'
// La app no se indexa: su lista es la de la landing, que es la que se comparte.
export const metadata: Metadata = { title: `Membresías · ${SITE_NAME}`, robots: { index: false, follow: false } }

/**
 * Los planes de membresía DENTRO DE LA APP: aquí se contrata. Es la misma lista que ve la landing
 * (`ListaDeMembresias`), con el botón de contratar de verdad en lugar del traspaso. La sesión de CLIENTE la exige
 * el layout de `/cliente`; el importe lo pone siempre el servidor desde el plan.
 */
export default async function MembresiasEnLaAppPage() {
  const planes = await membresiasEnElMarketplace()
  return (
    <ListaDeMembresias
      planes={planes}
      espacio="app"
      accionDelPlan={(p) => <BotonContratarMembresia planId={p.id} gratuita={p.gratuita} precio={p.precio} />}
    />
  )
}

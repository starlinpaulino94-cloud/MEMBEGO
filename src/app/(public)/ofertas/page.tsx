import type { Metadata } from 'next'
import { BadgePercent } from 'lucide-react'
import { ofertasPublicas } from '@/modules/deals/publico'
import { TarjetaOferta } from '@/components/deals/TarjetaOferta'
import { SITE_NAME } from '@/lib/site'

export const metadata: Metadata = {
  title: `Ofertas de negocios locales · ${SITE_NAME}`,
  description: 'Descuentos que puedes obtener ahora y canjear con tu QR en el negocio.',
}

// Las ofertas se agotan y se pausan: una página vieja prometería lo que ya no hay.
export const revalidate = 60

export default async function OfertasPublicasPage() {
  const ofertas = await ofertasPublicas({ limite: 48 })

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-h1 text-foreground">Ofertas de negocios locales</h1>
      <p className="mt-2 text-muted-foreground">Obtén la oferta, muestra tu QR en el negocio y paga menos. Las ofertas se acaban cuando se acaban los cupos.</p>

      {ofertas.length === 0 ? (
        <div className="mt-12 rounded-lg border border-border py-16 text-center text-muted-foreground">
          <BadgePercent className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" aria-hidden />
          <p className="font-medium">Por ahora no hay ofertas disponibles</p>
          <p className="text-sm">Vuelve pronto: los negocios publican nuevas ofertas cada semana.</p>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" id="ofertas">
          {ofertas.map((o) => (
            <TarjetaOferta key={o.id} oferta={o} retorno="/ofertas" espacio="publico" />
          ))}
        </div>
      )}
    </main>
  )
}

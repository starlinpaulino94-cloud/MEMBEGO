import type { Metadata } from 'next'
import Link from 'next/link'
import { PagarFormulario } from '@/components/checkout/PagarFormulario'
import { opcionesDeCheckout } from '@/modules/checkout/publico'
import { SITE_NAME } from '@/lib/site'

export const metadata: Metadata = {
  title: `Pagar · ${SITE_NAME}`,
  robots: { index: false, follow: false },
}

// Las sucursales y los métodos de pago cambian: no se guarda en caché.
export const dynamic = 'force-dynamic'

/** /carrito/pagar/[negocio] — el pago de UN negocio. «No existe» y «no recibe pedidos» se ven igual. */
export default async function PagarCarritoPage({ params }: { params: Promise<{ companySlug: string }> }) {
  const { companySlug } = await params
  const opciones = await opcionesDeCheckout(companySlug)

  if (!opciones) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6 lg:px-8">
        <h1 className="text-h1 text-foreground">Pagar</h1>
        <p className="mt-4 rounded-lg border border-border p-6 text-muted-foreground">
          Este negocio no recibe pedidos por ahora. <Link href="/carrito" className="underline">Volver al carrito</Link>.
        </p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6 lg:px-8">
      <p className="text-caption text-muted-foreground">
        <Link href="/carrito" className="hover:underline">
          Mi carrito
        </Link>
      </p>
      <h1 className="mt-1 text-h1 text-foreground">Pagar · {opciones.nombre}</h1>
      <div className="mt-6">
        <PagarFormulario companySlug={opciones.slug} sucursales={opciones.sucursales} transferencia={opciones.transferencia} />
      </div>
    </main>
  )
}

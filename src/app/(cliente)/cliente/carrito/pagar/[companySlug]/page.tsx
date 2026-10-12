import type { Metadata } from 'next'
import Link from 'next/link'
import { PagarFormulario } from '@/components/checkout/PagarFormulario'
import { opcionesDeCheckout } from '@/modules/checkout/publico'
import { RUTA_CARRITO } from '@/modules/comercio/rutas'
import { SITE_NAME } from '@/lib/site'

export const metadata: Metadata = {
  title: `Pagar · ${SITE_NAME}`,
  robots: { index: false, follow: false },
}

// Las sucursales y los métodos de pago cambian: no se guarda en caché.
export const dynamic = 'force-dynamic'

/**
 * /cliente/carrito/pagar/[negocio] — el pago de UN negocio, dentro de la app. «No existe» y «no recibe pedidos» se
 * ven igual. Antes estaba en `/carrito/pagar/[negocio]`, en la landing; esa ruta ahora redirige aquí.
 */
export default async function PagarCarritoPage({ params }: { params: Promise<{ companySlug: string }> }) {
  const { companySlug } = await params
  const opciones = await opcionesDeCheckout(companySlug)

  if (!opciones) {
    return (
      <div>
        <h1 className="text-h1 text-foreground">Pagar</h1>
        <p className="mt-4 rounded-lg border border-border p-6 text-muted-foreground">
          Este negocio no recibe pedidos por ahora. <Link href={RUTA_CARRITO} className="underline">Volver al carrito</Link>.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl">
      <p className="text-caption text-muted-foreground">
        <Link href={RUTA_CARRITO} className="hover:underline">
          Mi carrito
        </Link>
      </p>
      <h1 className="mt-1 text-h1 text-foreground">Pagar · {opciones.nombre}</h1>
      <div className="mt-6">
        <PagarFormulario companySlug={opciones.slug} sucursales={opciones.sucursales} transferencia={opciones.transferencia} />
      </div>
    </div>
  )
}

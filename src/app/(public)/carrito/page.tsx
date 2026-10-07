import type { Metadata } from 'next'
import { CarritoVista } from '@/components/checkout/CarritoVista'
import { SITE_NAME } from '@/lib/site'

export const metadata: Metadata = {
  title: `Mi carrito · ${SITE_NAME}`,
  robots: { index: false, follow: false },
}

/**
 * /carrito — el carrito vive en el navegador (sin cuenta). La página no trae datos de nadie: cada bloque pide
 * al servidor los precios y existencias de hoy de los productos que la persona agregó.
 */
export default function CarritoPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-h1 text-foreground">Mi carrito</h1>
      <p className="mt-2 text-muted-foreground">Revisa tus productos. Los precios y las existencias se confirman al momento de pagar.</p>
      <CarritoVista />
    </main>
  )
}

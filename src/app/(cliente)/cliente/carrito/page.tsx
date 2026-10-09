import type { Metadata } from 'next'
import { CarritoVista } from '@/components/checkout/CarritoVista'
import { SITE_NAME } from '@/lib/site'

export const metadata: Metadata = {
  title: `Mi carrito · ${SITE_NAME}`,
  robots: { index: false, follow: false },
}

/**
 * /cliente/carrito — el carrito de productos y servicios, DENTRO DE LA APP. Vive en el navegador (localStorage);
 * la página no trae datos de nadie: cada bloque pide al servidor los precios y existencias de hoy de lo que la
 * persona agregó. La sesión de CLIENTE la exige el layout de `/cliente`.
 *
 * Antes estaba en `/carrito`, en la landing. Esa ruta ahora redirige aquí (ver `next.config.ts`).
 */
export default function CarritoPage() {
  return (
    <div>
      <h1 className="text-h1 text-foreground">Mi carrito</h1>
      <p className="mt-2 text-muted-foreground">Revisa tus productos. Los precios y las existencias se confirman al momento de pagar.</p>
      <CarritoVista />
    </div>
  )
}

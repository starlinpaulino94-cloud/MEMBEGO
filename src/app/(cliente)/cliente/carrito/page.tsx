import type { Metadata } from 'next'
import { CarritoDeLaApp } from '@/components/checkout/CarritoDeLaApp'
import { SITE_NAME } from '@/lib/site'

export const metadata: Metadata = {
  title: `Mi carrito · ${SITE_NAME}`,
  robots: { index: false, follow: false },
}

/**
 * /cliente/carrito — el carrito ÚNICO de la app: productos, servicios y excursiones. Vive en el navegador
 * (localStorage); la página no trae datos de nadie: cada bloque de productos pide al servidor los precios y existencias
 * de hoy. La sesión de CLIENTE la exige el layout de `/cliente`.
 *
 * Antes estaba en `/carrito`, en la landing (y las excursiones tenían su propio cajón). Esa ruta ahora redirige aquí
 * (ver `next.config.ts`).
 */
export default function CarritoPage() {
  return (
    <div>
      <h1 className="text-h1 text-foreground">Mi carrito</h1>
      <p className="mt-2 text-muted-foreground">Revisa tus productos y excursiones. Los precios y las existencias se confirman al momento de pagar.</p>
      <CarritoDeLaApp />
    </div>
  )
}

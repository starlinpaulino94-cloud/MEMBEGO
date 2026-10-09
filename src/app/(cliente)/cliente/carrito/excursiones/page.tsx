import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/site'
import { CheckoutExcursiones } from '@/components/excursiones/CheckoutExcursiones'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: `Reservar excursiones · ${SITE_NAME}`,
  robots: { index: false, follow: false },
}

/**
 * /cliente/carrito/excursiones — revisar y confirmar las excursiones del carrito (reservar en destino o pagar en línea).
 * Antes estaba en `/checkout`, en la landing; esa ruta ahora redirige aquí (ver `next.config.ts`). La sesión de CLIENTE
 * la exige el layout de `/cliente`; las reservas las vuelve a autorizar `reservarCarritoAction`.
 */
export default function CarritoExcursionesPage() {
  return <CheckoutExcursiones isAuthenticated />
}

import { paymentSessionLimiter } from '@/lib/rate-limit'
import { requestIp } from '@/modules/pagos/cardnetClienteShared'
import { cargarVentanaCardnet } from '@/modules/pagos/cardnetVentana'
import { construirVentanaCardnet, construirVentanaNoDisponible } from '@/modules/pagos/cardnetVentanaHtml'

export const dynamic = 'force-dynamic'

/**
 * La ventana de CardNET que la app móvil abre en el navegador del teléfono (pestaña de Chrome en Android, Safari en
 * iPhone) en vez de en su WebView, donde la verificación 3D Secure del banco fallaba. Ver `cardnetVentanaHtml.ts`.
 *
 * Sin `Authorization`: la pestaña no lleva la sesión de la app. La abre el id de la sesión de captura con su nonce, que
 * solo tiene la app del cliente; cobrar sigue exigiendo la sesión autenticada (`/confirmar`) o lo decide el servidor.
 */
const CABECERAS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
}

export async function GET(request: Request) {
  if (!(await paymentSessionLimiter(`ventana-cardnet:${requestIp(request)}`))) {
    return new Response(construirVentanaNoDisponible(), { status: 429, headers: CABECERAS })
  }
  const params = new URL(request.url).searchParams
  const datos = await cargarVentanaCardnet(params.get('s'), params.get('n'))
  if (!datos) return new Response(construirVentanaNoDisponible(), { status: 404, headers: CABECERAS })
  return new Response(construirVentanaCardnet(datos), { status: 200, headers: CABECERAS })
}

import { NextResponse } from 'next/server'
import { corsHeaders, getApiClientUser, handleCorsPreflight } from '@/lib/auth/api-guard'
import { paymentSessionLimiter } from '@/lib/rate-limit'
import { leerPanelDeIdentidad } from '@/modules/identidad/identidadPuerta'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

/**
 * `GET /api/v1/cliente/identidad/estado` — todo lo que la pantalla de verificación de identidad necesita:
 * el estado, qué botón ofrecer, los textos, los consentimientos con su versión vigente y las incidencias abiertas.
 *
 * Es lo que la app sondea al volver del proveedor. Si el intento abierto lleva un rato sin novedad, antes de responder
 * le pregunta al proveedor (la red de seguridad de los avisos perdidos). Devuelve solo lo comunicable: nunca la referencia
 * del proveedor, el hash ni el motivo de un rechazo por fraude. La persona sale de la sesión, nunca de la petición.
 */
export async function GET(request: Request) {
  const user = await getApiClientUser(request)
  if (!user?.metadata.dbUserId || user.metadata.role !== 'CLIENTE') {
    return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401, headers: corsHeaders(request) })
  }
  if (!(await paymentSessionLimiter('identidad-estado:' + user.supabaseId))) {
    return NextResponse.json({ ok: false, error: 'Demasiadas solicitudes.' }, { status: 429, headers: corsHeaders(request) })
  }
  const panel = await leerPanelDeIdentidad(user.metadata.dbUserId, { reconciliar: true })
  return NextResponse.json({ ok: true, panel }, { headers: { ...corsHeaders(request), 'Cache-Control': 'no-store' } })
}

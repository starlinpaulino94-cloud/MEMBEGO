import { NextResponse } from 'next/server'
import { corsHeaders, getApiClientUser, handleCorsPreflight } from '@/lib/auth/api-guard'
import { paymentSessionLimiter } from '@/lib/rate-limit'
import { consultarEstadoConReconciliacion } from '@/modules/identidad/sincronizacion'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

/**
 * `GET /api/v1/cliente/identidad/estado` — el estado de identidad de la persona autenticada.
 *
 * Es lo que la app sondea al volver del proveedor. Si el intento abierto lleva un rato sin
 * novedad, antes de responder le pregunta al proveedor (la red de seguridad de los avisos
 * perdidos). Devuelve solo lo comunicable: nunca la referencia del proveedor, el hash ni el
 * motivo de un rechazo por fraude.
 */
export async function GET(request: Request) {
  const user = await getApiClientUser(request)
  if (!user?.metadata.dbUserId || user.metadata.role !== 'CLIENTE') {
    return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401, headers: corsHeaders(request) })
  }
  if (!(await paymentSessionLimiter(`identidad-estado:${user.supabaseId}`))) {
    return NextResponse.json({ ok: false, error: 'Demasiadas solicitudes.' }, { status: 429, headers: corsHeaders(request) })
  }
  const estado = await consultarEstadoConReconciliacion(user.metadata.dbUserId)
  return NextResponse.json({ ok: true, estado }, { headers: { ...corsHeaders(request), 'Cache-Control': 'no-store' } })
}

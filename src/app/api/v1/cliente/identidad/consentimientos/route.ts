import { NextResponse } from 'next/server'
import { corsHeaders, getApiClientUser, handleCorsPreflight } from '@/lib/auth/api-guard'
import { cambiarConsentimientoDePersona } from '@/modules/identidad/identidadPuerta'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

/**
 * `POST /api/v1/cliente/identidad/consentimientos` — da (`accion: 'aceptar'`, con la `version` del texto que la persona vio) o
 * retira (`accion: 'retirar'`) UN consentimiento de identidad. Es lo que maneja el interruptor «que los negocios vean que estoy
 * verificado». La persona sale de la sesión; el texto lo escribe el servidor y aquí solo vuelve su versión.
 */
export async function POST(request: Request) {
  const user = await getApiClientUser(request)
  if (!user?.metadata.dbUserId || user.metadata.role !== 'CLIENTE') {
    return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401, headers: corsHeaders(request) })
  }
  const cuerpo: unknown = await request.json().catch(() => null)
  const d = cuerpo && typeof cuerpo === 'object' && !Array.isArray(cuerpo) ? (cuerpo as Record<string, unknown>) : null
  if (!d || typeof d.tipo !== 'string' || (d.accion !== 'aceptar' && d.accion !== 'retirar')) {
    return NextResponse.json({ ok: false, error: 'Solicitud no válida.' }, { status: 400, headers: corsHeaders(request) })
  }
  const r = await cambiarConsentimientoDePersona(
    { userId: user.metadata.dbUserId, supabaseId: user.supabaseId },
    { tipo: d.tipo, accion: d.accion, version: typeof d.version === 'string' ? d.version : undefined },
    { canal: 'movil', ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null, userAgent: request.headers.get('user-agent') }
  )
  if (r.ok) return NextResponse.json({ ok: true }, { headers: { ...corsHeaders(request), 'Cache-Control': 'no-store' } })
  return NextResponse.json({ ok: false, motivo: r.motivo, error: r.error }, { status: r.status, headers: corsHeaders(request) })
}

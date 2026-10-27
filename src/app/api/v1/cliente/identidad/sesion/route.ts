import { NextResponse } from 'next/server'
import { corsHeaders, getApiClientUser, handleCorsPreflight } from '@/lib/auth/api-guard'
import { iniciarVerificacionDePersona } from '@/modules/identidad/identidadPuerta'
import { CANALES_INTENTO, type CanalIntento } from '@/modules/identidad/identidadCore'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

/**
 * `POST /api/v1/cliente/identidad/sesion` — empieza (o retoma) la verificación de la persona autenticada y devuelve la
 * dirección a la que hay que mandarla. Cuerpo: `{ canal?, consentimientos?: { tipo: versión } }`. Los consentimientos son los
 * que la persona acaba de marcar, cada uno con la versión del texto que vio (si no es la vigente, 409).
 *
 * La persona sale SIEMPRE de la sesión (el JWT), nunca del cuerpo: nadie puede iniciar la verificación de otra. La respuesta NO
 * se registra: la dirección lleva un token de la sesión del proveedor. Ningún camino de este archivo marca a nadie como
 * verificado: eso solo lo hace el worker tras consultar al proveedor.
 */
export async function POST(request: Request) {
  const user = await getApiClientUser(request)
  if (!user?.metadata.dbUserId || user.metadata.role !== 'CLIENTE') {
    return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401, headers: corsHeaders(request) })
  }
  const cuerpo: unknown = await request.json().catch(() => null)
  const datos = cuerpo && typeof cuerpo === 'object' && !Array.isArray(cuerpo) ? (cuerpo as Record<string, unknown>) : {}
  const canal: CanalIntento = (CANALES_INTENTO as readonly unknown[]).includes(datos.canal) ? (datos.canal as CanalIntento) : 'movil_hospedado'
  const bruto = datos.consentimientos
  const aceptados: Record<string, string> | undefined =
    bruto && typeof bruto === 'object' && !Array.isArray(bruto)
      ? Object.fromEntries(Object.entries(bruto).filter((e): e is [string, string] => typeof e[1] === 'string'))
      : undefined

  const r = await iniciarVerificacionDePersona(
    { userId: user.metadata.dbUserId, supabaseId: user.supabaseId },
    { aceptados, canalDeCaptura: canal },
    { canal: 'movil', ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null, userAgent: request.headers.get('user-agent') }
  )
  if (r.ok) {
    return NextResponse.json({ ok: true, url: r.url, intentoId: r.intentoId, nonce: r.nonce }, { headers: { ...corsHeaders(request), 'Cache-Control': 'no-store' } })
  }
  return NextResponse.json(
    { ok: false, motivo: r.motivo, error: r.error, esperarHasta: r.esperarHasta ?? null, reintentarEnSegundos: r.reintentarEnSegundos ?? null },
    {
      status: r.status,
      headers: { ...corsHeaders(request), 'Cache-Control': 'no-store', ...(r.reintentarEnSegundos ? { 'Retry-After': String(r.reintentarEnSegundos) } : {}) },
    }
  )
}

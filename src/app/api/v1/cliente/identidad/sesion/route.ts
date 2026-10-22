import { NextResponse } from 'next/server'
import { corsHeaders, getApiClientUser, handleCorsPreflight } from '@/lib/auth/api-guard'
import { identidadSesionLimiter } from '@/lib/rate-limit'
import { iniciarSesionDeVerificacion } from '@/modules/identidad/sincronizacion'
import { CANALES_INTENTO, type CanalIntento } from '@/modules/identidad/identidadCore'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

/**
 * `POST /api/v1/cliente/identidad/sesion` — empieza (o retoma) la verificación de la persona
 * autenticada y devuelve la dirección a la que hay que mandarla.
 *
 * La persona sale SIEMPRE de la sesión (el JWT), nunca del cuerpo: nadie puede iniciar la
 * verificación de otra. El cuerpo solo dice por dónde viene (`canal`). La respuesta NO se
 * registra: la dirección lleva un token de la sesión del proveedor. Ningún camino de este
 * archivo marca a nadie como verificado: eso solo lo hace el worker tras consultar al proveedor.
 */
export async function POST(request: Request) {
  const user = await getApiClientUser(request)
  if (!user?.metadata.dbUserId || user.metadata.role !== 'CLIENTE') {
    return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401, headers: corsHeaders(request) })
  }
  // Crear una sesión con el proveedor cuesta dinero y abre la cámara: presupuesto estrecho por persona.
  if (!(await identidadSesionLimiter(user.supabaseId))) {
    return NextResponse.json({ ok: false, error: 'Demasiadas solicitudes.' }, { status: 429, headers: corsHeaders(request) })
  }
  const cuerpo: unknown = await request.json().catch(() => null)
  const pedido = cuerpo && typeof cuerpo === 'object' && !Array.isArray(cuerpo) ? (cuerpo as Record<string, unknown>).canal : undefined
  const canal: CanalIntento = (CANALES_INTENTO as readonly unknown[]).includes(pedido) ? (pedido as CanalIntento) : 'movil_hospedado'

  const r = await iniciarSesionDeVerificacion(user.metadata.dbUserId, {
    canal,
    ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: request.headers.get('user-agent'),
  })
  if (r.ok) {
    return NextResponse.json(
      { ok: true, url: r.url, intentoId: r.intentoId, nonce: r.nonce, estado: r.estado, esRevalidacion: r.esRevalidacion },
      { headers: { ...corsHeaders(request), 'Cache-Control': 'no-store' } }
    )
  }
  const status = r.motivo === 'no_habilitada' ? 403 : r.motivo === 'proveedor_no_disponible' || r.motivo === 'sin_configuracion' ? 503 : 409
  return NextResponse.json(
    { ok: false, motivo: r.motivo, esperarHasta: r.esperarHasta ?? null, reintentarEnSegundos: r.reintentarEnSegundos ?? null },
    {
      status,
      headers: { ...corsHeaders(request), 'Cache-Control': 'no-store', ...(r.reintentarEnSegundos ? { 'Retry-After': String(r.reintentarEnSegundos) } : {}) },
    }
  )
}

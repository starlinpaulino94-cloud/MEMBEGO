import { NextResponse } from 'next/server'
import { corsHeaders, getApiClientUser, handleCorsPreflight } from '@/lib/auth/api-guard'
import { reportarProblemaDePersona } from '@/modules/identidad/identidadPuerta'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

/**
 * `POST /api/v1/cliente/identidad/incidencias` — la persona cuenta un problema con su verificación:
 * `{ tipo, mensaje, intentoId? }`. Queda en la cola del equipo autorizado. La persona sale de la sesión; un `intentoId` que no
 * es suyo se rechaza.
 */
export async function POST(request: Request) {
  const user = await getApiClientUser(request)
  if (!user?.metadata.dbUserId || user.metadata.role !== 'CLIENTE') {
    return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401, headers: corsHeaders(request) })
  }
  const cuerpo: unknown = await request.json().catch(() => null)
  const d = cuerpo && typeof cuerpo === 'object' && !Array.isArray(cuerpo) ? (cuerpo as Record<string, unknown>) : null
  if (!d || typeof d.tipo !== 'string' || typeof d.mensaje !== 'string') {
    return NextResponse.json({ ok: false, error: 'Solicitud no válida.' }, { status: 400, headers: corsHeaders(request) })
  }
  const r = await reportarProblemaDePersona(
    { userId: user.metadata.dbUserId, supabaseId: user.supabaseId },
    { tipo: d.tipo, mensaje: d.mensaje, intentoId: typeof d.intentoId === 'string' ? d.intentoId : null }
  )
  if (r.ok) return NextResponse.json({ ok: true, incidenciaId: r.incidenciaId }, { status: 201, headers: corsHeaders(request) })
  return NextResponse.json({ ok: false, motivo: r.motivo, error: r.error }, { status: r.status, headers: corsHeaders(request) })
}

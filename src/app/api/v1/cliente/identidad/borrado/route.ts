import { NextResponse } from 'next/server'
import { corsHeaders, getApiClientUser, handleCorsPreflight } from '@/lib/auth/api-guard'
import { pedirBorradoDePersona } from '@/modules/identidad/identidadPuerta'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

/**
 * `POST /api/v1/cliente/identidad/borrado` — la persona pide que se borren sus datos de verificación (derecho de supresión).
 * Se borra en el proveedor y, solo si lo confirma, en Membego. Sin cuerpo: la persona sale de la sesión. Es irreversible: pierde
 * su verificación y tendría que volver a hacerla.
 */
export async function POST(request: Request) {
  const user = await getApiClientUser(request)
  if (!user?.metadata.dbUserId || user.metadata.role !== 'CLIENTE') {
    return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401, headers: corsHeaders(request) })
  }
  const r = await pedirBorradoDePersona({ userId: user.metadata.dbUserId, supabaseId: user.supabaseId })
  if (r.ok) return NextResponse.json({ ok: true }, { headers: { ...corsHeaders(request), 'Cache-Control': 'no-store' } })
  return NextResponse.json({ ok: false, motivo: r.motivo, error: r.error }, { status: r.status, headers: corsHeaders(request) })
}

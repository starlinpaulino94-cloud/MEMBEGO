import { NextRequest, NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { GET as geoCercanosGET } from '@/app/api/geo/cercanos/route'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

/**
 * BFF móvil de /api/geo/cercanos: mismo handler (parámetros, validación,
 * rate-limit, consentimiento), pero exige sesión de cliente vía Bearer.
 *
 * Nota: el handler interno resuelve la sesión con cookies (`getUser`), que el
 * móvil no envía — por eso `esFavorita` no se marca y el consentimiento de
 * ubicación no se exige aquí. El guard Bearer ya autenticó al cliente.
 */
export async function GET(request: NextRequest) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  const res = await geoCercanosGET(request)
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(corsHeaders(request))) headers.set(k, v)
  return new NextResponse(res.body, { status: res.status, headers })
}
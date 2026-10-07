import { NextRequest, NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { GET as geoAutocompletarGET } from '@/app/api/geo/autocompletar/route'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

/**
 * BFF móvil de /api/geo/autocompletar: mismo handler (parámetros, validación,
 * rate-limit), pero exige sesión de cliente vía Bearer.
 */
export async function GET(request: NextRequest) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  const res = await geoAutocompletarGET(request)
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(corsHeaders(request))) headers.set(k, v)
  return new NextResponse(res.body, { status: res.status, headers })
}
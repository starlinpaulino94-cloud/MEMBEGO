import { NextResponse } from 'next/server'
import { corsHeaders, getApiClientUser, handleCorsPreflight } from '@/lib/auth/api-guard'
import { establecerTarjetaPredeterminada, eliminarTarjeta, listarTarjetasCliente } from '@/modules/pagos/cardnetTokenGuardado'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

export async function GET(request: Request) {
  const user = await getApiClientUser(request)
  if (!user || user.metadata.role !== 'CLIENTE' || !user.metadata.clienteId || !user.metadata.companyId) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401, headers: corsHeaders(request) })
  }
  const tarjetas = await listarTarjetasCliente(user.metadata.clienteId, user.metadata.companyId)
  return NextResponse.json({ tarjetas }, { headers: corsHeaders(request) })
}

export async function POST(request: Request) {
  const user = await getApiClientUser(request)
  if (!user || user.metadata.role !== 'CLIENTE' || !user.metadata.clienteId || !user.metadata.companyId) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401, headers: corsHeaders(request) })
  }
  const body: unknown = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || !('tarjetaId' in body) || typeof body.tarjetaId !== 'string') {
    return NextResponse.json({ error: 'Solicitud no válida.' }, { status: 400, headers: corsHeaders(request) })
  }
  const ok = await establecerTarjetaPredeterminada(body.tarjetaId, user.metadata.clienteId, user.metadata.companyId)
    .catch(() => false)
  return NextResponse.json({ ok }, { status: ok ? 200 : 404, headers: corsHeaders(request) })
}

export async function DELETE(request: Request) {
  const user = await getApiClientUser(request)
  if (!user || user.metadata.role !== 'CLIENTE' || !user.metadata.clienteId) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401, headers: corsHeaders(request) })
  }
  const body: unknown = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || !('tarjetaId' in body) || typeof body.tarjetaId !== 'string') {
    return NextResponse.json({ error: 'Solicitud no válida.' }, { status: 400, headers: corsHeaders(request) })
  }
  if (!user.metadata.companyId) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401, headers: corsHeaders(request) })
  }
  const result = await eliminarTarjeta(body.tarjetaId, user.metadata.clienteId, user.metadata.companyId).catch(() => 'no_encontrada' as const)
  const status = result === 'no_encontrada' ? 404 : result === 'pendiente' ? 202 : 200
  return NextResponse.json({ estado: result }, { status, headers: corsHeaders(request) })
}

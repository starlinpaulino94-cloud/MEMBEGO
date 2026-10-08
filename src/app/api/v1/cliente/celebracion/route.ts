import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { conEmpresaOTodas } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

/**
 * BFF · Celebración (paridad con /cliente/celebracion). Devuelve el beneficio
 * recién otorgado: la compra ACTIVA más reciente del cliente con usos.
 */
export async function GET(request: Request) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    const clienteId = user.metadata.clienteId
    if (!clienteId) {
      return NextResponse.json({ beneficio: null, compraId: null }, { headers: corsHeaders(request) })
    }

    const compra = await conEmpresaOTodas(
      user.metadata.companyId,
      'celebración: el beneficio recién otorgado es del cliente que acaba de entrar',
      (tx) =>
        tx.productoCompra.findFirst({
          where: { clienteId, estado: 'ACTIVA', usosRestantes: { gt: 0 } },
          orderBy: { createdAt: 'desc' },
          select: { id: true, promocion: { select: { titulo: true } } },
        })
    ).catch(() => null)

    return NextResponse.json(
      {
        beneficio: compra?.promocion?.titulo ?? null,
        compraId: compra?.id ?? null,
      },
      { headers: corsHeaders(request) }
    )
  } catch (error) {
    console.error('[api/v1/cliente/celebracion] Error cargando celebración:', error)
    return NextResponse.json(
      { error: 'Error interno al cargar la celebración' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}
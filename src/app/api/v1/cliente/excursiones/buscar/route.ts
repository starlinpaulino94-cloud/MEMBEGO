import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { buscarExcursionesPublicas } from '@/modules/excursiones/catalogo/search-queries'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

/**
 * GET /api/v1/cliente/excursiones/buscar
 * Búsqueda avanzada con paginación. Mismos parámetros que
 * `/api/cliente/excursiones/buscar`: q, cat, emp, fd, fh, stock, p.
 * Nota: el filtro de empresa se pasa como `companyId` (el endpoint público
 * original lo enviaba como `empresa`, que la query ignoraba silenciosamente).
 */
export async function GET(request: Request) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    const { searchParams } = new URL(request.url)

    const filtros = {
      query: searchParams.get('q') ?? undefined,
      categoria: searchParams.get('cat') ?? undefined,
      companyId: searchParams.get('emp') ?? undefined,
      fechaDesde: searchParams.get('fd') ? new Date(searchParams.get('fd')!) : undefined,
      fechaHasta: searchParams.get('fh') ? new Date(searchParams.get('fh')!) : undefined,
      soloConStock: searchParams.get('stock') === '1',
      excluirFinalizadas: true,
      pagina: parseInt(searchParams.get('p') ?? '1', 10),
      porPagina: 12,
    }

    const resultado = await buscarExcursionesPublicas(filtros)
    return NextResponse.json(resultado, { headers: corsHeaders(request) })
  } catch (error) {
    console.error('[api/v1/cliente/excursiones/buscar] Error buscando:', error)
    return NextResponse.json(
      { error: 'Error al buscar excursiones' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}
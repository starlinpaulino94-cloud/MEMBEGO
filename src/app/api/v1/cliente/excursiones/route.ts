import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import {
  getCategoriasExcursiones,
  buscarExcursionesCliente,
  getExcursionFeed,
} from '@/modules/excursiones/catalogo/cliente-queries'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

/**
 * GET /api/v1/cliente/excursiones
 * - Sin filtros: feed curado (mis empresas, destacadas, nuevas, próximas salidas).
 * - Con `?q=` / `?categoria=` / `?empresa=` / `?stock=1`: búsqueda.
 * Siempre incluye `categorias` para los chips.
 */
export async function GET(request: Request) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    const { searchParams } = new URL(request.url)
    const q = (searchParams.get('q') ?? '').trim()
    const categoria = (searchParams.get('categoria') ?? '').trim()
    const empresa = (searchParams.get('empresa') ?? '').trim()
    const stock = (searchParams.get('stock') ?? '').trim()
    const buscando = Boolean(q || categoria || empresa || stock)

    const categorias = await getCategoriasExcursiones().catch(() => [])

    if (buscando) {
      const resultados = await buscarExcursionesCliente({
        texto: q || undefined,
        categoria: categoria || undefined,
        empresaId: empresa || undefined,
        soloConStock: stock === '1',
      })
      return NextResponse.json(
        { categorias, feed: null, resultados },
        { headers: corsHeaders(request) }
      )
    }

    const feed = await getExcursionFeed(user.metadata.dbUserId)
    return NextResponse.json(
      { categorias, feed, resultados: null },
      { headers: corsHeaders(request) }
    )
  } catch (error) {
    console.error('[api/v1/cliente/excursiones] Error cargando excursiones:', error)
    return NextResponse.json(
      { error: 'Error interno al cargar excursiones' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}
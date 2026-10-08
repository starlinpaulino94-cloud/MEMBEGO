import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { getCompaniesPublic, getCategoriesPublic } from '@/modules/marketplace/cached'
import { getSeguidasIds } from '@/modules/social/queries'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

export async function GET(request: Request) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    const { searchParams } = new URL(request.url)
    const search = (searchParams.get('q') ?? '').trim()
    const category = searchParams.get('category') ?? ''

    // Misma consulta que la página web /cliente/explorar (paridad BFF).
    const [companies, seguidas, categorias] = await Promise.all([
      getCompaniesPublic({
        search: search || undefined,
        category: category || undefined,
        limit: 100,
      }),
      user.metadata.dbUserId
        ? getSeguidasIds(user.metadata.dbUserId).catch(() => new Set<string>())
        : Promise.resolve(new Set<string>()),
      getCategoriesPublic().catch(() => []),
    ])

    return NextResponse.json(
      { empresas: companies, categorias, seguidasIds: [...seguidas] },
      { headers: corsHeaders(request) }
    )
  } catch (error) {
    console.error('[api/v1/cliente/explorar] Error cargando exploración:', error)
    return NextResponse.json(
      { error: 'Error interno al cargar exploración' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}
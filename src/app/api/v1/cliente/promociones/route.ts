import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import {
  getPromoFeed,
  getPromocionesGuardadas,
  getGuardadasIds,
  buscarEnMisEmpresas,
} from '@/modules/social/queries'
import { getPromotionsPublic, getCategoriesPublic } from '@/modules/marketplace/cached'
import type { PromotionPublic } from '@/modules/marketplace/types'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

/**
 * BFF · Listado de promociones para la app RN.
 *
 * Espejo de `/cliente/promociones` (web): sin filtros devuelve el feed curado
 * (`getPromoFeed`) + guardadas + categorías; con `?q=`, `?categoria=` o
 * `?empresa=` devuelve una lista plana de resultados (públicas + privadas de
 * sus empresas).
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
    const buscando = Boolean(q || categoria || empresa)

    const [guardadasIds, categorias] = await Promise.all([
      getGuardadasIds(user.metadata.dbUserId).catch(() => new Set<string>()),
      getCategoriesPublic().catch(() => []),
    ])

    let feed: Awaited<ReturnType<typeof getPromoFeed>> | null = null
    let guardadas: PromotionPublic[] = []
    let resultados: PromotionPublic[] = []
    if (buscando) {
      const [publicas, mias] = await Promise.all([
        getPromotionsPublic({
          search: q || undefined,
          category: categoria || undefined,
          company: empresa || undefined,
          limit: 60,
        }).catch(() => []),
        empresa
          ? Promise.resolve([])
          : buscarEnMisEmpresas(user.metadata.dbUserId, { texto: q, categoria }).catch(() => []),
      ])
      const porId = new Map<string, PromotionPublic>()
      for (const p of [...mias, ...publicas]) porId.set(p.id, p)
      resultados = [...porId.values()]
    } else {
      ;[feed, guardadas] = await Promise.all([
        getPromoFeed(user.metadata.dbUserId).catch(() => null),
        getPromocionesGuardadas(user.metadata.dbUserId).catch(() => []),
      ])
    }

    return NextResponse.json({
      feed,
      guardadas,
      categorias,
      resultados,
      buscando,
      guardadasIds: [...guardadasIds],
    }, { headers: corsHeaders(request) })
  } catch (error) {
    console.error('[api/v1/cliente/promociones] Error cargando promociones:', error)
    return NextResponse.json(
      { error: 'Error interno al cargar promociones' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}
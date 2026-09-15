import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import {
  getCompanyPublic,
  getCompanyStats,
  getCompanyPlanesPublic,
  getCompanyPostsPublic,
  getSucursalesPublic,
} from '@/modules/marketplace/cached'
import { getPromocionesDeEmpresaParaMi, getSeguidasIds } from '@/modules/social/queries'
import { fichaEnEmpresa } from '@/modules/cliente/afiliacion'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

/**
 * BFF · Detalle de empresa para la app RN.
 *
 * Misma información que el perfil interno `/cliente/empresas/[slug]` (web):
 * ficha pública + stats + planes + ofertas (privadas incluidas si la persona
 * es cliente allí) + posts + sucursales + relación de la persona con el negocio.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    const { slug } = await params
    const company = await getCompanyPublic(slug)
    if (!company) {
      return NextResponse.json({ error: 'No encontrada' }, { status: 404, headers: corsHeaders(request) })
    }

    const [stats, planes, promotions, posts, sucursales, ficha, sigo] = await Promise.all([
      getCompanyStats(slug).catch(() => null),
      getCompanyPlanesPublic(company.id).catch(() => []),
      getPromocionesDeEmpresaParaMi(company.id, user.supabaseId, 12).catch(() => []),
      getCompanyPostsPublic(company.id).catch(() => null),
      getSucursalesPublic(company.id).catch(() => []),
      fichaEnEmpresa(user.supabaseId, company.id).catch(() => null),
      getSeguidasIds(user.metadata.dbUserId).then((s) => s.has(company.id)).catch(() => false),
    ])

    return NextResponse.json({
      company,
      stats,
      planes,
      promotions,
      posts,
      sucursales,
      esCliente: ficha != null,
      sigo,
    }, { headers: corsHeaders(request) })
  } catch (error) {
    console.error('[api/v1/cliente/empresas] Error cargando empresa:', error)
    return NextResponse.json(
      { error: 'Error interno al cargar la empresa' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}
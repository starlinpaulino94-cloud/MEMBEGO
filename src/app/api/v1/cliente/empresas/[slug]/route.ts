import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import {
  getCompanyPublic,
  getCompanyStats,
  getCompanyPlanesPublic,
  getCompanyPostsPublic,
  getSucursalesPublic,
} from '@/modules/marketplace/cached'
import { getPromocionesDeEmpresaParaMi } from '@/modules/social/queries'
import { fichaEnEmpresa } from '@/modules/cliente/afiliacion'
import { getCompanyResenas, getMiResena } from '@/modules/resenas/queries'
import { excursionesPublicas } from '@/modules/excursiones/catalogo/public-queries'
import { toggleFavoritaEmpresaDirecto, toggleSeguirEmpresaDirecto } from '@/modules/social/actions'
import { sinEmpresa } from '@/lib/tenant'

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

    let dbUserId = user.metadata.dbUserId
    if (!dbUserId && (user.supabaseId || user.email)) {
      const dbUser = await sinEmpresa('resolver dbUserId para empresa', async (tx) => {
        let u = user.supabaseId
          ? await tx.user.findUnique({
              where: { supabaseId: user.supabaseId },
              select: { id: true, supabaseId: true },
            })
          : null

        if (!u && user.email) {
          u = await tx.user.findUnique({
            where: { email: user.email },
            select: { id: true, supabaseId: true },
          })
          if (u && user.supabaseId && u.supabaseId !== user.supabaseId) {
            await tx.user.update({
              where: { id: u.id },
              data: { supabaseId: user.supabaseId },
            })
          }
        }

        if (!u && user.supabaseId && user.email) {
          u = await tx.user
            .create({
              data: {
                supabaseId: user.supabaseId,
                email: user.email,
                name: user.email.split('@')[0],
                role: 'CLIENTE',
              },
              select: { id: true, supabaseId: true },
            })
            .catch(() => null)
        }

        return u
      }).catch(() => null)
      if (dbUser) dbUserId = dbUser.id
    }

    const userIds = [dbUserId, user.supabaseId].filter(
      (id): id is string => typeof id === 'string' && id.length > 0
    )

    const [stats, planes, promotions, posts, sucursales, ficha, follow, resenas, miResena, excursiones] = await Promise.all([
      getCompanyStats(slug).catch(() => null),
      getCompanyPlanesPublic(company.id).catch(() => []),
      getPromocionesDeEmpresaParaMi(company.id, user.supabaseId, 12).catch(() => []),
      getCompanyPostsPublic(company.id).catch(() => null),
      getSucursalesPublic(company.id).catch(() => []),
      fichaEnEmpresa(user.supabaseId, company.id).catch(() => null),
      userIds.length > 0
        ? sinEmpresa('consultar follow de empresa', (tx) =>
            tx.companyFollow.findFirst({
              where: { userId: { in: userIds }, companyId: company.id },
              select: { id: true, esFavorita: true },
            })
          ).catch(() => null)
        : Promise.resolve(null),
      getCompanyResenas(company.id),
      getMiResena(company.id, user.supabaseId),
      excursionesPublicas(company.id).catch(() => []),
    ])

    return NextResponse.json({
      company,
      stats,
      planes,
      promotions,
      posts,
      resenas,
      puedeOpinar: miResena.esCliente,
      miResena: miResena.resena,
      excursiones: excursiones.map((excursion) => ({
        id: excursion.id,
        nombre: excursion.nombre,
        slug: excursion.slug,
        portadaUrl: excursion.portadaUrl,
        categoria: excursion.categoria,
        moneda: excursion.moneda,
        duracionMin: excursion.duracionMin,
        ubicacion: excursion.ubicacion,
        precioDesde: excursion.variantes[0]?.precioAdulto ?? null,
        agotadaGlobal: excursion.agotadaGlobal,
        todasFechasPasadas: excursion.todasFechasPasadas,
      })),
      sucursales,
      esCliente: ficha != null,
      sigo: follow != null,
      esFavorita: follow?.esFavorita ?? false,
    }, { headers: corsHeaders(request) })
  } catch (error) {
    console.error('[api/v1/cliente/empresas] Error cargando empresa:', error)
    return NextResponse.json(
      { error: 'Error interno al cargar la empresa' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}

export async function POST(
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

    let dbUserId = user.metadata.dbUserId
    if (!dbUserId && (user.supabaseId || user.email)) {
      const dbUser = await sinEmpresa('resolver dbUserId para toggle empresa', async (tx) => {
        let u = user.supabaseId
          ? await tx.user.findUnique({
              where: { supabaseId: user.supabaseId },
              select: { id: true, supabaseId: true },
            })
          : null

        if (!u && user.email) {
          u = await tx.user.findUnique({
            where: { email: user.email },
            select: { id: true, supabaseId: true },
          })
          if (u && user.supabaseId && u.supabaseId !== user.supabaseId) {
            await tx.user.update({
              where: { id: u.id },
              data: { supabaseId: user.supabaseId },
            })
          }
        }

        if (!u && user.supabaseId && user.email) {
          u = await tx.user
            .create({
              data: {
                supabaseId: user.supabaseId,
                email: user.email,
                name: user.email.split('@')[0],
                role: 'CLIENTE',
              },
              select: { id: true, supabaseId: true },
            })
            .catch(() => null)
        }

        return u
      }).catch(() => null)
      if (dbUser) dbUserId = dbUser.id
    }

    if (!dbUserId) {
      return NextResponse.json({ error: 'Perfil de usuario incompleto' }, { status: 400, headers: corsHeaders(request) })
    }

    const body = await request.json().catch(() => ({}))
    const accion = body.accion ?? 'favorita'

    if (accion === 'seguir') {
      const res = await toggleSeguirEmpresaDirecto(dbUserId, company.id)
      return NextResponse.json(res, { headers: corsHeaders(request) })
    } else {
      const res = await toggleFavoritaEmpresaDirecto(dbUserId, company.id)
      return NextResponse.json(res, { headers: corsHeaders(request) })
    }
  } catch (error) {
    console.error('[api/v1/cliente/empresas] Error al actualizar estado de empresa:', error)
    return NextResponse.json(
      { error: 'Error interno' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}

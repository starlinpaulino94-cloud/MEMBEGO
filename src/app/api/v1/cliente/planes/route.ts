import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { conEmpresa } from '@/lib/tenant'
import { getPlanesPublic, getCategoriesPublic } from '@/modules/marketplace/cached'
import { planesElegibles } from '@/modules/elegibilidad'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

/**
 * BFF · Planes disponibles para la app RN.
 *
 * Espejo de `/cliente/planes` (web): con empresa activa devuelve los planes
 * elegibles con precio resuelto por el motor de elegibilidad; sin empresa
 * activa (o `?todos=1`) devuelve el catálogo global con categorías.
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
    const verTodos = searchParams.get('todos') === '1'

    if (verTodos || !user.metadata.clienteId || !user.metadata.companyId) {
      const [planes, categorias] = await Promise.all([
        getPlanesPublic({ search: q || undefined, category: categoria || undefined }).catch(() => []),
        getCategoriesPublic().catch(() => []),
      ])
      return NextResponse.json({ modo: 'global', planes, categorias }, { headers: corsHeaders(request) })
    }

    const { clienteId, companyId } = user.metadata
    // REGLA DE COMPATIBILIDAD (web): quien ya tiene membresía en la empresa
    // recibe VITRINA en vez de bloqueo si le faltan requisitos.
    const membership = await conEmpresa(companyId, (tx) =>
      tx.membership.findFirst({
        where: { clienteId },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          estado: true,
          planId: true,
          planIdSolicitado: true,
          plan: { select: { nombre: true } },
          planSolicitado: { select: { nombre: true } },
        },
      })
    ).catch(() => null)

    const cliente = await conEmpresa(companyId, (tx) =>
      tx.cliente.findUnique({
        where: { id: clienteId },
        select: {
          nombre: true,
          company: { select: { name: true } },
        },
      })
    ).catch(() => null)

    const resultado = await planesElegibles({
      companyId,
      clienteId,
      vitrinaSinRequisitos: membership != null,
    }).catch(() => null)
    if (!resultado) {
      return NextResponse.json(
        { error: 'No pudimos cargar los planes' },
        { status: 500, headers: corsHeaders(request) }
      )
    }

    const planes = resultado.planes.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      precio: p.decision.precio,
      esIlimitado: p.esIlimitado,
      descripcion: p.descripcion,
      lavadosIncluidos: p.lavadosIncluidos,
      beneficios: p.beneficios,
      vigenciaDias: p.vigenciaDias,
      condiciones: p.condiciones,
      comprable: p.decision.puedeComprar,
      nivelSuperior: !p.decision.puedeComprar,
      precioDeCategoria: p.decision.precioOrigen === 'CATEGORIA',
    }))

    return NextResponse.json({
      modo: 'empresa',
      planes,
      requisitos: resultado.requisitos,
      vitrina: resultado.vitrina,
      planesPublicados: resultado.planesPublicados,
      requiereVehiculo: resultado.requiereVehiculo,
      cliente: cliente
        ? {
            nombre: cliente.nombre,
            empresaNombre: cliente.company.name,
            membership,
          }
        : null,
    }, { headers: corsHeaders(request) })
  } catch (error) {
    console.error('[api/v1/cliente/planes] Error cargando planes:', error)
    return NextResponse.json(
      { error: 'Error interno al cargar planes' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}

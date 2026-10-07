import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
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
    const membershipId = (searchParams.get('membershipId') ?? '').trim()

    if (membershipId) {
      const membership = await sinEmpresa('planes: membership para elegir un upgrade', (tx) =>
        tx.membership.findUnique({
          where: { id: membershipId },
          select: {
            id: true,
            clienteId: true,
            companyId: true,
            estado: true,
            planId: true,
            planIdSolicitado: true,
            cliente: { select: { supabaseId: true, nombre: true } },
            plan: { select: { id: true, nombre: true, precio: true, vigenciaDias: true } },
            planSolicitado: { select: { id: true, nombre: true } },
          },
        })
      )
      if (!membership) {
        return NextResponse.json({ error: 'Membresía no encontrada.' }, { status: 404, headers: corsHeaders(request) })
      }
      if (membership.cliente.supabaseId !== user.supabaseId) {
        return NextResponse.json({ error: 'No autorizado.' }, { status: 403, headers: corsHeaders(request) })
      }
      if (membership.estado !== 'ACTIVA') {
        return NextResponse.json({ error: 'Solo puedes cambiar el plan de una membresía activa.' }, { status: 409, headers: corsHeaders(request) })
      }

      const [company, resultado] = await Promise.all([
        conEmpresa(membership.companyId, (tx) =>
          tx.company.findUnique({
            where: { id: membership.companyId },
            select: { id: true, name: true, slug: true, logoUrl: true, colorPrimario: true, ciudad: true, moneda: true, idioma: true },
          })
        ),
        planesElegibles({
          companyId: membership.companyId,
          clienteId: membership.clienteId,
          vitrinaSinRequisitos: true,
        }),
      ])
      if (!company) {
        return NextResponse.json({ error: 'No pudimos encontrar el negocio de esta membresía.' }, { status: 404, headers: corsHeaders(request) })
      }

      const preciosBase = await conEmpresa(membership.companyId, (tx) =>
        tx.plan.findMany({
          where: { id: { in: resultado.planes.map((plan) => plan.id) } },
          select: { id: true, precio: true, color: true },
        })
      )
      const precioById = new Map(preciosBase.map((plan) => [plan.id, { precio: Number(plan.precio), color: plan.color }]))
      const planes = resultado.planes.map((plan) => ({
        id: plan.id,
        nombre: plan.nombre,
        precio: plan.decision.precio,
        precioBase: precioById.get(plan.id)?.precio ?? plan.decision.precio,
        color: precioById.get(plan.id)?.color ?? null,
        esIlimitado: plan.esIlimitado,
        descripcion: plan.descripcion,
        lavadosIncluidos: plan.lavadosIncluidos,
        beneficios: plan.beneficios,
        vigenciaDias: plan.vigenciaDias,
        condiciones: plan.condiciones,
        comprable: plan.decision.puedeComprar,
        nivelSuperior: !plan.decision.puedeComprar,
        precioDeCategoria: plan.decision.precioOrigen === 'CATEGORIA',
      }))

      return NextResponse.json({
        modo: 'empresa',
        planes,
        requisitos: resultado.requisitos,
        vitrina: resultado.vitrina,
        planesPublicados: resultado.planesPublicados,
        requiereVehiculo: resultado.requiereVehiculo,
        empresa: {
          ...company,
          averageRating: null,
        },
        cliente: {
          nombre: membership.cliente.nombre,
          empresaNombre: company.name,
          membership: {
            id: membership.id,
            estado: membership.estado,
            planId: membership.plan.id,
            planIdSolicitado: membership.planIdSolicitado,
            plan: {
              ...membership.plan,
              precio: Number(membership.plan.precio),
            },
            planSolicitado: membership.planSolicitado,
          },
        },
      }, { headers: corsHeaders(request) })
    }

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

import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'

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
    const fichas = await sinEmpresa(
      'cliente: buscar negocios propios con categorías para registrar vehículos',
      (tx) =>
        tx.cliente.findMany({
          where: { supabaseId: user.supabaseId },
          select: {
            companyId: true,
            company: { select: { name: true, isActive: true } },
          },
          orderBy: { createdAt: 'asc' },
        })
    )

    const empresasUnicas = new Map(
      fichas
        .filter((ficha) => ficha.company.isActive)
        .map((ficha) => [ficha.companyId, { id: ficha.companyId, nombre: ficha.company.name }])
    )
    const empresaActualId = user.metadata.companyId ?? null
    const empresas = (await Promise.all(
      [...empresasUnicas.values()].map(async (empresa) => ({
        ...empresa,
        tipos: await conEmpresa(empresa.id, (tx) =>
          tx.tipoVehiculo.findMany({
            where: { companyId: empresa.id, activo: true },
            select: { id: true, nombre: true, descripcion: true, iconoUrl: true },
            orderBy: { orden: 'asc' },
          })
        ),
      }))
    ))
      .filter((empresa) => empresa.tipos.length > 0)
      .sort((a, b) => Number(b.id === empresaActualId) - Number(a.id === empresaActualId))

    return NextResponse.json({ empresas, empresaActualId }, { headers: corsHeaders(request) })
  } catch (error) {
    console.error('[api/v1/cliente/vehiculos/tipos] Error cargando categorías:', error)
    return NextResponse.json(
      { error: 'Error interno al cargar categorías de vehículo' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}

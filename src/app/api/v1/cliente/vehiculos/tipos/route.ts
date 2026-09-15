import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { conEmpresa } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

/** Categorías de vehículo activas de la empresa activa — mismo query que /cliente/vehiculos/nuevo. */
export async function GET(request: Request) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    const companyId = user.metadata.companyId
    const tipos = companyId
      ? await conEmpresa(companyId, (tx) =>
          tx.tipoVehiculo.findMany({
            where: { companyId, activo: true },
            select: { id: true, nombre: true, descripcion: true, iconoUrl: true },
            orderBy: { orden: 'asc' },
          })
        ).catch(() => [])
      : []
    return NextResponse.json({ tipos }, { headers: corsHeaders(request) })
  } catch (error) {
    console.error('[api/v1/cliente/vehiculos/tipos] Error cargando categorías:', error)
    return NextResponse.json(
      { error: 'Error interno al cargar categorías de vehículo' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}

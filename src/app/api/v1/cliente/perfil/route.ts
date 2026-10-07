import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { getClienteAllMemberships, getClientePerfil } from '@/modules/cliente/queries'

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
    if (!user.metadata.clienteId) {
      return NextResponse.json({
        cliente: null,
        email: user.email,
        memberships: [],
        vehiculos: [],
        resumen: { activas: 0, vencidas: 0, total: 0 },
      }, { headers: corsHeaders(request) })
    }

    const cliente = await getClientePerfil(user.metadata.clienteId).catch(() => null)
    if (!cliente) {
      return NextResponse.json({
        cliente: null,
        email: user.email,
        memberships: [],
        vehiculos: [],
        resumen: { activas: 0, vencidas: 0, total: 0 },
      }, { headers: corsHeaders(request) })
    }

    const memberships = await getClienteAllMemberships(user.supabaseId, cliente.id).catch(() => [])
    const ahora = new Date()
    const activas = memberships.filter(
      (m) => m.estado === 'ACTIVA' && (!m.fechaVencimiento || new Date(m.fechaVencimiento) > ahora)
    ).length
    const vencidas = memberships.filter(
      (m) => m.estado === 'VENCIDA' || (m.fechaVencimiento !== null && new Date(m.fechaVencimiento) <= ahora)
    ).length

    return NextResponse.json({
      cliente: {
        id: cliente.id,
        nombre: cliente.nombre,
        email: cliente.email,
        telefono: cliente.telefono,
        companyId: cliente.companyId,
      },
      vehiculos: cliente.vehiculos ?? [],
      memberships,
      resumen: {
        activas,
        vencidas,
        total: memberships.length,
      },
    }, { headers: corsHeaders(request) })
  } catch (error) {
    console.error('[api/v1/cliente/perfil] Error cargando perfil de cliente:', error)
    return NextResponse.json(
      { error: 'Error interno al cargar perfil' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}

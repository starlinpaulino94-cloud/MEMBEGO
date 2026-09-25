import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { getInicioVista } from '@/modules/home/lectura'
import { cargarPanelPersonal } from '@/modules/cliente/panelPersonal'
import { nombreSiEsDemo } from '@/modules/demo'
import type { SessionUser } from '@/types'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

export async function GET(request: Request) {
  const user = await getApiClientUser(request)
  const searchParams = new URL(request.url).searchParams
  const categoria = searchParams.get('categoria') ?? searchParams.get('category') ?? undefined

  try {
    // Si no hay usuario autenticado (invitado explorando la app), usamos un contexto base
    // para mostrar la vitrina comercial (hero, categorías, promociones, empresas).
    const sesionEfectiva: SessionUser = user ?? {
      supabaseId: '',
      email: '',
      metadata: {
        role: 'CLIENTE',
        dbUserId: '',
        clienteId: null,
        companyId: null,
      },
    }

    const [comercial, personal, demoNombre] = await Promise.all([
      getInicioVista(sesionEfectiva, categoria).catch((err) => {
        console.warn('[api/v1/cliente/inicio] Warning cargando comercial:', err)
        return null
      }),
      user && user.metadata.clienteId
        ? cargarPanelPersonal(user).catch(() => null)
        : Promise.resolve(null),
      nombreSiEsDemo(user?.metadata.companyId),
    ])

    return NextResponse.json({ comercial, personal, demoNombre }, { headers: corsHeaders(request) })
  } catch (error) {
    console.error('[api/v1/cliente/inicio] Error cargando datos de inicio:', error)
    return NextResponse.json(
      { error: 'Error interno al cargar datos de inicio' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}

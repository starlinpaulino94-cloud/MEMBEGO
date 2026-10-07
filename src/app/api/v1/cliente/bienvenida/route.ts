import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { conEmpresaOTodas } from '@/lib/tenant'
import { getOnboardingCliente } from '@/modules/social/queries'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

/**
 * BFF · Bienvenida / onboarding (paridad con /cliente/bienvenida). Devuelve el
 * checklist B2C calculado desde datos reales (retomable) y el primer nombre
 * para el saludo del wizard.
 */
export async function GET(request: Request) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    const [onboarding, cliente] = await Promise.all([
      getOnboardingCliente(user.metadata.dbUserId, user.supabaseId),
      conEmpresaOTodas(
        user.metadata.companyId,
        'bienvenida: una cuenta recién creada puede no tener empresa activa todavía',
        (tx) =>
          tx.cliente.findFirst({
            where: { supabaseId: user.supabaseId },
            select: { nombre: true },
          })
      ).catch(() => null),
    ])

    // Primer nombre para un saludo más cercano.
    const nombre = (cliente?.nombre ?? user.email.split('@')[0]).split(' ')[0]

    return NextResponse.json({ onboarding, nombre }, { headers: corsHeaders(request) })
  } catch (error) {
    console.error('[api/v1/cliente/bienvenida] Error cargando onboarding:', error)
    return NextResponse.json(
      { error: 'Error interno al cargar la bienvenida' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}
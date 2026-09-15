import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { sinEmpresa } from '@/lib/tenant'
import { getActiveCategories } from '@/modules/empresas/queries'

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
    // Misma consulta que la página web /cliente/intereses (paridad BFF).
    const [categorias, intereses] = await Promise.all([
      getActiveCategories(),
      user.metadata.dbUserId
        ? sinEmpresa('intereses: son de la persona y no de ninguna empresa', (tx) =>
            tx.userInteres.findMany({
              where: { userId: user.metadata.dbUserId },
              select: { categoryId: true },
            })
          )
        : Promise.resolve([]),
    ])

    return NextResponse.json(
      { categorias, seleccion: intereses.map((i) => i.categoryId) },
      { headers: corsHeaders(request) }
    )
  } catch (error) {
    console.error('[api/v1/cliente/intereses] Error cargando intereses:', error)
    return NextResponse.json(
      { error: 'Error interno al cargar intereses' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}

/**
 * Guarda los intereses del cliente. Replica la lógica subyacente de la server
 * action `guardarIntereses` (src/modules/social/interesesActions.ts): la action
 * autentica con cookies (`getUser`) y no ve el Bearer token del móvil, así que
 * aquí se valida con `getApiClientUser` y se ejecuta la misma transacción.
 */
export async function POST(request: Request) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    if (!user.metadata.dbUserId) {
      return NextResponse.json(
        { error: 'Cuenta no configurada' },
        { status: 400, headers: corsHeaders(request) }
      )
    }

    const body = await request.json().catch(() => null)
    const categoryIds = Array.isArray(body?.categoryIds)
      ? body.categoryIds.map(String).filter(Boolean).slice(0, 17)
      : []

    // Solo categorías reales y activas (misma validación que la action).
    const validas = await sinEmpresa(
      'intereses: validar categorías activas del usuario',
      (tx) =>
        tx.businessCategory.findMany({
          where: { id: { in: categoryIds }, active: true },
          select: { id: true },
        })
    )

    await sinEmpresa(
      'intereses: guardar intereses del usuario (no pertenecen a una empresa)',
      (tx) =>
        Promise.all([
          tx.userInteres.deleteMany({ where: { userId: user.metadata.dbUserId! } }),
          ...(validas.length > 0
            ? [
                tx.userInteres.createMany({
                  data: validas.map((c) => ({
                    userId: user.metadata.dbUserId!,
                    categoryId: c.id,
                  })),
                  skipDuplicates: true,
                }),
              ]
            : []),
        ])
    )

    return NextResponse.json({ success: true }, { headers: corsHeaders(request) })
  } catch (error) {
    console.error('[api/v1/cliente/intereses] Error guardando intereses:', error)
    return NextResponse.json(
      { error: 'No se pudieron guardar. Intenta de nuevo.' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { corsHeaders, getApiClientUser, handleCorsPreflight } from '@/lib/auth/api-guard'
import { sinEmpresa } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

const updateSchema = z.discriminatedUnion('accion', [
  z.object({
    accion: z.literal('marcarLeida'),
    id: z.string().trim().min(1).max(128),
  }),
  z.object({
    accion: z.literal('marcarTodasLeidas'),
  }),
])

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

export async function GET(request: Request) {
  const user = await getApiClientUser(request)
  const userId = user?.metadata.dbUserId
  if (!user || user.metadata.role !== 'CLIENTE' || !userId) {
    return NextResponse.json(
      { error: 'Inicia sesión como cliente para ver tus notificaciones.' },
      { status: 401, headers: corsHeaders(request) },
    )
  }

  try {
    const result = await sinEmpresa('notificaciones: listar del cliente Expo', async (tx) => {
      const where = { userId }
      const [notificaciones, noLeidas] = await Promise.all([
        tx.notificacion.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: {
            id: true,
            tipo: true,
            titulo: true,
            mensaje: true,
            href: true,
            leida: true,
            createdAt: true,
          },
        }),
        tx.notificacion.count({ where: { ...where, leida: false } }),
      ])

      return { notificaciones, noLeidas }
    })

    return NextResponse.json(result, { headers: corsHeaders(request) })
  } catch (error) {
    console.error('[api/v1/cliente/notificaciones] Error cargando notificaciones:', error)
    return NextResponse.json(
      { error: 'No pudimos cargar tus notificaciones.' },
      { status: 500, headers: corsHeaders(request) },
    )
  }
}

export async function PATCH(request: Request) {
  const user = await getApiClientUser(request)
  const userId = user?.metadata.dbUserId
  if (!user || user.metadata.role !== 'CLIENTE' || !userId) {
    return NextResponse.json(
      { error: 'Inicia sesión como cliente para actualizar tus notificaciones.' },
      { status: 401, headers: corsHeaders(request) },
    )
  }

  const body = updateSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json(
      { error: 'La acción de notificación no es válida.' },
      { status: 400, headers: corsHeaders(request) },
    )
  }

  try {
    const noLeidas = await sinEmpresa('notificaciones: actualizar del cliente Expo', async (tx) => {
      if (body.data.accion === 'marcarLeida') {
        const updated = await tx.notificacion.updateMany({
          where: { id: body.data.id, userId },
          data: { leida: true },
        })
        if (updated.count === 0) return null
      } else {
        await tx.notificacion.updateMany({
          where: { userId, leida: false },
          data: { leida: true },
        })
      }

      return tx.notificacion.count({ where: { userId, leida: false } })
    })

    if (noLeidas === null) {
      return NextResponse.json(
        { error: 'No encontramos esa notificación.' },
        { status: 404, headers: corsHeaders(request) },
      )
    }

    return NextResponse.json(
      { success: true, noLeidas },
      { headers: corsHeaders(request) },
    )
  } catch (error) {
    console.error('[api/v1/cliente/notificaciones] Error actualizando notificación:', error)
    return NextResponse.json(
      { error: 'No pudimos actualizar tus notificaciones.' },
      { status: 500, headers: corsHeaders(request) },
    )
  }
}

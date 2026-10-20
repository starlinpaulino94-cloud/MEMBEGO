import { NextResponse } from 'next/server'
import { z } from 'zod'
import { corsHeaders, getApiClientUser, handleCorsPreflight } from '@/lib/auth/api-guard'
import { sinEmpresa } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

const registerSchema = z.object({
  token: z.string().trim().min(1).max(512).regex(/^(Expo|Exponent)PushToken\[[^\]]+\]$/),
  platform: z.enum(['ANDROID', 'IOS']),
})

const unregisterSchema = z.object({
  token: z.string().trim().min(1).max(512).regex(/^(Expo|Exponent)PushToken\[[^\]]+\]$/),
})

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

export async function POST(request: Request) {
  const user = await getApiClientUser(request)
  const userId = user?.metadata.dbUserId
  if (!user || user.metadata.role !== 'CLIENTE' || !userId) {
    return NextResponse.json(
      { error: 'Inicia sesión como cliente para activar notificaciones.' },
      { status: 401, headers: corsHeaders(request) },
    )
  }

  const body = registerSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json(
      { error: 'El token del dispositivo no es válido.' },
      { status: 400, headers: corsHeaders(request) },
    )
  }

  try {
    await sinEmpresa('push: registrar dispositivo del cliente', (tx) =>
      tx.pushToken.upsert({
        where: { token: body.data.token },
        create: { userId, token: body.data.token, platform: body.data.platform },
        update: { userId, platform: body.data.platform },
      }),
    )
    return NextResponse.json({ success: true }, { headers: corsHeaders(request) })
  } catch (error) {
    console.error('[api/v1/cliente/notificaciones/push-token] Error registrando dispositivo:', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json(
      { error: 'No pudimos activar las notificaciones en este dispositivo.' },
      { status: 500, headers: corsHeaders(request) },
    )
  }
}

export async function DELETE(request: Request) {
  const user = await getApiClientUser(request)
  const userId = user?.metadata.dbUserId
  if (!user || user.metadata.role !== 'CLIENTE' || !userId) {
    return NextResponse.json(
      { error: 'Inicia sesión como cliente para desactivar notificaciones.' },
      { status: 401, headers: corsHeaders(request) },
    )
  }

  const body = unregisterSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json(
      { error: 'El token del dispositivo no es válido.' },
      { status: 400, headers: corsHeaders(request) },
    )
  }

  try {
    await sinEmpresa('push: retirar dispositivo del cliente', (tx) =>
      tx.pushToken.deleteMany({ where: { userId, token: body.data.token } }),
    )
    return NextResponse.json({ success: true }, { headers: corsHeaders(request) })
  } catch (error) {
    console.error('[api/v1/cliente/notificaciones/push-token] Error retirando dispositivo:', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json(
      { error: 'No pudimos desactivar las notificaciones en este dispositivo.' },
      { status: 500, headers: corsHeaders(request) },
    )
  }
}

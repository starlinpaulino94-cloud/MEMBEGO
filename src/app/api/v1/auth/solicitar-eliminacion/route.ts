import { NextResponse } from 'next/server'
import { z } from 'zod'
import { registerLimiter } from '@/lib/rate-limit'
import { getRequestMeta } from '@/lib/server-utils'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAppUrl, SITE_NAME } from '@/lib/site'
import { sendEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

const emailSchema = z.object({ email: z.string().trim().toLowerCase().email() })

export async function POST(request: Request) {
  const { ipAddress } = await getRequestMeta()
  if (!(await registerLimiter(ipAddress ?? 'unknown'))) {
    return NextResponse.json({ error: 'Espera unos minutos antes de volver a intentarlo.' }, { status: 429 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Ingresa un correo válido.' }, { status: 400 })
  }
  const parsed = emailSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Ingresa un correo válido.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: parsed.data.email,
  })
  const token = data.properties?.hashed_token
  if (!error && token) {
    const confirmationUrl = new URL('/confirmar', getAppUrl())
    confirmationUrl.searchParams.set('token_hash', token)
    confirmationUrl.searchParams.set('type', 'magiclink')
    confirmationUrl.searchParams.set('purpose', 'delete-account')
    await sendEmail({
      to: parsed.data.email,
      subject: `Confirma la eliminación de tu cuenta · ${SITE_NAME}`,
      text: `Para continuar con la eliminación de tu cuenta MembeGo, confirma tu identidad aquí: ${confirmationUrl.toString()}. Si no lo solicitaste, ignora este mensaje.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#111827"><h1>Confirma la eliminación de tu cuenta</h1><p>Usa este enlace para confirmar que controlas este correo y continuar con la eliminación de tu cuenta MembeGo.</p><p><a href="${confirmationUrl.toString()}" style="display:inline-block;padding:12px 20px;background:#b91c1c;color:#fff;text-decoration:none;border-radius:8px">Continuar con la eliminación</a></p><p>Si no solicitaste este cambio, ignora este correo. No se eliminará ninguna cuenta.</p></div>`,
    })
  }

  // Respuesta indistinguible para evitar enumerar cuentas existentes.
  return NextResponse.json({
    success: true,
    message: 'Si existe una cuenta con ese correo, recibirás un enlace para verificar tu identidad.',
  })
}

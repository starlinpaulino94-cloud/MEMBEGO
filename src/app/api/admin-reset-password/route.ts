import { NextRequest, NextResponse } from 'next/server'
import { sinEmpresa } from '@/lib/tenant'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureEmailIdentity } from '@/lib/supabase/identity'
import { checkBootstrapAccess } from '@/lib/bootstrap-guard'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin-reset-password
 *
 * Restablece la contraseña de una cuenta usando la API admin nativa de Supabase
 * (updateUserById), que genera un hash que GoTrue sí valida. Sirve para reparar
 * cuentas cuya contraseña quedó inutilizable tras haberse fijado por SQL.
 *
 * Seguridad (ver checkBootstrapAccess): apagado por defecto (BOOTSTRAP_ENABLED),
 * secreto largo comparado en tiempo constante y rate limit por IP. Pon
 * BOOTSTRAP_ENABLED=false cuando termines.
 */
export async function POST(req: NextRequest) {
  const denied = await checkBootstrapAccess(req)
  if (denied) return denied

  let body: { email?: string; password?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo JSON inválido.' }, { status: 400 })
  }

  const email = String(body.email ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')

  if (!email || !password) {
    return NextResponse.json(
      { error: 'email y password son obligatorios.' },
      { status: 400 }
    )
  }
  if (password.length < 6) {
    return NextResponse.json(
      { error: 'La contraseña debe tener al menos 6 caracteres.' },
      { status: 400 }
    )
  }

  try {
    // 1. Localizar el id del usuario en auth.users (misma base de datos).
    const rows = await sinEmpresa('auth-user-lookup', (tx) =>
      tx.$queryRaw<{ id: string }[]>`
        select id::text as id from auth.users where email = ${email} limit 1
      `
    )
    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'No existe un usuario con ese correo.' },
        { status: 404 }
      )
    }
    const userId = rows[0].id

    // 2. Restablecer la contraseña con la API admin (hash nativo de GoTrue) y
    //    confirmar el correo por si estaba pendiente.
    const supabase = createAdminClient()
    const { error } = await supabase.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
    })
    if (error) {
      throw new Error(`updateUserById: ${error.message}`)
    }

    // 3. Garantizar el identity de email (requerido para el login por password).
    await ensureEmailIdentity(userId, email)

    return NextResponse.json({
      ok: true,
      message: 'Contraseña restablecida. Ya puedes iniciar sesión.',
      email,
    })
  } catch (e) {
    console.error('[admin-reset-password] error:', e)
    return NextResponse.json(
      { error: 'No se pudo restablecer la contraseña. Revisa los logs.' },
      { status: 500 }
    )
  }
}

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'
import { getAppUrl, SITE_NAME } from '@/lib/site'

/**
 * Verificación de correo en el registro (Fase 1 · O-1), detrás de un flag.
 *
 * Con `EMAIL_VERIFICATION_ENABLED=true` el registro crea la cuenta SIN
 * confirmar (`email_confirm:false`), genera un enlace de confirmación y lo
 * envía con la plantilla de marca propia vía Resend. El usuario activa la
 * cuenta al abrir el enlace (ruta `/confirmar`).
 *
 * IMPORTANTE: para que la verificación realmente BLOQUEE el acceso hasta
 * confirmar, en Supabase → Authentication → Providers → Email debe estar
 * activada la opción "Confirm email". El flag de la app y ese ajuste van de
 * la mano. Con el flag apagado (default), el registro se auto-confirma como
 * hasta ahora.
 */
export function isEmailVerificationEnabled(): boolean {
  return process.env.EMAIL_VERIFICATION_ENABLED === 'true'
}

/**
 * Genera un token de confirmación para un usuario YA creado (sin confirmar) y
 * envía el correo. Devuelve true si el correo salió. Usa `magiclink` porque el
 * usuario ya existe (creado con admin.createUser); al verificarlo, Supabase
 * marca el correo como confirmado y abre sesión.
 */
export async function sendVerificationEmail(
  admin: SupabaseClient,
  email: string,
  name: string,
  options: { mobile?: boolean; returnTo?: string } = {},
): Promise<boolean> {
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })

  const hashedToken = data?.properties?.hashed_token
  if (error || !hashedToken) {
    console.error('[email-verification] generateLink falló:', error)
    return false
  }

  const confirmUrl = new URL('/confirmar', getAppUrl())
  confirmUrl.searchParams.set('token_hash', hashedToken)
  confirmUrl.searchParams.set('type', 'magiclink')
  if (options.mobile) {
    confirmUrl.searchParams.set('source', 'mobile')
    const returnTo = options.returnTo?.trim() ?? ''
    if (returnTo.startsWith('/') && !returnTo.startsWith('//')) {
      confirmUrl.searchParams.set('returnTo', returnTo)
    }
  }

  const res = await sendEmail({
    to: email,
    subject: `Confirma tu correo · ${SITE_NAME}`,
    html: verificationEmailHtml(name, confirmUrl.toString()),
    text: `Hola ${name}, confirma tu correo para activar tu cuenta en ${SITE_NAME}: ${confirmUrl.toString()}`,
  })

  if (!res.sent) {
    console.error('[email-verification] envío falló:', res.reason)
  }
  return res.sent
}

function verificationEmailHtml(name: string, confirmUrl: string): string {
  const safeName = name.replace(/[<>&]/g, '')
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#0f172a">
    <h1 style="font-size:20px;font-weight:700;margin:0 0 8px">Confirma tu correo</h1>
    <p style="font-size:15px;line-height:1.5;color:#334155;margin:0 0 24px">
      Hola ${safeName}, gracias por registrarte en ${SITE_NAME}. Para activar tu
      cuenta, confirma tu dirección de correo:
    </p>
    <a href="${confirmUrl}"
       style="display:inline-block;background:#0ea5e9;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:10px">
      Activar mi cuenta
    </a>
    <p style="font-size:13px;line-height:1.5;color:#64748b;margin:24px 0 0">
      Si no creaste esta cuenta, puedes ignorar este correo. El enlace expira
      por seguridad; si caduca, vuelve a registrarte.
    </p>
    <p style="font-size:12px;color:#94a3b8;margin:24px 0 0;word-break:break-all">
      ¿El botón no funciona? Copia y pega este enlace: ${confirmUrl}
    </p>
  </div>`
}

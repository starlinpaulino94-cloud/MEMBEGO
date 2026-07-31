import { NextResponse, type NextRequest } from 'next/server'
import { getUser } from '@/lib/auth'
import { cardnetTokensConfigurado, probarSesionTokens } from '@/lib/payments/cardnet-tokens'

export const dynamic = 'force-dynamic'

/**
 * DIAGNÓSTICO (no cobra ni expone secretos): dice si ESTE deploy ve las llaves
 * de la pasarela de tarjeta. Devuelve solo booleanos de presencia — NUNCA el
 * valor de las llaves.
 *
 * Con `?probar=1` además intenta crear una sesión de captura contra el
 * proveedor y devuelve el status HTTP y la respuesta (sin sensibles): la forma
 * de ver POR QUÉ el proveedor rechaza, en vez de un error genérico.
 *
 * Con `?correo=1` envía un correo de PRUEBA al email del usuario logueado y
 * devuelve el resultado: la forma de verificar la configuración de Resend
 * (RESEND_API_KEY + EMAIL_FROM) sin tener que hacer un pago.
 *
 * Uso: entra logueado a /api/pagos/cardnet-token/estado?probar=1 (pasarela)
 * o ?correo=1 (email) en el mismo deploy que estás probando.
 */
export async function GET(req: NextRequest) {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Inicia sesión para ver el estado.' }, { status: 401 })
  }
  const base = {
    configurado: cardnetTokensConfigurado(),
    publicKeyPresente: Boolean(process.env.CARDNET_TOKENS_PUBLIC_KEY?.trim()),
    privateKeyPresente: Boolean(process.env.CARDNET_TOKENS_PRIVATE_KEY?.trim()),
    ambiente: process.env.CARDNET_TOKENS_AMBIENTE ?? '(sin definir)',
    correo: {
      resendKeyPresente: Boolean(process.env.RESEND_API_KEY?.trim()),
      emailFromPresente: Boolean(process.env.EMAIL_FROM?.trim()),
    },
  }
  if (req.nextUrl.searchParams.get('correo') === '1') {
    const { sendEmail } = await import('@/lib/email')
    const resultado = await sendEmail({
      to: user.email,
      subject: 'Prueba de correo — MembeGo',
      text: 'Si estás leyendo esto, el envío de correos de tu plataforma funciona correctamente.',
    })
    return NextResponse.json({ ...base, correoPrueba: { destinatario: user.email, ...resultado } })
  }
  if (req.nextUrl.searchParams.get('probar') !== '1' || !base.configurado) {
    return NextResponse.json(base)
  }
  const prueba = await probarSesionTokens()
  return NextResponse.json({ ...base, prueba })
}

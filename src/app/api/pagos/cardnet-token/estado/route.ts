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
 * Uso: entra logueado a /api/pagos/cardnet-token/estado?probar=1 en el mismo
 * deploy que estás probando.
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
  }
  if (req.nextUrl.searchParams.get('probar') !== '1' || !base.configurado) {
    return NextResponse.json(base)
  }
  const prueba = await probarSesionTokens()
  return NextResponse.json({ ...base, prueba })
}

import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { cardnetTokensConfigurado } from '@/lib/payments/cardnet-tokens'

export const dynamic = 'force-dynamic'

/**
 * DIAGNÓSTICO (no cobra ni expone secretos): dice si ESTE deploy ve las llaves
 * de la pasarela de tarjeta. Sirve para depurar por qué no aparece el botón.
 * Devuelve solo booleanos de presencia — NUNCA el valor de las llaves.
 *
 * Uso: entra logueado a /api/pagos/cardnet-token/estado en el mismo deploy que
 * estás probando.
 */
export async function GET() {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Inicia sesión para ver el estado.' }, { status: 401 })
  }
  return NextResponse.json({
    configurado: cardnetTokensConfigurado(),
    publicKeyPresente: Boolean(process.env.CARDNET_TOKENS_PUBLIC_KEY?.trim()),
    privateKeyPresente: Boolean(process.env.CARDNET_TOKENS_PRIVATE_KEY?.trim()),
    ambiente: process.env.CARDNET_TOKENS_AMBIENTE ?? '(sin definir)',
  })
}

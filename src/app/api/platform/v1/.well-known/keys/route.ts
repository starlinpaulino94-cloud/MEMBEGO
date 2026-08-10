import { NextResponse } from 'next/server'
import { getPlatformEventPrivateKey } from '@/lib/env'
import { VENTANA_REPLAY_SEGUNDOS, clavePrivadaDesde, clavePublicaPem } from '@/modules/plataforma/firma'

export const dynamic = 'force-dynamic'

/**
 * GET /api/platform/v1/.well-known/keys — clave pública de los eventos.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PÚBLICO A PROPÓSITO, Y ES EL ÚNICO ENDPOINT QUE LO ES
 *
 * Una clave pública es pública: eso no es una concesión, es su definición. Y
 * pedir un token para obtenerla crearía un círculo — el satélite necesitaría
 * credenciales antes de poder verificar el primer webhook, que es justo lo que
 * llega antes de que nadie configure nada.
 *
 * De la privada no sale nada por aquí: `clavePublicaPem` deriva la pública y
 * exporta solo eso.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SIRVE TAMBIÉN PARA ROTAR
 *
 * Un satélite que lea la clave de aquí (con caché propia) se entera de una
 * rotación sin que nadie le mande un correo. Uno que la copie a su `.env` no.
 * Por eso se publica el `Cache-Control` explícito: una hora es poco para
 * castigar a nadie y suficiente para que una rotación se propague sola.
 */
export function GET() {
  const pem = clavePublicaPem(clavePrivadaDesde(getPlatformEventPrivateKey()))

  if (!pem) {
    // Sin clave configurada los eventos van firmados solo con HMAC. Se dice, en
    // vez de devolver un 404 que parecería un despliegue roto.
    return NextResponse.json(
      {
        keys: [],
        algorithm: null,
        note: 'Ed25519 signing is not configured on this deployment; events carry the legacy HMAC signature only.',
      },
      { headers: { 'Cache-Control': 'public, max-age=60' } }
    )
  }

  return NextResponse.json(
    {
      keys: [{ kid: 'membego-events', alg: 'Ed25519', use: 'sig', publicKeyPem: pem }],
      algorithm: 'Ed25519',
      signedHeaders: {
        signature: 'X-Membego-Signature',
        timestamp: 'X-Membego-Timestamp',
        eventId: 'X-Membego-Event-Id',
      },
      /** Lo que se firma, escrito para que no haya que adivinarlo. */
      signedMaterial: '{timestamp}.{eventId}.{rawBody}',
      replayWindowSeconds: VENTANA_REPLAY_SEGUNDOS,
    },
    { headers: { 'Cache-Control': 'public, max-age=3600' } }
  )
}

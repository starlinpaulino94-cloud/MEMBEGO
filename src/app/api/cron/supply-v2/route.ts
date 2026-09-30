import { NextResponse, type NextRequest } from 'next/server'
import { autorizarCron } from '@/lib/cron-auth'
import { barridoSupplyV2 } from '@/modules/supply-v2/commerce/barrido'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * CRON DE MEMBEGO SUPPLY 2.0 (§64).
 *
 * Mismo mecanismo que el resto de crons (`autorizarCron` + `vercel.json`):
 * expira checkouts con la reserva caducada, activa ofertas programadas y
 * finaliza ofertas vencidas liberando lo no usado. Idempotente: correrlo dos
 * veces no mueve nada dos veces.
 *
 * Vercel lo dispara una vez al día (el plan Hobby no admite crons más
 * frecuentes), pero el stock NO depende de él: cada checkout expira primero,
 * bajo el candado de la oferta, las reservas caducadas de esa oferta
 * (`expirarCaducadasDeOfertaEnTx`), y el cliente ya no puede avisar un pago
 * con la reserva vencida (`avisarPagoEnTx`). El barrido diario solo recoge lo
 * que ningún checkout tocó y cierra/activa ofertas por vigencia.
 */
export async function GET(req: NextRequest) {
  const denegado = autorizarCron(req)
  if (denegado) return denegado
  const resultado = await barridoSupplyV2()
  return NextResponse.json({ ok: true, ...resultado, at: new Date().toISOString() })
}

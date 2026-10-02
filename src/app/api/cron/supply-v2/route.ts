import { NextResponse, type NextRequest } from 'next/server'
import { autorizarCron } from '@/lib/cron-auth'
import { barridoSupplyV2 } from '@/modules/supply-v2/commerce/barrido'
import { despacharEfectos, recuperarArriendos } from '@/modules/supply-v2/operations/worker'

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
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SLICE 9 · LA RED DE SEGURIDAD DEL OUTBOX
 *
 * Desde el bloque 2 este cron hace dos cosas más, y ninguna es el camino
 * normal: el camino normal es que la propia petición del webhook despache su
 * efecto en segundos. Esto es lo que recoge lo que ese camino no pudo.
 *
 *   · `recuperarArriendos` — filas que un worker reclamó y no terminó (el
 *     proceso murió entre reclamar y entregar). Sin esto, ese efecto no lo
 *     mira nadie nunca más.
 *   · `despacharEfectos`  — lo que quedó PENDING o reprogramado: un fallo al
 *     encolar, o un reintento cuya hora ya llegó.
 *
 * Primero el rescate y después el despacho, en ese orden a propósito: lo que
 * se acaba de rescatar queda disponible y se lleva en la misma pasada.
 *
 * No se reimplementa ninguna cola: `despacharEfectos` publica en la de
 * siempre (`modules/jobs/cola.ts`).
 */
export async function GET(req: NextRequest) {
  const denegado = autorizarCron(req)
  if (denegado) return denegado
  const ctx = { actorId: null, ipAddress: null, userAgent: 'cron:supply-v2' }
  const resultado = await barridoSupplyV2()
  const rescate = await recuperarArriendos(ctx)
  const despacho = await despacharEfectos(ctx, 100)
  return NextResponse.json({
    ok: true,
    ...resultado,
    outbox: {
      rescatados: rescate.recuperados.length,
      muertos: rescate.muertos.length,
      encolados: despacho.encolados.length,
      devueltos: despacho.devueltos.length,
    },
    at: new Date().toISOString(),
  })
}

import { NextResponse, type NextRequest } from 'next/server'
import { autorizarCron } from '@/lib/cron-auth'
import { barridoSupplyV2 } from '@/modules/supply-v2/commerce/barrido'
import { despacharEfectos, recuperarArriendos } from '@/modules/supply-v2/operations/worker'
import { barrerConciliacionDePagos } from '@/modules/supply-v2/operations/barrido-conciliacion'
import { evaluarYGuardarAlertas } from '@/modules/supply-v2/operations/alertas'
import { evaluarAutomatizaciones } from '@/modules/supply-v2/notifications/automatizaciones'
import { emitirMetricasOperativas } from '@/modules/supply-v2/operations/metricas'
import { capacidadActiva } from '@/modules/supply-v2/operations/flags'

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

  // ── SLICE 9 · BLOQUE 4 · el resto del trabajo operativo ──────────────────
  //
  // Orden deliberado, y cada paso respeta su interruptor:
  //
  //   1. RESCATAR arriendos abandonados, para que lo que un worker muerto dejó
  //      reclamado vuelva a estar disponible antes de despachar.
  //   2. DESPACHAR el outbox: lo recién rescatado se va en la misma pasada.
  //   3. CONCILIAR lo reciente: detecta desacuerdos que el webhook no vio
  //      —un aviso perdido, una orden cancelada después de pagarse—.
  //   4. EVALUAR alertas AL FINAL, cuando las cifras ya reflejan lo que acaba
  //      de hacerse. Evaluarlas primero avisaría de un atraso que esta misma
  //      pasada estaba a punto de resolver.
  //
  // Los cuatro son IDEMPOTENTES y toleran retraso: el plan puede ejecutar el
  // cron una vez al día, así que cada uno procesa el acumulado y se puede
  // volver a correr sin consecuencias dobles.
  const entregaActiva = await capacidadActiva('SUPPLY_V2_OUTBOX_DELIVERY')
  const rescate = entregaActiva ? await recuperarArriendos(ctx) : { recuperados: [], muertos: [] }
  const despacho = entregaActiva ? await despacharEfectos(ctx, 200) : { encolados: [], devueltos: [] }

  const conciliacion = (await capacidadActiva('SUPPLY_V2_RECONCILIATION_SWEEP'))
    ? await barrerConciliacionDePagos(ctx)
    : null

  const alertas = await evaluarYGuardarAlertas(ctx)

  // ── SLICE 9 · BLOQUE 5 · automatizaciones y los avisos que generan ───────
  //
  // Van DESPUÉS de las alertas y antes de un último despacho, y el orden
  // importa:
  //
  //   5. EVALUAR automatizaciones: membresías y beneficios por vencer, y el
  //      estado operativo. Aquí ya se sabe qué quedó sin resolver en esta
  //      pasada, así que un aviso de «hay efectos sin salida» cuenta los que
  //      de verdad quedaron, no los que el paso 2 estaba a punto de entregar.
  //   6. DESPACHAR otra vez: los avisos que la automatización acaba de apuntar
  //      salen en ESTA pasada y no mañana. Sin este segundo despacho, un plan
  //      con cron diario tardaría un día en mandar un aviso de vencimiento que
  //      avisa con tres.
  //
  // Las dos respetan sus interruptores y son idempotentes: la clave de
  // deduplicación lleva el día dentro y la columna es única, así que correr el
  // cron dos veces el mismo día deja UN aviso porque lo impide la base.
  // Las MÉTRICAS se emiten al final, con las cifras ya asentadas. No se
  // guardan en la base: son un evento estructurado que el recolector cuenta.
  const metricas = await emitirMetricasOperativas()

  const automatizacionesActivas = await capacidadActiva('SUPPLY_V2_AUTOMATIONS')
  const automatizaciones = automatizacionesActivas ? await evaluarAutomatizaciones(ctx) : null
  const despachoDeAvisos =
    automatizaciones && entregaActiva ? await despacharEfectos(ctx, 200) : { encolados: [], devueltos: [] }

  return NextResponse.json({
    ok: true,
    ...resultado,
    outbox: {
      activo: entregaActiva,
      rescatados: rescate.recuperados.length,
      muertos: rescate.muertos.length,
      encolados: despacho.encolados.length,
      devueltos: despacho.devueltos.length,
    },
    conciliacion: conciliacion
      ? {
          revisados: conciliacion.revisados,
          cuadraron: conciliacion.cuadraron,
          discrepancias: conciliacion.discrepancias,
          incidentesAbiertos: conciliacion.incidentesAbiertos.length,
        }
      : { activo: false },
    alertas: {
      activas: alertas.activas,
      nuevas: alertas.nuevas.length,
      resueltas: alertas.resueltas.length,
    },
    metricas: metricas ? { emitidas: true, readiness: metricas.readiness_status } : { emitidas: false },
    automatizaciones: automatizaciones
      ? {
          activo: true,
          reglas: automatizaciones.reglas,
          avisosEncolados: despachoDeAvisos.encolados.length,
          avisosDevueltos: despachoDeAvisos.devueltos.length,
        }
      : { activo: false },
    at: new Date().toISOString(),
  })
}

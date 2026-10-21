import { NextResponse, type NextRequest } from 'next/server'
import { autorizarCron } from '@/lib/cron-auth'
import { ejecutarRenovacionesTarjeta } from '@/modules/pagos/cardnetTokenGuardado'
import { ejecutarAvisosDeRenovacion } from '@/modules/pagos/avisosRenovacion'
import { conciliarRenovacionesDudosas } from '@/modules/pagos/conciliarRenovacion'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Fase 2 CardNET: cron de renovaciones automáticas con tarjeta guardada.
 * Cobra las membresías ACTIVA con `autoRenovar` y tarjeta activa que están por
 * vencer, y las extiende. Idempotente (ver `renovarMembresiaPorTarjeta`).
 *
 * Tres pasos, EN ESTE ORDEN:
 *
 *  0. Conciliar los cobros dudosos de días anteriores preguntándole a CardNET
 *     (`conciliarRenovacionesDudosas`). Va primero: uno que CardNET confirma
 *     como rechazado deja de bloquear, y el cobro de hoy lo puede reintentar.
 *  1. Avisos previos. Antes de cobrar, para que el aviso de la renovación de
 *     hoy exista cuando el cobro de hoy lo busque (quien aceptó un texto que
 *     promete aviso no se cobra sin él).
 *  2. Cobros.
 *
 * Cada paso tiene su propio resumen y un fallo en el primero no detiene el
 * segundo: lo que más importa de este cron es el resumen de los cobros, sobre
 * todo `bloqueadas` e `inciertas` (cobros que pudieron haber salido y que nadie
 * repetirá solos).
 *
 * Protegido con CRON_SECRET (igual que /api/cron/automatizaciones). Llamar con
 * `Authorization: Bearer <CRON_SECRET>`. Programado a diario en vercel.json.
 */
export async function GET(request: NextRequest) {
  const denegado = autorizarCron(request)
  if (denegado) return denegado

  try {
    const conciliacion = await conciliarRenovacionesDudosas().catch((e) => {
      console.error('[cron-renovaciones-tarjeta] conciliación', e)
      return null
    })
    // Un fallo en los avisos NO detiene los cobros: sin aviso, quien aceptó un
    // texto que lo promete se omite solo (y se cuenta en `sinAviso`); el resto
    // sigue como siempre.
    const avisos = await ejecutarAvisosDeRenovacion().catch((e) => {
      console.error('[cron-renovaciones-tarjeta] avisos', e)
      return null
    })
    const resumen = await ejecutarRenovacionesTarjeta()
    return NextResponse.json({ ok: true, ...resumen, avisos, conciliacion })
  } catch (e) {
    console.error('[cron-renovaciones-tarjeta]', e)
    return NextResponse.json({ error: 'Error interno.' }, { status: 500 })
  }
}

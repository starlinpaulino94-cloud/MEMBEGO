import { NextResponse, type NextRequest } from 'next/server'
import { autorizarCron } from '@/lib/cron-auth'
import { soltarHoldsVencidos } from '@/modules/supply/derechos'
import { alertasDeVencimiento, cerrarVencidos, umbralDelDia } from '@/modules/supply/vencimientos'
import { conciliar } from '@/modules/supply/conciliacion'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * CRON DE MEMBEGO SUPPLY.
 *
 * Tres trabajos, en este orden y por esta razón:
 *
 *  1. SOLTAR HOLDS CADUCADOS. Un carrito abandonado retiene una unidad. Sin
 *     este barrido el lote se «agota» sin haber entregado nada, y la siguiente
 *     persona ve «se acabó» sobre unidades que nadie compró.
 *
 *  2. CERRAR LO VENCIDO. Derechos, vouchers, lotes y contratos cuya fecha pasó.
 *     Esto NO es una decisión: es reconocer un hecho. Dejarlo abierto haría que
 *     el pool prometiera unidades que ningún proveedor está obligado a cumplir.
 *
 *  3. MIRAR LO QUE VA A VENCER y lo que no cuadra. Aquí el cron solo INFORMA:
 *     extender un contrato o pedir un reembolso son conversaciones con una
 *     empresa, y un cron que las ejecute solo acaba mandando peticiones que
 *     nadie negoció.
 *
 * Idempotente: correrlo dos veces el mismo día no cierra nada dos veces —los
 * barridos filtran por estado— ni duplica asientos en el ledger.
 */
export async function GET(req: NextRequest) {
  const denegado = autorizarCron(req)
  if (denegado) return denegado

  const holdsLiberados = await soltarHoldsVencidos(300)
  const cierre = await cerrarVencidos()

  // Solo los lotes que hoy CRUZAN un umbral (30, 14, 7, 3, 1 días). Avisar
  // todos los días durante un mes hace que el aviso deje de leerse a la semana,
  // que es peor que no avisar.
  const alertas = await alertasDeVencimiento(30)
  const enUmbral = alertas.filter((a) => umbralDelDia(a.diasRestantes) !== null)
  const exposicion = enUmbral.reduce((t, a) => t + a.exposicionFinanciera, 0)

  // La conciliación corre aquí porque un descuadre detectado tres semanas
  // después ya contaminó reportes y liquidaciones. Se reporta, no se arregla:
  // recalcular un lote a espaldas de nadie escondería la causa.
  const conciliacion = await conciliar(undefined, 100)

  return NextResponse.json({
    ok: true,
    holdsLiberados,
    cierre,
    porVencer: {
      lotes: enUmbral.length,
      unidades: enUmbral.reduce((t, a) => t + a.enRiesgo + a.expuestas, 0),
      exposicionFinanciera: Number(exposicion.toFixed(2)),
      criticos: enUmbral.filter((a) => a.nivel === 'CRITICO').length,
    },
    conciliacion: {
      lotesRevisados: conciliacion.lotesRevisados,
      criticos: conciliacion.criticos,
      altos: conciliacion.altos,
      medios: conciliacion.medios,
    },
  })
}

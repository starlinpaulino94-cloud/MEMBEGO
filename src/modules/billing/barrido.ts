import 'server-only'

import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import {
  SISTEMA,
  generarCortesPendientesEnTx,
  registrarComisionDePedidoEnTx,
  reevaluarEstadoEnTx,
} from './service'

/**
 * COMMERCE CORE · Merchant Billing — BARRIDO del cron (Fase 4).
 *
 * Tres cosas, empresa por empresa y cada una en su propia transacción (una que
 * falle no frena a las demás):
 *
 *  1. COMISIONES QUE FALTAN. El cierre de un pedido cobra su comisión en la misma
 *     transacción, así que esto es una red de seguridad: un pedido completado que
 *     por cualquier razón quedó sin comisión (código anterior a la Fase 4, un
 *     error ya corregido) la recibe aquí. Solo mira los últimos `DIAS_DE_REVISION`
 *     días: lo más viejo no se cobra solo, lo decide una persona con un ajuste.
 *  2. GRACIAS VENCIDAS. Una cuenta en gracia cuyo plazo venció con el saldo aún por
 *     encima del límite pasa a SUSPENDED.
 *  3. CORTES. Emite el estado de cuenta de cada periodo cerrado que falte.
 *
 * Idempotente: correrlo dos veces no cobra ni corta nada dos veces.
 */

/** Hasta cuándo hacia atrás busca pedidos completados sin comisión. */
export const DIAS_DE_REVISION = 45

/** Tope de elementos por pasada: lo que sobre lo recoge la siguiente. */
const MAX_PEDIDOS = 200
const MAX_EMPRESAS = 500

export interface ResultadoBarridoFacturacion {
  comisionesCreadas: number
  gracias: number
  suspendidas: number
  cortes: number
  errores: number
}

/** Qué partes del barrido correr (todas por defecto): para pruebas y para operaciones puntuales. */
export interface OpcionesBarridoFacturacion {
  comisiones?: boolean
  gracias?: boolean
  cortes?: boolean
}

export async function barridoFacturacion(ahora: Date = new Date(), opciones: OpcionesBarridoFacturacion = {}): Promise<ResultadoBarridoFacturacion> {
  const { comisiones = true, gracias = true, cortes = true } = opciones
  const r: ResultadoBarridoFacturacion = { comisionesCreadas: 0, gracias: 0, suspendidas: 0, cortes: 0, errores: 0 }
  const desde = new Date(ahora.getTime() - DIAS_DE_REVISION * 86_400_000)

  // 1 · pedidos completados sin comisión
  const huerfanos = !comisiones ? [] : await sinEmpresa('barrido de Merchant Billing: pedidos completados sin comisión (recorre empresa por empresa)', (tx) =>
    tx.membegoOrder.findMany({
      where: { status: 'COMPLETED', origin: 'MARKETPLACE', completedAt: { gte: desde }, commission: null },
      select: { id: true, companyId: true },
      orderBy: [{ completedAt: 'asc' }, { id: 'asc' }],
      take: MAX_PEDIDOS,
    })
  )
  for (const { id, companyId } of huerfanos) {
    try {
      await conEmpresa(companyId, async (tx) => {
        // Candado del pedido (mismo orden que el cierre: pedido → cuenta) y lectura ya bloqueada.
        await tx.$queryRaw`SELECT "id" FROM "membego_orders" WHERE "id" = ${id} AND "companyId" = ${companyId} FOR UPDATE`
        const p = await tx.membegoOrder.findFirst({
          where: { id, companyId, status: 'COMPLETED' },
          select: { id: true, code: true, origin: true, sourceType: true, commissionableBase: true, verificationLevel: true, currency: true },
        })
        if (!p) return
        const c = await registrarComisionDePedidoEnTx(tx, companyId, p, SISTEMA, ahora)
        if (c.resultado === 'CREADA') r.comisionesCreadas++
      })
    } catch (e) {
      r.errores++
      console.error('[billing:barrido] comisión', id, e instanceof Error ? e.message : e)
    }
  }

  // 2 · gracias vencidas
  const enGracia = !gracias ? [] : await sinEmpresa('barrido de Merchant Billing: cuentas en gracia vencida', (tx) =>
    tx.merchantBillingConfig.findMany({
      where: { status: 'GRACE_PERIOD', holdManual: false, graceUntil: { lte: ahora } },
      select: { companyId: true },
      orderBy: { graceUntil: 'asc' },
      take: MAX_EMPRESAS,
    })
  )
  for (const { companyId } of enGracia) {
    try {
      const x = await conEmpresa(companyId, (tx) => reevaluarEstadoEnTx(tx, companyId, ahora))
      if (x.cambio && x.a === 'SUSPENDED') r.suspendidas++
      else if (x.cambio && x.a === 'GRACE_PERIOD') r.gracias++
    } catch (e) {
      r.errores++
      console.error('[billing:barrido] gracia', companyId, e instanceof Error ? e.message : e)
    }
  }

  // 3 · cortes
  const empresas = !cortes ? [] : await sinEmpresa('barrido de Merchant Billing: empresas con cuenta (recorre empresa por empresa)', (tx) =>
    tx.merchantBillingConfig.findMany({ select: { companyId: true }, orderBy: { companyId: 'asc' }, take: MAX_EMPRESAS })
  )
  for (const { companyId } of empresas) {
    try {
      const x = await conEmpresa(companyId, (tx) => generarCortesPendientesEnTx(tx, companyId, ahora))
      r.cortes += x.generados
    } catch (e) {
      r.errores++
      console.error('[billing:barrido] cortes', companyId, e instanceof Error ? e.message : e)
    }
  }
  return r
}

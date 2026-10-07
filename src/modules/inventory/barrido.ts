import 'server-only'

import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { vencerReservasEnTx } from './service'

/**
 * COMMERCE CORE · inventario — BARRIDO del cron (Fase 2).
 *
 * Vence las reservas cuya hora pasó, empresa por empresa. El stock NO depende de
 * este barrido: cada operación sobre un saldo vence antes, bajo el mismo
 * candado, las reservas caducadas de ese saldo (`service.ts`). El barrido solo
 * recoge lo que nadie volvió a tocar, para que `reserved` no quede inflado en un
 * saldo parado y las pantallas cuenten lo mismo que el ledger.
 *
 * Idempotente: una segunda pasada no encuentra nada que repetir (cada paso
 * filtra por `status = ACTIVE`). Cada empresa va en su propia transacción: un
 * fallo en una no deshace las demás.
 */

export interface ResultadoBarridoInventario {
  empresas: number
  reservasVencidas: number
  /** Empresas cuyo barrido falló (el detalle queda en el log). */
  empresasConError: number
}

/** Tope de empresas por pasada: lo que sobre lo recoge la siguiente. */
const MAX_EMPRESAS = 200

export async function barridoInventario(ahora: Date = new Date()): Promise<ResultadoBarridoInventario> {
  const filas = await sinEmpresa('barrido de reservas de inventario vencidas (recorre empresa por empresa)', (tx) =>
    tx.inventoryReservation.findMany({
      where: { status: 'ACTIVE', expiresAt: { lte: ahora } },
      select: { companyId: true },
      distinct: ['companyId'],
      take: MAX_EMPRESAS,
    })
  )
  let reservasVencidas = 0
  let empresasConError = 0
  for (const { companyId } of filas) {
    try {
      reservasVencidas += await conEmpresa(companyId, (tx) => vencerReservasEnTx(tx, companyId, ahora))
    } catch (e) {
      empresasConError++
      console.error('[inventario:barrido]', companyId, e instanceof Error ? e.message : e)
    }
  }
  return { empresas: filas.length, reservasVencidas, empresasConError }
}

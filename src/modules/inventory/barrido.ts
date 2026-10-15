import 'server-only'

import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { vencerLotesEnTx, vencerReservasEnTx } from './service'

/**
 * COMMERCE CORE · inventario — BARRIDO del cron (Fase 2).
 *
 * Vence las reservas cuya hora pasó, empresa por empresa. El stock NO depende de
 * este barrido: cada operación sobre un saldo vence antes, bajo el mismo
 * candado, las reservas caducadas de ese saldo (`service.ts`). El barrido solo
 * recoge lo que nadie volvió a tocar, para que `reserved` no quede inflado en un
 * saldo parado y las pantallas cuenten lo mismo que el ledger.
 *
 * INV-5a · También saca de lo vendible los LOTES VENCIDOS (pasan a dañado, motivo «Vencido»). Tampoco depende de esto la venta
 * (FEFO no vende lo vencido aunque nadie haya barrido), pero sin barrer, `disponible` seguiría contando lo que ya no se puede vender.
 *
 * Idempotente: una segunda pasada no encuentra nada que repetir (cada paso
 * filtra por `status = ACTIVE`). Cada empresa va en su propia transacción: un
 * fallo en una no deshace las demás.
 */

export interface ResultadoBarridoInventario {
  empresas: number
  reservasVencidas: number
  /** INV-5a: lotes vencidos cuyas unidades disponibles se sacaron de lo vendible, y cuántas unidades fueron. */
  lotesVencidos: number
  unidadesVencidas: number
  /** Empresas cuyo barrido falló (el detalle queda en el log). */
  empresasConError: number
}

/** Tope de empresas por pasada: lo que sobre lo recoge la siguiente. */
const MAX_EMPRESAS = 200

export async function barridoInventario(ahora: Date = new Date()): Promise<ResultadoBarridoInventario> {
  const { conReservas, conLotes } = await sinEmpresa('barrido de reservas y lotes de inventario vencidos (recorre empresa por empresa)', async (tx) => ({
    conReservas: await tx.inventoryReservation.findMany({
      where: { status: 'ACTIVE', expiresAt: { lte: ahora } },
      select: { companyId: true },
      distinct: ['companyId'],
      take: MAX_EMPRESAS,
    }),
    // Las empresas que llevan lotes (y que tienen alguno ya vencido en algún huso: un día de margen sobre el instante de ahora).
    conLotes: await tx.inventoryLot.findMany({
      where: { expiresOn: { lt: new Date(ahora.getTime() + 86_400_000) }, balances: { some: { onHand: { gt: 0 } } } },
      select: { companyId: true },
      distinct: ['companyId'],
      take: MAX_EMPRESAS,
    }),
  }))
  const empresas = [...new Set([...conReservas, ...conLotes].map((f) => f.companyId))].slice(0, MAX_EMPRESAS)
  let reservasVencidas = 0
  let lotesVencidos = 0
  let unidadesVencidas = 0
  let empresasConError = 0
  for (const companyId of empresas) {
    try {
      // Cada paso en su transacción: que un lote no pueda vencerse no deja sin vencer las reservas de esa empresa.
      reservasVencidas += await conEmpresa(companyId, (tx) => vencerReservasEnTx(tx, companyId, ahora))
      const lotes = await conEmpresa(companyId, (tx) => vencerLotesEnTx(tx, companyId, ahora))
      lotesVencidos += lotes.lotes
      unidadesVencidas += lotes.unidades
    } catch (e) {
      empresasConError++
      console.error('[inventario:barrido]', companyId, e instanceof Error ? e.message : e)
    }
  }
  return { empresas: empresas.length, reservasVencidas, lotesVencidos, unidadesVencidas, empresasConError }
}

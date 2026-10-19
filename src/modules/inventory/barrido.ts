import 'server-only'

import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { avisarVencimientos } from './avisos'
import { vencerLotesEnTx, vencerReservasEnTx } from './service'
import { VENTANA_POR_DEFECTO } from './vencimientos'

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
 * INV-5b1 · Y avisa a los administradores de lo que vence pronto y de lo que acaba de vencer (`avisarVencimientos`: una vez por semana y
 * nivel el primero, una vez por día el segundo). Por eso recorre también las empresas con lotes que vencen dentro de la ventana de aviso,
 * no solo las que ya tienen alguno vencido.
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
  /** INV-5b1: avisos de lotes por vencer o vencidos que se crearon (los repetidos no cuentan). */
  avisosDeVencimiento: number
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
    // Las empresas que llevan lotes con algo que vence dentro de la ventana de aviso (o ya venció), con un día de margen por los husos.
    conLotes: await tx.inventoryLot.findMany({
      where: { expiresOn: { lt: new Date(ahora.getTime() + (VENTANA_POR_DEFECTO + 1) * 86_400_000) }, balances: { some: { onHand: { gt: 0 } } } },
      select: { companyId: true },
      distinct: ['companyId'],
      take: MAX_EMPRESAS,
    }),
  }))
  const empresas = [...new Set([...conReservas, ...conLotes].map((f) => f.companyId))].slice(0, MAX_EMPRESAS)
  let reservasVencidas = 0
  let lotesVencidos = 0
  let unidadesVencidas = 0
  let avisosDeVencimiento = 0
  let empresasConError = 0
  for (const companyId of empresas) {
    try {
      // Cada paso en su transacción: que un lote no pueda vencerse no deja sin vencer las reservas de esa empresa.
      reservasVencidas += await conEmpresa(companyId, (tx) => vencerReservasEnTx(tx, companyId, ahora))
      const lotes = await conEmpresa(companyId, (tx) => vencerLotesEnTx(tx, companyId, ahora))
      lotesVencidos += lotes.lotes
      unidadesVencidas += lotes.unidades
      // Después de barrer: lo que acaba de vencer y lo que vence pronto (best-effort: no lanza).
      avisosDeVencimiento += await avisarVencimientos(companyId, { ahora, ...(lotes.unidades > 0 ? { vencidos: lotes } : {}) })
    } catch (e) {
      empresasConError++
      console.error('[inventario:barrido]', companyId, e instanceof Error ? e.message : e)
    }
  }
  return { empresas: empresas.length, reservasVencidas, lotesVencidos, unidadesVencidas, avisosDeVencimiento, empresasConError }
}

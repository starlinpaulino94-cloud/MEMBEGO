import 'server-only'

import { revalidateTag } from 'next/cache'
import { sinEmpresa } from '@/lib/tenant'
import { MARKETPLACE_TAG } from '@/modules/marketplace/cached'
import { archivarPuenteEnTx, casaMembegoEnTx, sincronizarOfertaEnTx, type ResultadoSincronizacion } from './service'
import { FUENTE_SUPPLY, envolverCompraEnTx, reflejarReembolsoEnTx } from './pedido'

/**
 * SUPPLY BRIDGE · cuándo se sincroniza (Fase 2.5).
 *
 * Dos caminos, y el segundo es la red de seguridad del primero:
 *
 *  1. TRAS CADA CAMBIO de una oferta (publicar, editar, pausar, reanudar,
 *     finalizar, cancelar), de inmediato y sin bloquear la respuesta:
 *     `sincronizarOfertaMejorEsfuerzo`. Si falla, no tumba la acción de Supply
 *     —la oferta ya se guardó—: queda en el log y lo recoge el barrido.
 *  2. EL BARRIDO DEL CRON, que recorre todas las ofertas no borrador y
 *     reconcilia lo que el primer camino no alcanzó (un fallo, una venta que
 *     agotó la oferta, una oferta que venció sola).
 *
 * El público no depende de ninguno de los dos para lo urgente: cruza el ítem
 * con la oferta EN VIVO (estado y vigencia), así que una oferta agotada o
 * vencida deja de enseñarse aunque la sincronización todavía no haya corrido.
 */

export interface ResultadoBarridoPuente {
  /** false si no hay empresa de la casa: no se sincroniza nada y lo puente se archiva. */
  hayCasa: boolean
  ofertas: number
  creados: number
  actualizados: number
  sinCambios: number
  conflictos: number
  archivados: number
  errores: number
  /** Fase 3: compras de Supply pagadas que ya tienen su pedido (las de esta pasada). */
  pedidosCreados: number
  /** Compras que aún no se pudieron envolver (falta el ítem puente o una sucursal en la casa). */
  pedidosPendientes: number
  pedidosReembolsados: number
}

/** Compras que una pasada envuelve como máximo: el resto queda para la siguiente (el cron es diario). */
export const MAX_COMPRAS_POR_PASADA = 200
/** Intentos como máximo por pasada, envolviera o no: una compra que no se puede envolver (aún) no frena a las demás. */
export const MAX_INTENTOS_POR_PASADA = 2000
const TAMANO_LOTE = 200

const CAMBIAN: ReadonlySet<ResultadoSincronizacion['resultado']> = new Set(['CREADO', 'ACTUALIZADO'])

/** Una oferta, tras un cambio. Nunca lanza. Invalida la caché del marketplace si algo cambió. */
export async function sincronizarOfertaMejorEsfuerzo(offerId: string): Promise<ResultadoSincronizacion | null> {
  try {
    const r = await sinEmpresa('puente Supply→Catálogo: sincronizar una oferta tras un cambio', (tx) => sincronizarOfertaEnTx(tx, offerId))
    if (CAMBIAN.has(r.resultado)) revalidateTag(MARKETPLACE_TAG, 'max')
    return r
  } catch (e) {
    console.error('[supply-bridge]', offerId, e instanceof Error ? e.message : e)
    return null
  }
}

/** Toda la reconciliación (cron y botón «Sincronizar ahora»). Cada oferta en su propia transacción. */
export interface OpcionesBarrido {
  /**
   * Solo envolver las compras pagadas desde esta fecha. Por defecto, todas: la primera
   * pasada tras designar la casa pone al día el historial, de a `MAX_COMPRAS_POR_PASADA`.
   */
  comprasDesde?: Date
}

export async function barridoPuente(opciones: OpcionesBarrido = {}): Promise<ResultadoBarridoPuente> {
  const casa = await sinEmpresa('puente Supply→Catálogo: empresa de la casa', (tx) => casaMembegoEnTx(tx))
  const base: ResultadoBarridoPuente = { hayCasa: !!casa, ofertas: 0, creados: 0, actualizados: 0, sinCambios: 0, conflictos: 0, archivados: 0, errores: 0, pedidosCreados: 0, pedidosPendientes: 0, pedidosReembolsados: 0 }
  if (!casa) {
    base.archivados = await sinEmpresa('puente Supply→Catálogo: sin casa, archivar lo puente', (tx) => archivarPuenteEnTx(tx))
    if (base.archivados > 0) revalidateTag(MARKETPLACE_TAG, 'max')
    return base
  }
  const ofertas = await sinEmpresa('puente Supply→Catálogo: ofertas a reconciliar', (tx) =>
    tx.supplyV2Offer.findMany({ where: { status: { not: 'DRAFT' } }, select: { id: true }, orderBy: { id: 'asc' } })
  )
  base.ofertas = ofertas.length
  for (const { id } of ofertas) {
    try {
      const r = await sinEmpresa('puente Supply→Catálogo: reconciliar una oferta', (tx) => sincronizarOfertaEnTx(tx, id))
      if (r.resultado === 'CREADO') base.creados++
      else if (r.resultado === 'ACTUALIZADO') base.actualizados++
      else if (r.resultado === 'SIN_CAMBIOS') base.sinCambios++
      else if (r.resultado === 'CONFLICTO') base.conflictos++
    } catch (e) {
      base.errores++
      console.error('[supply-bridge:barrido]', id, e instanceof Error ? e.message : e)
    }
  }
  if (base.creados + base.actualizados > 0) revalidateTag(MARKETPLACE_TAG, 'max')

  // Fase 3: DESPUÉS de sincronizar las ofertas (el envoltorio necesita su ítem puente).
  await envolverCompras(casa.id, base, opciones.comprasDesde)
  return base
}

/**
 * Envuelve en un pedido las compras de Supply pagadas que aún no lo tienen, y
 * refleja los reembolsos. Cada compra va en su propia transacción: una que falle
 * no frena a las demás.
 *
 * Se recorre con un cursor (fecha de pago, id) y el tope cuenta las compras
 * ENVUELTAS, no las intentadas: una compra que no se puede envolver todavía (su
 * oferta aún no está en el catálogo de la casa, o la casa no tiene sucursal)
 * se salta y no deja sin atender a las que vienen detrás.
 */
async function envolverCompras(casaId: string, base: ResultadoBarridoPuente, desde: Date | undefined): Promise<void> {
  try {
    let cursor: { paidAt: Date | null; id: string } | null = null
    let envueltas = 0
    let intentos = 0
    while (envueltas < MAX_COMPRAS_POR_PASADA && intentos < MAX_INTENTOS_POR_PASADA) {
      const antes = cursor
      const lote: { id: string; paidAt: Date | null }[] = await sinEmpresa('puente Supply→Pedidos: compras por envolver', (tx) =>
        tx.$queryRaw<{ id: string; paidAt: Date | null }[]>`
          SELECT o."id", o."paidAt" FROM "supply_v2_customer_orders" o
           WHERE o."status" = 'PAID' AND o."kind" = 'OFFER'
             AND NOT EXISTS (SELECT 1 FROM "membego_orders" m WHERE m."companyId" = ${casaId} AND m."sourceType" = ${FUENTE_SUPPLY} AND m."sourceId" = o."id")
             AND (${desde === undefined}::boolean OR o."paidAt" >= ${desde ?? null}::timestamp)
             AND (${antes === null}::boolean OR (coalesce(o."paidAt", 'epoch'::timestamp), o."id") > (coalesce(${antes?.paidAt ?? null}::timestamp, 'epoch'::timestamp), ${antes?.id ?? ''}))
           ORDER BY coalesce(o."paidAt", 'epoch'::timestamp) ASC, o."id" ASC
           LIMIT ${TAMANO_LOTE}`
      )
      if (lote.length === 0) break
      for (const { id, paidAt } of lote) {
        cursor = { paidAt, id }
        intentos++
        try {
          const r = await sinEmpresa('puente Supply→Pedidos: envolver una compra', (tx) => envolverCompraEnTx(tx, id))
          if (r.estado === 'CREADO') {
            base.pedidosCreados++
            envueltas++
          } else if (r.estado === 'SIN_ITEM' || r.estado === 'SIN_SUCURSAL') base.pedidosPendientes++
        } catch (e) {
          base.errores++
          console.error('[supply-bridge:pedidos]', id, e instanceof Error ? e.message : e)
        }
        if (envueltas >= MAX_COMPRAS_POR_PASADA || intentos >= MAX_INTENTOS_POR_PASADA) break
      }
      if (lote.length < TAMANO_LOTE) break
    }

    const reembolsadas = await sinEmpresa('puente Supply→Pedidos: reembolsos por reflejar', (tx) =>
      tx.$queryRaw<{ id: string }[]>`
        SELECT o."id" FROM "supply_v2_customer_orders" o
          JOIN "membego_orders" m ON m."companyId" = ${casaId} AND m."sourceType" = ${FUENTE_SUPPLY} AND m."sourceId" = o."id"
         WHERE o."status" = 'REFUNDED' AND m."status" = 'COMPLETED'
         ORDER BY o."id" ASC
         LIMIT ${MAX_COMPRAS_POR_PASADA}`
    )
    for (const { id } of reembolsadas) {
      try {
        if (await sinEmpresa('puente Supply→Pedidos: reflejar un reembolso', (tx) => reflejarReembolsoEnTx(tx, id))) base.pedidosReembolsados++
      } catch (e) {
        base.errores++
        console.error('[supply-bridge:reembolsos]', id, e instanceof Error ? e.message : e)
      }
    }
  } catch (e) {
    base.errores++
    console.error('[supply-bridge:pedidos]', e instanceof Error ? e.message : e)
  }
}

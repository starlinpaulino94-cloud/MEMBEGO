import 'server-only'

import { revalidateTag } from 'next/cache'
import { sinEmpresa } from '@/lib/tenant'
import { MARKETPLACE_TAG } from '@/modules/marketplace/cached'
import { archivarPuenteEnTx, casaMembegoEnTx, sincronizarOfertaEnTx, type ResultadoSincronizacion } from './service'

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
}

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
export async function barridoPuente(): Promise<ResultadoBarridoPuente> {
  const casa = await sinEmpresa('puente Supply→Catálogo: empresa de la casa', (tx) => casaMembegoEnTx(tx))
  const base: ResultadoBarridoPuente = { hayCasa: !!casa, ofertas: 0, creados: 0, actualizados: 0, sinCambios: 0, conflictos: 0, archivados: 0, errores: 0 }
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
  return base
}

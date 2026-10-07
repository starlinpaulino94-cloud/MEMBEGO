import 'server-only'

import { revalidateTag } from 'next/cache'
import { sinEmpresa } from '@/lib/tenant'
import { MARKETPLACE_TAG } from '@/modules/marketplace/cached'
import { sincronizarOfertaEnTx, type ResultadoSincronizacion } from './service'

/**
 * SUPPLY BRIDGE · la sincronización de UNA oferta tras un cambio (Fase 2.5).
 *
 * Vive APARTE de `barrido.ts` a propósito: Supply V2 la llama (`actions-ofertas.ts`, dentro
 * de `after()`) y `barrido.ts` importa el envoltorio de pedidos (`pedido.ts` →
 * `orders/service` → inventario y billing). Con las dos cosas juntas, Supply arrastraba
 * transitivamente todo el Commerce Core, contra la regla «Supply no importa del Core»
 * (hallazgo M9 de la auditoría del 2026-10-07). Este archivo solo depende de `service.ts`
 * (que lee Supply por su read model público) y del tag de la caché; lo vigila
 * `tests/supply-bridge.test.ts`.
 */

export const CAMBIAN: ReadonlySet<ResultadoSincronizacion['resultado']> = new Set(['CREADO', 'ACTUALIZADO'])

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

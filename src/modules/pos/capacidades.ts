import { tieneCapacidad } from '@/modules/capacidades/resolver'

/**
 * POS CONECTADO · qué puede hacer la caja de una empresa (Fase 7). Fail-closed: ante la duda, no.
 *
 *  · Cobrar un pedido Membego en la caja: la caja (`POS_CAJA`), el POS conectado (`POS_MEMBEGO`) y los
 *    pedidos (`PEDIDOS_MEMBEGO`).
 *  · Vender en el mostrador: la caja, el POS conectado y el catálogo (`CATALOGO_UNIFICADO`, de donde salen
 *    las variantes y sus existencias).
 *
 * Esto decide qué se ENSEÑA y qué acepta el servidor; las acciones lo comprueban por su cuenta.
 */
export interface PosPermitido {
  cobrarPedidos: boolean
  venderEnMostrador: boolean
}

export async function posPermitido(companyId: string): Promise<PosPermitido> {
  const [caja, pos, pedidos, catalogo] = await Promise.all([
    tieneCapacidad(companyId, 'POS_CAJA'),
    tieneCapacidad(companyId, 'POS_MEMBEGO'),
    tieneCapacidad(companyId, 'PEDIDOS_MEMBEGO'),
    tieneCapacidad(companyId, 'CATALOGO_UNIFICADO'),
  ])
  return { cobrarPedidos: caja && pos && pedidos, venderEnMostrador: caja && pos && catalogo }
}

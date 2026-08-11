import 'server-only'

import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import type { Prisma } from '@prisma/client'
import {
  whereCambiosDePlan,
  whereComprasEnSucursal,
  whereComprasEnValidacion,
  whereComprasSinCompletar,
  whereMembresiasEnSucursal,
  whereMembresiasSinCompletar,
  whereTransferencias,
} from '@/modules/pagos/colas'

/**
 * El RECUENTO de las colas. Las condiciones —qué es cada cola— viven en
 * `colas.ts`, que se prueba sin base de datos; aquí solo están las consultas.
 */

// ── Recuento ────────────────────────────────────────────────────────────────

export interface ConteoColasPago {
  /** Cobros iniciados en el local pendientes de confirmar en caja. */
  sucursal: number
  /** Transferencias con comprobante enviado. */
  transferencias: number
  /** Compras de promociones en validación. */
  compras: number
  /** Cambios de plan solicitados. */
  cambios: number
  /** Empezaron y no completaron: NO cuenta como «por validar». */
  seguimiento: number
  /** La suma de las cuatro colas de trabajo real. El número del Resumen. */
  porValidar: number
}

const VACIO: ConteoColasPago = {
  sucursal: 0,
  transferencias: 0,
  compras: 0,
  cambios: 0,
  seguimiento: 0,
  porValidar: 0,
}

/**
 * Recuento de las cinco colas. Lo usan el Resumen (para el aviso) y la pantalla
 * de Pagos (para las pestañas), de modo que el número del aviso es literalmente
 * el mismo que el de la pantalla a la que lleva.
 *
 * Cada consulta cae a 0 por separado ante un fallo: un recuento de menos es
 * preferible a una pantalla que no carga, y el aviso de error de la pantalla de
 * pagos sigue siendo el que informa del problema.
 */
export async function contarColasDePago(
  companyId: string | null | undefined
): Promise<ConteoColasPago> {
  const cero = () => 0
  const correr = async (tx: {
    membership: { count: (a: { where: Prisma.MembershipWhereInput }) => Promise<number> }
    productoCompra: { count: (a: { where: Prisma.ProductoCompraWhereInput }) => Promise<number> }
  }): Promise<ConteoColasPago> => {
    const [
      sucursalMembresias,
      sucursalCompras,
      transferencias,
      compras,
      cambios,
      seguimientoMembresias,
      seguimientoCompras,
    ] = await Promise.all([
      tx.membership.count({ where: whereMembresiasEnSucursal(companyId) }).catch(cero),
      tx.productoCompra.count({ where: whereComprasEnSucursal(companyId) }).catch(cero),
      tx.membership.count({ where: whereTransferencias(companyId) }).catch(cero),
      tx.productoCompra.count({ where: whereComprasEnValidacion(companyId) }).catch(cero),
      tx.membership.count({ where: whereCambiosDePlan(companyId) }).catch(cero),
      tx.membership.count({ where: whereMembresiasSinCompletar(companyId) }).catch(cero),
      tx.productoCompra.count({ where: whereComprasSinCompletar(companyId) }).catch(cero),
    ])
    const sucursal = sucursalMembresias + sucursalCompras
    return {
      sucursal,
      transferencias,
      compras,
      cambios,
      seguimiento: seguimientoMembresias + seguimientoCompras,
      porValidar: sucursal + transferencias + compras + cambios,
    }
  }

  try {
    return companyId
      ? await conEmpresa(companyId, correr)
      : await sinEmpresa('pagos: colas de toda la plataforma', correr)
  } catch (e) {
    console.error('[pagos/colas] contar', e)
    return VACIO
  }
}

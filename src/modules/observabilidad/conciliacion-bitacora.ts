import 'server-only'

import type { Tx } from '@/lib/tenant'
import { MARGEN_DE_ENTREGA_MS } from '@/modules/observabilidad/conciliacion-entrega'

/**
 * ¿QUÉ DICE LA BITÁCORA DE LA ENTREGA DE ESTOS COBROS? — la evidencia que no cambia con el tiempo.
 *
 * `activarMembresia` y `activarCompraPromocion` anotan `PAGO_APROBADO` (con la membresía o la compra como entidad) en la
 * misma transacción en que activan el producto. Esa línea no se toca después: cuando la membresía vence, se vuelve a pedir
 * o se borra con la cuenta del cliente, la bitácora sigue diciendo que el producto se activó y cuándo.
 *
 * Dos formas de casar un cobro con su activación:
 *
 *  · el cobro sigue apuntando a su membresía o compra → la activación de ESA entidad a partir del cobro;
 *  · el producto se borró (la relación quedó en nulo) → la activación AUTOMÁTICA (sin usuario: la hizo el cobro, no un
 *    administrador) de la misma empresa en el minuto siguiente al cobro. La ventana es estrecha a propósito: la entrega
 *    de la pasarela ocurre en la misma petición, en menos de un segundo, y quien cierre el caso ve la demora.
 *
 * Solo LEE. Devuelve, por id de cobro, la fecha de la primera activación que lo respalda.
 */

export interface CobroParaEvidencia {
  id: string
  companyId: string
  activadoAt: Date | null
  membershipId: string | null
  compraId: string | null
}

/** Ventana para casar un cobro cuyo producto ya no existe con una activación automática. */
export const VENTANA_SIN_PRODUCTO_MS = 60_000

const ENTIDADES = ['Membership', 'ProductoCompra'] as const

export async function activacionesEnBitacora(tx: Tx, cobros: readonly CobroParaEvidencia[]): Promise<Map<string, Date>> {
  const resultado = new Map<string, Date>()
  const conFecha = cobros.filter((c): c is CobroParaEvidencia & { activadoAt: Date } => c.activadoAt != null)
  if (conFecha.length === 0) return resultado

  const enlazados = conFecha.filter((c) => c.membershipId || c.compraId)
  const huerfanos = conFecha.filter((c) => !c.membershipId && !c.compraId)
  const entidades = [...new Set(enlazados.map((c) => (c.membershipId ?? c.compraId) as string))]
  const desdeEnlazados = enlazados.length
    ? new Date(Math.min(...enlazados.map((c) => c.activadoAt.getTime())) - MARGEN_DE_ENTREGA_MS)
    : null

  const OR = [
    ...(entidades.length && desdeEnlazados
      ? [{ entidadTipo: { in: [...ENTIDADES] }, entidadId: { in: entidades }, createdAt: { gte: desdeEnlazados } }]
      : []),
    ...huerfanos.map((c) => ({
      companyId: c.companyId,
      userId: null,
      entidadTipo: { in: [...ENTIDADES] },
      createdAt: { gte: new Date(c.activadoAt.getTime() - MARGEN_DE_ENTREGA_MS), lte: new Date(c.activadoAt.getTime() + VENTANA_SIN_PRODUCTO_MS) },
    })),
  ]
  if (OR.length === 0) return resultado

  const filas = await tx.auditLog.findMany({
    where: { accion: 'PAGO_APROBADO', OR },
    select: { companyId: true, userId: true, entidadTipo: true, entidadId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })

  for (const c of conFecha) {
    const desde = c.activadoAt.getTime() - MARGEN_DE_ENTREGA_MS
    const entidad = c.membershipId ?? c.compraId
    const hasta = entidad ? Infinity : c.activadoAt.getTime() + VENTANA_SIN_PRODUCTO_MS
    // `filas` viene en orden: la primera que casa es la activación más cercana al cobro.
    const fila = filas.find((f) => {
      const t = f.createdAt.getTime()
      if (t < desde || t > hasta) return false
      if (entidad) return f.entidadId === entidad
      return f.companyId === c.companyId && f.userId == null && (ENTIDADES as readonly string[]).includes(f.entidadTipo)
    })
    if (fila) resultado.set(c.id, fila.createdAt)
  }
  return resultado
}

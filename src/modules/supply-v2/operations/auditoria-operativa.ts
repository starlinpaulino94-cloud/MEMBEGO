import type { AuditAccion, Prisma } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 9 · BLOQUE 4 · AUDITAR UNA ACCIÓN DEL PANEL (§24).
 *
 * Un ayudante de una línea para auditar fuera de una transacción de dominio,
 * que es el caso de las acciones del panel: la conciliación manual ya hizo su
 * trabajo en sus propias transacciones y lo que queda es dejar constancia de
 * que una persona la lanzó.
 *
 * Se audita lo que CAMBIA algo: tocar un interruptor, lanzar una conciliación,
 * reconocer una alerta, reintentar un difunto (esa ya tenía su acción propia en
 * la cola y se reutiliza). No se audita la LECTURA: un panel que registra cada
 * mirada llena la bitácora de ruido y esconde las decisiones, que es lo que
 * alguien va a buscar dentro de tres semanas.
 */
export async function auditarOperacion(
  ctx: ContextoAuditoria,
  accion: AuditAccion,
  entidad: string,
  entidadId: string,
  payload: Prisma.InputJsonValue
): Promise<void> {
  await sinEmpresa('Supply 2.0: auditar una acción del centro de operaciones', (tx) =>
    auditarEnTx(tx, ctx, accion, entidad, entidadId, payload, null)
  )
}

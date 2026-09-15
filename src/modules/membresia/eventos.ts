import 'server-only'
import type { Prisma } from '@prisma/client'
import { anotarFallo } from '@/lib/prisma-errors'
import type { TipoEventoMembresia, OrigenEventoMembresia } from '@/modules/membresia/eventosNucleo'

export type { TipoEventoMembresia, OrigenEventoMembresia, ClaseCambioPlan } from '@/modules/membresia/eventosNucleo'
export { clasificarCambioPlan } from '@/modules/membresia/eventosNucleo'

/**
 * LA HISTORIA DE UNA MEMBRESÍA — un sitio para escribirla.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ PROBLEMA RESUELVE
 *
 * `Membership` guarda su ESTADO. Mirando la fila se sabe que hoy está
 * CANCELADA; nunca cuándo se activó, cuántas veces se renovó, si subió o bajó
 * de plan, ni quién la cortó. Los reportes de ciclo de vida no eran difíciles:
 * eran imposibles, porque el dato no se escribía en ningún sitio.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO NO TUMBA UNA VENTA SI FALLA
 *
 * Se escribe best-effort: si el `create` revienta, se anota el fallo y la
 * operación de negocio sigue. Es la misma decisión —y por el mismo motivo— que
 * `auditarPlan` en `modules/admin/planActions.ts`: en este proyecto las
 * migraciones se aplican a mano, así que el código puede llegar a producción
 * antes que su tabla. Si el evento fuera parte de la transacción, durante esa
 * ventana PostgreSQL rechazaría la escritura y se llevaría por delante el
 * cobro, la renovación o la cancelación que la produjo. Cancelar una membresía
 * no puede fallar porque una tabla de reportes no exista todavía.
 *
 * El coste es real y conviene decirlo: mientras falte la tabla, no hay
 * historia. Por eso los reportes de la Fase 3 leen `reconstruido` y la fecha
 * del primer evento para decir hasta dónde llega el dato — nunca dan por
 * completo un periodo que no lo está.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LOS PRECIOS SE COPIAN, NO SE MIRAN DESPUÉS
 *
 * Un cambio de plan se clasifica en subida o bajada comparando importes. Si el
 * reporte leyera los precios de HOY, un plan que subió de precio el mes pasado
 * convertiría retroactivamente en bajadas los cambios que fueron subidas. Por
 * eso el evento guarda los dos importes del momento, y `clasificarCambioPlan`
 * solo mira lo guardado.
 */

type Tx = Prisma.TransactionClient

export interface EntradaEventoMembresia {
  companyId: string
  membershipId: string
  clienteId: string
  tipo: TipoEventoMembresia
  origen: OrigenEventoMembresia
  estadoAnterior?: string | null
  estadoNuevo?: string | null
  planAnteriorId?: string | null
  planNuevoId?: string | null
  precioAnterior?: number | null
  precioNuevo?: number | null
  /** Dinero movido por ESTE evento. `null` no es cero: es «no era de dinero». */
  monto?: number | null
  motivo?: string | null
  /** Null cuando lo hizo un proceso. */
  actorUserId?: string | null
  /** Cuándo pasó de verdad. Por defecto, ahora. */
  ocurridoEn?: Date
  payload?: Prisma.InputJsonObject
}

/**
 * Escribe un evento. Nunca lanza.
 *
 * Recibe la `tx` de quien lo llama para ir dentro de su misma transacción
 * cuando la hay: el evento y el cambio que lo produjo se guardan juntos o no
 * se guarda ninguno de los dos —salvo que el `create` falle, y ahí gana el
 * cambio de negocio, como explica la cabecera—.
 */
export async function registrarEventoMembresia(
  tx: Tx,
  entrada: EntradaEventoMembresia
): Promise<void> {
  await tx.membresiaEvento
    .create({
      data: {
        companyId: entrada.companyId,
        membershipId: entrada.membershipId,
        clienteId: entrada.clienteId,
        tipo: entrada.tipo,
        origen: entrada.origen,
        estadoAnterior: entrada.estadoAnterior ?? null,
        estadoNuevo: entrada.estadoNuevo ?? null,
        planAnteriorId: entrada.planAnteriorId ?? null,
        planNuevoId: entrada.planNuevoId ?? null,
        precioAnterior: entrada.precioAnterior ?? null,
        precioNuevo: entrada.precioNuevo ?? null,
        monto: entrada.monto ?? null,
        motivo: entrada.motivo ?? null,
        actorUserId: entrada.actorUserId ?? null,
        ocurridoEn: entrada.ocurridoEn ?? new Date(),
        payload: entrada.payload ?? {},
      },
    })
    .then(() => undefined)
    .catch(anotarFallo('membresia:evento', { tipo: entrada.tipo }))
}

import 'server-only'
import type { Prisma } from '@prisma/client'
import { anotarFallo } from '@/lib/prisma-errors'
import { emitirEventoEstrategia } from '@/modules/estrategias/eventos'
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

/**
 * Qué eventos del ciclo de vida de la membresía SALEN al bus de integraciones
 * (B-4), con su nombre interno.
 *
 * `ACTIVADA` NO está aquí: ya la emite el punto de activación (`pagos/activacion`)
 * con su payload rico (cliente + membresía). Estas dos son las que faltaban: la
 * baja se registraba en la historia de la membresía pero nunca llegaba a un
 * satélite ni a un webhook, así que una proyección se quedaba diciendo «activa»
 * una membresía ya cancelada o vencida.
 */
const BUS_POR_TIPO: Partial<Record<TipoEventoMembresia, string>> = {
  CANCELADA: 'membresia.cancelada',
  VENCIDA: 'membresia.vencida',
}

/**
 * Avisa al bus de que una membresía cambió de estado (B-4). Va FUERA de la
 * transacción que hizo el cambio y NUNCA lanza: el bus no puede convertir un
 * fallo de aviso en un fallo de la cancelación, que ya está escrita. Un `tipo`
 * que no sale al bus (una renovación, un cambio de plan) no hace nada.
 *
 * Se manda lo mínimo que una proyección necesita para marcar la baja: el id de
 * la membresía y el nuevo estado. El `subjectId` es el cliente, así que el sobre
 * ya lleva su `customerId`.
 */
export async function emitirCambioMembresiaAlBus(input: {
  tipo: TipoEventoMembresia
  companyId: string
  clienteId: string
  membershipId: string
  planId?: string | null
  motivo?: string | null
}): Promise<void> {
  const type = BUS_POR_TIPO[input.tipo]
  if (!type) return
  await emitirEventoEstrategia({
    companyId: input.companyId,
    type,
    subjectId: input.clienteId,
    payload: {
      membresia: {
        id: input.membershipId,
        planId: input.planId ?? null,
        estado: input.tipo,
        ...(input.motivo ? { motivo: input.motivo } : {}),
      },
    },
  })
}

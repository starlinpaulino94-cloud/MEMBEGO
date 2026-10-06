import { sinEmpresa, type Tx } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { confirmarPagoEnTx } from '../commerce/checkout'
import { rolPuede } from '../contracts/adapters'
import { fallo } from '../core/errores'
import { emitirEfectoEnTx } from './outbox'
import { RESOLUCIONES, exigeServicioFinanciero, type Resolucion } from './conciliacion-dominio'
import { anotarSupply } from './log'

/**
 * MEMBEGO SUPPLY · SLICE 9 · BLOQUE 3 · QUIÉN DECIDE, Y CÓMO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS RESPONSABILIDADES QUE NO SE MEZCLAN (§12)
 *
 *   La cuenta de la INTEGRACIÓN procesa eventos. Nada más.
 *   Una PERSONA autorizada investiga y resuelve. Nada menos.
 *
 * Y se comprueba, no se confía: la cuenta del webhook no puede resolver un
 * incidente ni aunque alguien le pase su id. Si pudiera, el sistema tendría un
 * actor capaz de detectar una discrepancia y cerrarla él mismo, que es
 * exactamente la figura que la segregación existe para impedir.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * «ACEPTAR LO EXTERNO» NO ES UN UPDATE
 *
 * `ACCEPT_EXTERNAL` significa «la evidencia de la pasarela es correcta». Mover
 * el dinero es otra cosa, y la hace quien sabe hacerla: `confirmarPagoEnTx`,
 * con su candado sobre la orden, su validación de importe, su emisión de
 * derechos, su reconocimiento económico y su bitácora. Un `UPDATE` directo a
 * `paymentStatus` desde aquí saltaría las cinco cosas y dejaría una compra
 * pagada sin derechos —un cliente que pagó y no recibe nada—.
 */

/** Lo que el permiso exige. Se resuelve contra el rol, como el resto de Supply. */
const PERMISO_RESOLVER = 'SUPPLY_V2_PAYMENT_INCIDENT_RESOLVE' as const

export interface ResolucionPedida {
  incidentId: string
  resolucion: Resolucion
  /** Obligatoria. Sin explicación no hay resolución. */
  nota: string
  /**
   * Para `ACCEPT_EXTERNAL`: el importe que la evidencia externa respalda. Va
   * explícito y no se toma del incidente a propósito —quien autoriza el cobro
   * tiene que escribir la cifra que está autorizando—.
   */
  montoExterno?: string | null
}

export interface ResultadoResolucion {
  id: string
  estaba: string
  resolucion: Resolucion
  /** true si ya estaba resuelto: resolver dos veces no hace nada dos veces. */
  repetido: boolean
  /** Lo que se ejecutó, cuando la resolución implicaba mover dinero. */
  pagoConfirmado: boolean
}

/**
 * PASO 1 · ALGUIEN LO ESTÁ MIRANDO.
 *
 * `OPEN → INVESTIGATING`. Existe para que dos personas no investiguen lo mismo
 * sin saberlo y para distinguir un incidente parado de uno que nadie abrió.
 */
export async function marcarInvestigandoEnTx(tx: Tx, incidentId: string, ctx: ContextoAuditoria): Promise<{ id: string; estaba: string }> {
  const actor = await exigirPersonaAutorizada(tx, ctx)
  const i = await incidenteBloqueado(tx, incidentId)
  if (i.status === 'RESOLVED') fallo('INCIDENTE_RESUELTO', 'Ese incidente ya está resuelto.')
  if (i.status === 'INVESTIGATING') return { id: i.id, estaba: i.status }

  await tx.supplyV2FinanceIncident.update({ where: { id: i.id }, data: { status: 'INVESTIGATING' } })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_FINANCE_INCIDENT_INVESTIGATING', 'SupplyV2FinanceIncident', i.id, {
    reasonCode: i.reasonCode,
    provider: i.provider,
    orderId: i.orderId,
    correlationId: i.correlationId,
    actorId: actor,
  }, null)
  return { id: i.id, estaba: i.status }
}

/**
 * PASO 2 · RESOLVERLO.
 *
 * Una sola transacción para las dos cosas que tienen que ser atómicas: el
 * incidente queda cerrado Y, si la resolución lo pedía, el servicio financiero
 * oficial ya corrió. Cerrar el incidente sin ejecutar el cobro dejaría una
 * compra sin pagar y a nadie mirándola; ejecutar el cobro sin cerrar el
 * incidente lo dejaría abierto para siempre.
 */
export async function resolverIncidenteDePagoEnTx(
  tx: Tx,
  d: ResolucionPedida,
  ctx: ContextoAuditoria
): Promise<ResultadoResolucion> {
  const actor = await exigirPersonaAutorizada(tx, ctx)
  const nota = d.nota?.trim()
  if (!nota) fallo('MOTIVO_OBLIGATORIO', 'Resolver un incidente exige explicar cómo se resolvió.')

  const i = await incidenteBloqueado(tx, d.incidentId)
  if (i.type !== 'EXTERNAL_PAYMENT_MISMATCH') {
    fallo('INCIDENTE_DE_OTRO_TIPO', 'Ese incidente no es de un pago externo: se resuelve por su propio camino.')
  }
  if (i.status === 'RESOLVED') {
    // Idempotente: el segundo de dos humanos simultáneos ve el estado final y
    // NO se ejecuta una segunda corrección.
    return { id: i.id, estaba: i.status, resolucion: (i.resolution ?? d.resolucion) as Resolucion, repetido: true, pagoConfirmado: false }
  }

  let pagoConfirmado = false
  if (exigeServicioFinanciero(d.resolucion)) {
    pagoConfirmado = await ejecutarCobroAutorizadoEnTx(tx, i, d, ctx)
  }

  await tx.supplyV2FinanceIncident.update({
    where: { id: i.id },
    data: {
      status: 'RESOLVED',
      resolution: d.resolucion,
      resolvedById: actor,
      resolvedAt: new Date(),
      resolutionNotes: nota,
    },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_FINANCE_INCIDENT_RESOLVED', 'SupplyV2FinanceIncident', i.id, {
    type: i.type,
    reasonCode: i.reasonCode,
    resolution: d.resolucion,
    amount: i.amount.toFixed(2),
    orderId: i.orderId,
    correlationId: i.correlationId,
    pagoConfirmado,
    notas: nota,
  }, null)

  anotarSupply({
    event: 'incidente_resuelto',
    provider: i.provider,
    externalEventId: i.externalTransactionId,
    correlationId: i.correlationId,
    inboxId: i.externalEventRowId,
    status: d.resolucion,
  })

  return { id: i.id, estaba: i.status, resolucion: d.resolucion, repetido: false, pagoConfirmado }
}

/** La misma cosa en su propia transacción, para quien no tenga una abierta. */
export async function resolverIncidenteDePago(d: ResolucionPedida, ctx: ContextoAuditoria): Promise<ResultadoResolucion> {
  return sinEmpresa('Supply: resolver un incidente de pago externo', (tx) => resolverIncidenteDePagoEnTx(tx, d, ctx))
}

export async function marcarInvestigando(incidentId: string, ctx: ContextoAuditoria) {
  return sinEmpresa('Supply: marcar un incidente en investigación', (tx) => marcarInvestigandoEnTx(tx, incidentId, ctx))
}

// ── Internos ────────────────────────────────────────────────────────────────

/**
 * ACEPTAR LA EVIDENCIA EXTERNA → EJECUTAR EL SERVICIO OFICIAL.
 *
 * No se decide aquí si el cobro es legítimo: eso lo decidió la persona que
 * resuelve. Lo que se hace aquí es ejecutarlo POR EL CAMINO BUENO, de modo que
 * la compra acabe exactamente como si el pago se hubiera confirmado por el
 * flujo normal: derechos emitidos, economía reconocida, bitácora puesta y el
 * efecto apuntado en el outbox para que el cliente reciba su aviso.
 */
async function ejecutarCobroAutorizadoEnTx(
  tx: Tx,
  i: IncidenteBloqueado,
  d: ResolucionPedida,
  ctx: ContextoAuditoria
): Promise<boolean> {
  if (!i.orderId) {
    // Sin compra no hay nada que confirmar, y NO se inventa una. Este incidente
    // se cierra con otra resolución: la corrección manual que haga falta vive
    // fuera de este flujo.
    fallo(
      'SIN_ORDEN_QUE_CONFIRMAR',
      'Ese incidente no apunta a ninguna compra: aceptar la evidencia externa no puede confirmar un pago que no tiene destino.'
    )
  }
  const monto = d.montoExterno?.trim()
  if (!monto) {
    fallo(
      'MONTO_OBLIGATORIO',
      'Aceptar la evidencia externa exige escribir el importe que se está autorizando.'
    )
  }

  // El servicio oficial. Si el importe no cuadra con la compra, FALLA —y debe
  // fallar—: aceptar la evidencia externa no es poder cobrar cualquier cifra.
  const pago = await confirmarPagoEnTx(tx, { orderId: i.orderId, amountSeen: monto }, ctx)
  if (!pago.repetido) {
    await emitirEfectoEnTx(tx, {
      eventType: 'supply.order.paid',
      aggregateType: 'SupplyV2CustomerOrder',
      aggregateId: i.orderId,
      correlationId: i.correlationId ?? `sv2-incidente-${i.id}`,
      payload: { orderNumber: pago.number, origen: 'resolucion_de_incidente', incidentId: i.id },
    })
  }
  return !pago.repetido
}

interface IncidenteBloqueado {
  id: string
  type: string
  status: string
  reasonCode: string | null
  provider: string | null
  externalTransactionId: string | null
  externalEventRowId: string | null
  orderId: string | null
  correlationId: string | null
  resolution: string | null
  amount: { toFixed(n: number): string }
}

/**
 * El incidente, con `FOR UPDATE`.
 *
 * Es lo que hace que dos personas que resuelven a la vez se serialicen: la
 * segunda espera, lee el estado final y se va sin ejecutar una segunda
 * corrección. Sin el candado, las dos leerían OPEN y las dos confirmarían el
 * pago —el segundo `confirmarPagoEnTx` es idempotente, así que no habría doble
 * cobro, pero sí dos resoluciones contradictorias escritas sobre la misma fila—.
 */
async function incidenteBloqueado(tx: Tx, incidentId: string): Promise<IncidenteBloqueado> {
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_finance_incidents" WHERE "id" = ${incidentId} FOR UPDATE`
  const i = await tx.supplyV2FinanceIncident.findUnique({
    where: { id: incidentId },
    select: {
      id: true,
      type: true,
      status: true,
      reasonCode: true,
      provider: true,
      externalTransactionId: true,
      externalEventRowId: true,
      orderId: true,
      correlationId: true,
      resolution: true,
      amount: true,
    },
  })
  if (!i) fallo('INCIDENTE_NO_ENCONTRADO', 'Ese incidente no existe.')
  return i
}

/**
 * QUIÉN PUEDE RESOLVER.
 *
 * Tres comprobaciones, y las tres hacen falta:
 *
 *   1. hay actor —sin nombre no hay resolución—;
 *   2. NO es la cuenta de la integración (§12): quien procesa el webhook no
 *      cierra la investigación sobre lo que él mismo procesó;
 *   3. su rol tiene el permiso, consultado en la base.
 *
 * La tercera va en el servicio y no solo en la acción a propósito: una
 * comprobación que solo vive en la capa de servidor de Next se la salta
 * cualquier otro camino —un cron, un script, una prueba— y los permisos que
 * solo se cumplen por costumbre no son permisos.
 */
async function exigirPersonaAutorizada(tx: Tx, ctx: ContextoAuditoria): Promise<string> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Resolver un incidente necesita quién lo hace.')
  const cuentaDeIntegracion = process.env.SUPPLY_V2_WEBHOOK_ACTOR_ID?.trim()
  if (cuentaDeIntegracion && ctx.actorId === cuentaDeIntegracion) {
    fallo(
      'ACTOR_DE_INTEGRACION',
      'La cuenta con la que corre la integración no puede resolver incidentes: procesar eventos e investigarlos son responsabilidades distintas.'
    )
  }
  const u = await tx.user.findUnique({ where: { id: ctx.actorId }, select: { role: true } })
  if (!u) fallo('ACTOR_DESCONOCIDO', 'Quien intenta resolver no existe como usuario.')
  if (!rolPuede(u.role, PERMISO_RESOLVER)) {
    fallo('SIN_PERMISO', 'Hace falta permiso para resolver incidentes de pago externo.')
  }
  return ctx.actorId
}

export { RESOLUCIONES }

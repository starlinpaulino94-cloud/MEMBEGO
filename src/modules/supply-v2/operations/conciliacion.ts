import type { Prisma } from '@prisma/client'
import { sinEmpresa, type Tx } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { decimal } from '../core/dinero'
import { fallo } from '../core/errores'
import {
  claveDeIncidente,
  diferenciaDeMonto,
  reconciliarEstadoPago,
  veredictoDeTransaccionDuplicada,
  type EstadoExterno,
  type EstadoInterno,
  type Motivo,
  type Veredicto,
} from './conciliacion-dominio'
import { anotarSupply } from './log'

/**
 * MEMBEGO SUPPLY · SLICE 9 · BLOQUE 3 · CONCILIAR Y ABRIR INCIDENTES.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL HUECO QUE ESTO CIERRA
 *
 * Al acabar el bloque 2, un evento que no cuadraba quedaba RECHAZADO con su
 * código, su bitácora y cero efecto financiero. Eso evitaba el daño, pero no
 * dejaba NADA que una persona pudiera trabajar: ni una cola, ni un dueño, ni
 * una severidad, ni una forma de decir «esto ya lo miré y era así». Un rechazo
 * en la bitácora es un hecho; un incidente es una tarea.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS ESCRITURAS, Y NINGUNA MUEVE DINERO
 *
 *   · la COMPROBACIÓN (`supply_v2_payment_reconciliations`): qué se miró, qué
 *     decía cada lado y qué veredicto salió. Se refresca, no se duplica.
 *   · el INCIDENTE (`supply_v2_finance_incidents`): la tarea, cuando el
 *     veredicto es que no cuadran. Idempotente por la identidad del problema.
 *
 * Abrir un incidente NO toca la orden, ni los derechos, ni el ledger. Esa es
 * justamente la propiedad: la discrepancia se convierte en algo investigable
 * **en vez** de en una corrección automática.
 */

/** Lo que se va a comprobar. Todo lo que no se sepa va en null, no inventado. */
export interface AConciliar {
  provider: string
  externalTransactionId?: string | null
  /** La fila del inbox que lo trae, cuando nace de un evento recibido. */
  externalEventRowId?: string | null
  /** Lo que el proveedor dice del pago. */
  externo: { estado: EstadoExterno; monto?: string | number | null; moneda?: string | null }
  /** La compra, cuando se pudo resolver. */
  orderId?: string | null
  correlationId?: string | null
}

export interface ResultadoConciliado {
  reconciliationId: string
  veredicto: Veredicto
  /** El incidente vivo, cuando el veredicto lo pedía. */
  incidentId: string | null
  /** true cuando el incidente ya existía: el mismo problema no se abre dos veces. */
  incidenteRepetido: boolean
}

/**
 * CONCILIAR UN PAGO EXTERNO, dentro de la transacción de quien llama.
 *
 * Va en la transacción del llamador a propósito: cuando esto se llama desde el
 * procesamiento de un evento, el rechazo del evento y el incidente que lo
 * explica tienen que ser la misma escritura. Un rechazo sin su incidente —o un
 * incidente sin su rechazo— es media verdad en la base.
 */
export async function conciliarPagoExternoEnTx(
  tx: Tx,
  d: AConciliar,
  ctx: ContextoAuditoria,
  ahora = new Date()
): Promise<ResultadoConciliado> {
  const provider = d.provider.trim().toUpperCase()

  // ── 1 · nuestro lado, bajo llave ─────────────────────────────────────────
  const orden = d.orderId
    ? await tx.supplyV2CustomerOrder.findUnique({
        where: { id: d.orderId },
        select: {
          id: true,
          number: true,
          status: true,
          total: true,
          currency: true,
          // El proveedor se alcanza por la línea → la oferta. Se toma el de la
          // primera línea y solo para ENRIQUECER el incidente: si no se puede
          // resolver, el incidente se abre igual con `supplierId` nulo, que es
          // justo para lo que el bloque 3 hizo opcional esa columna.
          lines: { select: { offer: { select: { supplierId: true } } }, take: 1 },
        },
      })
    : null

  const interno = {
    estado: (orden ? orden.status : 'UNKNOWN') as EstadoInterno,
    total: orden ? orden.total.toFixed(2) : null,
    moneda: orden?.currency ?? null,
  }

  // ── 2 · ¿esta transacción ya era de OTRA compra? ─────────────────────────
  //
  // Se mira ANTES que la matriz: que los importes cuadren no arregla que un
  // mismo cobro se esté usando dos veces. Es el único caso que no sale de la
  // matriz, porque los dos lados pueden coincidir y seguir siendo grave.
  const duplicada = d.externalTransactionId
    ? await transaccionYaUsadaEnTx(tx, provider, d.externalTransactionId, orden?.id ?? null)
    : null

  const veredicto = duplicada
    ? veredictoDeTransaccionDuplicada(d.externalTransactionId!, duplicada.numero)
    : reconciliarEstadoPago(interno, { estado: d.externo.estado, monto: d.externo.monto ?? null, moneda: d.externo.moneda ?? null })

  // ── 3 · la comprobación queda escrita, cuadre o no ───────────────────────
  const clave = [provider, d.externalTransactionId?.trim() || d.externalEventRowId?.trim() || 'sin-referencia', orden?.id ?? 'sin-orden'].join(':')
  const diferencia = diferenciaDeMonto(interno.total, d.externo.monto ?? null)

  const datos = {
    provider,
    externalTransactionId: d.externalTransactionId?.trim() || null,
    externalEventRowId: d.externalEventRowId ?? null,
    orderId: orden?.id ?? null,
    correlationId: d.correlationId ?? null,
    expectedAmount: interno.total ? decimal(interno.total) : null,
    reportedAmount: montoODecimal(d.externo.monto),
    expectedCurrency: interno.moneda,
    reportedCurrency: d.externo.moneda?.trim().toUpperCase() ?? null,
    differenceAmount: diferencia,
    internalStatus: interno.estado,
    externalStatus: d.externo.estado,
    outcome: veredicto.resultado,
    reasonCode: veredicto.motivo,
    severity: veredicto.severidad,
    checkedAt: ahora,
  }

  const previa = await tx.supplyV2PaymentReconciliation.findUnique({ where: { dedupeKey: clave }, select: { id: true, checks: true } })
  const reconciliacion = previa
    ? await tx.supplyV2PaymentReconciliation.update({
        // La misma comprobación vista otra vez REFRESCA la fila: cinco entregas
        // del mismo webhook no son cinco comprobaciones, son la misma mirada.
        where: { id: previa.id },
        data: { ...datos, checks: previa.checks + 1 },
        select: { id: true },
      })
    : await tx.supplyV2PaymentReconciliation.create({ data: { ...datos, dedupeKey: clave }, select: { id: true } })

  if (!previa) {
    await auditarEnTx(tx, ctx, 'SUPPLY_V2_PAYMENT_RECONCILIATION_CREATED', 'SupplyV2PaymentReconciliation', reconciliacion.id, {
      provider,
      outcome: veredicto.resultado,
      reasonCode: veredicto.motivo,
      orderNumber: orden?.number ?? null,
      correlationId: d.correlationId ?? null,
    }, null)
  }

  anotarSupply({
    event: 'conciliacion',
    provider,
    externalEventId: d.externalTransactionId ?? null,
    correlationId: d.correlationId ?? null,
    inboxId: d.externalEventRowId ?? null,
    status: veredicto.resultado,
    errorCode: veredicto.motivo,
  })

  // ── 4 · si no cuadran, hay tarea ─────────────────────────────────────────
  if (veredicto.resultado !== 'MISMATCH' || !veredicto.motivo) {
    return { reconciliationId: reconciliacion.id, veredicto, incidentId: null, incidenteRepetido: false }
  }

  const incidente = await abrirIncidenteDePagoEnTx(
    tx,
    {
      provider,
      motivo: veredicto.motivo,
      severidad: veredicto.severidad,
      explicacion: veredicto.explicacion,
      externalTransactionId: d.externalTransactionId ?? null,
      externalEventRowId: d.externalEventRowId ?? null,
      orderId: orden?.id ?? null,
      supplierId: orden?.lines[0]?.offer?.supplierId ?? null,
      correlationId: d.correlationId ?? null,
      internalStatus: interno.estado,
      externalStatus: d.externo.estado,
      moneda: interno.moneda ?? d.externo.moneda ?? 'DOP',
      monto: montoODecimal(d.externo.monto) ?? (interno.total ? decimal(interno.total) : decimal(0)),
    },
    ctx
  )

  await tx.supplyV2PaymentReconciliation.update({ where: { id: reconciliacion.id }, data: { incidentId: incidente.id } })

  return {
    reconciliationId: reconciliacion.id,
    veredicto,
    incidentId: incidente.id,
    incidenteRepetido: incidente.repetido,
  }
}

export interface IncidenteDePago {
  provider: string
  motivo: Motivo
  severidad: 'LOW' | 'MEDIUM' | 'HIGH'
  explicacion: string
  externalTransactionId?: string | null
  externalEventRowId?: string | null
  orderId?: string | null
  /** El proveedor de la oferta, si la compra lo tenía. NUNCA uno inventado. */
  supplierId?: string | null
  correlationId?: string | null
  internalStatus?: string | null
  externalStatus?: string | null
  moneda: string
  monto: Prisma.Decimal
}

/**
 * ABRIR —O ENCONTRAR— EL INCIDENTE DE UN PROBLEMA.
 *
 * Idempotente por la identidad del problema (`provider:referencia:orden:motivo`),
 * y por eso cinco entregas del mismo webhook dejan UN incidente. La carrera
 * entre dos detecciones simultáneas la resuelve el índice único con P2002, no
 * una comprobación previa que las dos pasarían.
 *
 * Un incidente YA RESUELTO no se reabre automáticamente: si el problema vuelve
 * a aparecer, la comprobación queda registrada y apunta al incidente cerrado.
 * Reabrirlo solo porque el proveedor repitió el webhook borraría el trabajo de
 * quien lo cerró.
 */
export async function abrirIncidenteDePagoEnTx(
  tx: Tx,
  d: IncidenteDePago,
  ctx: ContextoAuditoria
): Promise<{ id: string; repetido: boolean; status: string }> {
  const dedupeKey = claveDeIncidente({
    provider: d.provider,
    externalTransactionId: d.externalTransactionId,
    externalEventId: d.externalEventRowId,
    orderId: d.orderId,
    motivo: d.motivo,
  })

  const previo = await tx.supplyV2FinanceIncident.findUnique({ where: { dedupeKey }, select: { id: true, status: true } })
  if (previo) return { id: previo.id, repetido: true, status: previo.status }

  try {
    const fila = await tx.supplyV2FinanceIncident.create({
      data: {
        type: 'EXTERNAL_PAYMENT_MISMATCH',
        status: 'OPEN',
        severity: d.severidad,
        reasonCode: d.motivo,
        provider: d.provider,
        externalTransactionId: d.externalTransactionId ?? null,
        externalEventRowId: d.externalEventRowId ?? null,
        orderId: d.orderId ?? null,
        supplierId: d.supplierId ?? null,
        correlationId: d.correlationId ?? null,
        internalStatus: d.internalStatus ?? null,
        externalStatus: d.externalStatus ?? null,
        currency: d.moneda,
        amount: d.monto.abs(),
        notes: d.explicacion,
        dedupeKey,
      },
      select: { id: true, status: true },
    })
    await auditarEnTx(tx, ctx, 'SUPPLY_V2_FINANCE_INCIDENT_CREATED', 'SupplyV2FinanceIncident', fila.id, {
      type: 'EXTERNAL_PAYMENT_MISMATCH',
      reasonCode: d.motivo,
      severity: d.severidad,
      provider: d.provider,
      orderId: d.orderId ?? null,
      correlationId: d.correlationId ?? null,
      amount: d.monto.abs().toFixed(2),
    }, null)
    return { id: fila.id, repetido: false, status: fila.status }
  } catch (err) {
    if (!esClaveDuplicada(err)) throw err
    // Otra detección simultánea ganó. Es la idempotencia funcionando, y la
    // lectura NO puede ir aquí dentro: el INSERT que viola el único abortó esta
    // transacción (lección del bloque 1). Se deja que lo resuelva el llamador.
    fallo('INCIDENTE_YA_ABIERTO', 'Otro proceso abrió este mismo incidente a la vez.')
  }
}

/**
 * La misma cosa, pero en su propia transacción y tolerando la carrera.
 *
 * Existe para quien concilia FUERA de una transacción financiera (el barrido,
 * la conciliación manual): si dos procesos detectan la misma discrepancia a la
 * vez, el que pierde vuelve a leer y devuelve el incidente del que ganó.
 */
export async function conciliarPagoExterno(
  d: AConciliar,
  ctx: ContextoAuditoria,
  ahora = new Date()
): Promise<ResultadoConciliado> {
  try {
    return await sinEmpresa('Supply: conciliar un pago externo', (tx) => conciliarPagoExternoEnTx(tx, d, ctx, ahora))
  } catch (e) {
    if (!esCarreraDeIncidente(e)) throw e
    // El incidente lo abrió otro a la vez. Se vuelve a conciliar: ahora la
    // lectura previa lo encuentra y el resultado es el mismo para los dos.
    return sinEmpresa('Supply: conciliar un pago externo (tras la carrera)', (tx) =>
      conciliarPagoExternoEnTx(tx, d, ctx, ahora)
    )
  }
}

/**
 * ¿Esta transacción del proveedor ya estaba en otra compra?
 *
 * La tabla de comprobaciones es el REGISTRO DE ASOCIACIONES ACEPTADAS: cada
 * pago que cuadró deja una fila `MATCHED` con su transacción y su compra. Por
 * eso basta mirar ahí —y solo las que cuadraron: una comprobación que acabó en
 * desacuerdo no es una asociación buena—.
 *
 * La consulta va dentro de la transacción del llamador, así que dos
 * asociaciones simultáneas se serializan detrás del candado que el procesador
 * ya tomó sobre la orden.
 */
export async function transaccionYaUsadaEnTx(
  tx: Tx,
  provider: string,
  externalTransactionId: string,
  orderIdActual: string | null
): Promise<{ orderId: string; numero: string } | null> {
  const referencia = externalTransactionId.trim()
  if (!referencia) return null

  const previa = await tx.supplyV2PaymentReconciliation.findFirst({
    where: {
      provider,
      externalTransactionId: referencia,
      orderId: { not: null },
      // Solo cuenta como «ya usada» si cuadró: una comprobación que acabó en
      // desacuerdo no es una asociación buena.
      outcome: 'MATCHED',
      ...(orderIdActual ? { NOT: { orderId: orderIdActual } } : {}),
    },
    select: { orderId: true, order: { select: { number: true } } },
    orderBy: { createdAt: 'asc' },
  })
  return previa?.orderId ? { orderId: previa.orderId, numero: previa.order?.number ?? previa.orderId } : null
}

// ── Lectura para el futuro Centro de Operaciones (§26) ──────────────────────

export interface FiltroIncidentes {
  status?: 'OPEN' | 'INVESTIGATING' | 'RESOLVED'
  severity?: 'LOW' | 'MEDIUM' | 'HIGH'
  orderId?: string
  externalTransactionId?: string
  correlationId?: string
  provider?: string
}

/**
 * Los incidentes de pago externo, con todo lo que hace falta para trabajarlos.
 *
 * Sin pantalla todavía, a propósito: primero tiene que haber incidentes reales
 * y consultas estables. Pero las preguntas que el panel va a hacer ya se
 * pueden contestar, y cada una tiene su índice.
 */
export async function incidentesDePago(f: FiltroIncidentes = {}, limite = 50) {
  const where: Prisma.SupplyV2FinanceIncidentWhereInput = {
    type: 'EXTERNAL_PAYMENT_MISMATCH',
    ...(f.status ? { status: f.status } : {}),
    ...(f.severity ? { severity: f.severity } : {}),
    ...(f.orderId ? { orderId: f.orderId } : {}),
    ...(f.externalTransactionId ? { externalTransactionId: f.externalTransactionId } : {}),
    ...(f.correlationId ? { correlationId: f.correlationId } : {}),
    ...(f.provider ? { provider: f.provider.trim().toUpperCase() } : {}),
  }
  return sinEmpresa('Supply: incidentes de pago externo', (tx) =>
    tx.supplyV2FinanceIncident.findMany({
      where,
      orderBy: [{ status: 'asc' }, { severity: 'desc' }, { createdAt: 'desc' }],
      take: limite,
      select: {
        id: true,
        status: true,
        severity: true,
        reasonCode: true,
        provider: true,
        externalTransactionId: true,
        correlationId: true,
        internalStatus: true,
        externalStatus: true,
        currency: true,
        amount: true,
        notes: true,
        resolution: true,
        resolutionNotes: true,
        resolvedAt: true,
        createdAt: true,
        order: { select: { id: true, number: true, status: true, total: true } },
        externalEvent: { select: { id: true, provider: true, externalEventId: true, eventType: true, receivedAt: true } },
        resolvedBy: { select: { name: true, email: true } },
      },
    })
  )
}

/** Cuántos hay por estado y severidad: lo primero que un panel necesita. */
export async function resumenDeIncidentesDePago() {
  const filas = await sinEmpresa('Supply: resumen de incidentes de pago', (tx) =>
    tx.supplyV2FinanceIncident.groupBy({
      by: ['status', 'severity'],
      where: { type: 'EXTERNAL_PAYMENT_MISMATCH' },
      _count: { _all: true },
    })
  )
  return filas.map((f) => ({ status: f.status, severity: f.severity, total: f._count._all }))
}

/** Las comprobaciones de una compra, de una transacción o de un hilo. */
export async function conciliacionesDe(f: {
  orderId?: string
  externalTransactionId?: string
  correlationId?: string
  outcome?: 'MATCHED' | 'MISMATCH' | 'WAITING' | 'IGNORED'
}, limite = 50) {
  return sinEmpresa('Supply: comprobaciones de pago externo', (tx) =>
    tx.supplyV2PaymentReconciliation.findMany({
      where: {
        ...(f.orderId ? { orderId: f.orderId } : {}),
        ...(f.externalTransactionId ? { externalTransactionId: f.externalTransactionId } : {}),
        ...(f.correlationId ? { correlationId: f.correlationId } : {}),
        ...(f.outcome ? { outcome: f.outcome } : {}),
      },
      orderBy: { checkedAt: 'desc' },
      take: limite,
      select: {
        id: true,
        provider: true,
        externalTransactionId: true,
        orderId: true,
        correlationId: true,
        expectedAmount: true,
        reportedAmount: true,
        expectedCurrency: true,
        reportedCurrency: true,
        differenceAmount: true,
        internalStatus: true,
        externalStatus: true,
        outcome: true,
        reasonCode: true,
        severity: true,
        checks: true,
        checkedAt: true,
        incidentId: true,
      },
    })
  )
}

// ── Internos ────────────────────────────────────────────────────────────────

function montoODecimal(v: string | number | null | undefined): Prisma.Decimal | null {
  if (v == null) return null
  try {
    return decimal(v as string)
  } catch {
    return null
  }
}

function esClaveDuplicada(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: unknown }).code
  return code === 'P2002' || code === '23505'
}

function esCarreraDeIncidente(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { codigo?: unknown; code?: unknown }).codigo ?? (err as { code?: unknown }).code
  return code === 'INCIDENTE_YA_ABIERTO' || esClaveDuplicada(err)
}

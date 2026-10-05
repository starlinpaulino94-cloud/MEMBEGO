import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { trabajosMuertosPendientes, type DifuntoPanel } from '@/modules/jobs/muertos'
import { minutosDesde } from './salud-dominio'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 9 · BLOQUE 4 · LAS LISTAS DEL PANEL (§16).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PAGINACIÓN EN EL SERVIDOR, SIEMPRE
 *
 * Cada lista devuelve una página y el total por separado (`count`, no
 * `filas.length`). No hay una sola consulta que se traiga todo para contar o
 * filtrar en JavaScript: el panel se abre precisamente cuando hay mucho
 * acumulado, y ahí traerse las filas es lo que lo rompe.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LOS TRABAJOS DE LA COLA NO SE REIMPLEMENTAN
 *
 * `trabajosMuertosPendientes` ya existe y ya tiene sus acciones de reencolar y
 * descartar, con auditoría. Aquí solo se envuelve.
 */

export interface Pagina<T> {
  filas: T[]
  total: number
  pagina: number
  porPagina: number
}

const POR_PAGINA = 25

function rango(pagina: number, porPagina = POR_PAGINA) {
  const p = Number.isInteger(pagina) && pagina > 0 ? pagina : 1
  return { skip: (p - 1) * porPagina, take: porPagina, pagina: p, porPagina }
}

// ── D · inbox de eventos externos ──────────────────────────────────────────

export interface EventoEnPanel {
  id: string
  provider: string
  externalEventId: string
  eventType: string
  status: string
  attempts: number
  lastError: string | null
  receivedAt: Date
  processedAt: Date | null
  nextAttemptAt: Date | null
  correlationId: string
  orderNumber: string | null
  edadMin: number | null
}

export async function eventosDelInbox(
  f: { status?: string; provider?: string } = {},
  pagina = 1,
  ahora = new Date()
): Promise<Pagina<EventoEnPanel>> {
  const { skip, take, porPagina } = rango(pagina)
  const where: Prisma.SupplyV2ExternalEventWhereInput = {
    ...(f.status ? { status: f.status as Prisma.EnumSupplyV2ExternalEventStatusFilter['equals'] } : {}),
    ...(f.provider ? { provider: f.provider.trim().toUpperCase() } : {}),
  }
  const [filas, total] = await Promise.all([
    prisma.supplyV2ExternalEvent.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      skip,
      take,
      select: {
        id: true, provider: true, externalEventId: true, eventType: true, status: true, attempts: true,
        lastError: true, receivedAt: true, processedAt: true, nextAttemptAt: true, correlationId: true,
        order: { select: { number: true } },
      },
    }),
    prisma.supplyV2ExternalEvent.count({ where }),
  ])
  return {
    filas: filas.map((e) => ({
      id: e.id,
      provider: e.provider,
      externalEventId: e.externalEventId,
      eventType: e.eventType,
      status: e.status,
      attempts: e.attempts,
      lastError: e.lastError,
      receivedAt: e.receivedAt,
      processedAt: e.processedAt,
      nextAttemptAt: e.nextAttemptAt,
      correlationId: e.correlationId,
      orderNumber: e.order?.number ?? null,
      edadMin: minutosDesde(e.receivedAt, ahora),
    })),
    total,
    pagina: rango(pagina).pagina,
    porPagina,
  }
}

// ── E · outbox ─────────────────────────────────────────────────────────────

export interface EfectoEnPanel {
  id: string
  eventType: string
  status: string
  attempts: number
  availableAt: Date
  claimedAt: Date | null
  processedAt: Date | null
  lastError: string | null
  createdAt: Date
  correlationId: string
  aggregateId: string
  orderNumber: string | null
  edadMin: number | null
}

export async function efectosDelOutbox(
  f: { status?: string } = {},
  pagina = 1,
  ahora = new Date()
): Promise<Pagina<EfectoEnPanel>> {
  const { skip, take, porPagina } = rango(pagina)
  const where: Prisma.SupplyV2OutboxEventWhereInput = f.status
    ? { status: f.status as Prisma.EnumSupplyV2OutboxStatusFilter['equals'] }
    : {}
  const [filas, total] = await Promise.all([
    prisma.supplyV2OutboxEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      select: {
        id: true, eventType: true, status: true, attempts: true, availableAt: true, claimedAt: true,
        processedAt: true, lastError: true, createdAt: true, correlationId: true, aggregateId: true,
      },
    }),
    prisma.supplyV2OutboxEvent.count({ where }),
  ])

  // El número de compra se resuelve en UNA consulta por página, no una por
  // fila: `aggregateId` apunta a la compra pero no es una relación de Prisma.
  const ids = [...new Set(filas.map((f2) => f2.aggregateId))]
  const ordenes = ids.length
    ? await prisma.supplyV2CustomerOrder.findMany({ where: { id: { in: ids } }, select: { id: true, number: true } })
    : []
  const numero = new Map(ordenes.map((o) => [o.id, o.number]))

  return {
    filas: filas.map((e) => ({ ...e, orderNumber: numero.get(e.aggregateId) ?? null, edadMin: minutosDesde(e.createdAt, ahora) })),
    total,
    pagina: rango(pagina).pagina,
    porPagina,
  }
}

/** Cuántos hay de cada estado: la fila de contadores del panel, en SQL. */
export async function conteoOutboxPorEstado(): Promise<Record<string, number>> {
  const filas = await prisma.supplyV2OutboxEvent.groupBy({ by: ['status'], _count: { _all: true } })
  return Object.fromEntries(filas.map((f) => [f.status, f._count._all]))
}

export async function conteoInboxPorEstado(): Promise<Record<string, number>> {
  const filas = await prisma.supplyV2ExternalEvent.groupBy({ by: ['status'], _count: { _all: true } })
  return Object.fromEntries(filas.map((f) => [f.status, f._count._all]))
}

// ── C · conciliaciones ─────────────────────────────────────────────────────

export interface ConciliacionEnPanel {
  id: string
  provider: string
  externalTransactionId: string | null
  orderNumber: string | null
  internalStatus: string | null
  externalStatus: string | null
  expectedAmount: string | null
  reportedAmount: string | null
  expectedCurrency: string | null
  reportedCurrency: string | null
  differenceAmount: string | null
  outcome: string
  reasonCode: string | null
  severity: string
  checks: number
  checkedAt: Date
  incidentId: string | null
}

export async function conciliacionesDelPanel(
  f: { outcome?: string; provider?: string } = {},
  pagina = 1
): Promise<Pagina<ConciliacionEnPanel>> {
  const { skip, take, porPagina } = rango(pagina)
  const where: Prisma.SupplyV2PaymentReconciliationWhereInput = {
    ...(f.outcome ? { outcome: f.outcome } : {}),
    ...(f.provider ? { provider: f.provider.trim().toUpperCase() } : {}),
  }
  const [filas, total] = await Promise.all([
    prisma.supplyV2PaymentReconciliation.findMany({
      where,
      orderBy: { checkedAt: 'desc' },
      skip,
      take,
      select: {
        id: true, provider: true, externalTransactionId: true, internalStatus: true, externalStatus: true,
        expectedAmount: true, reportedAmount: true, expectedCurrency: true, reportedCurrency: true,
        differenceAmount: true, outcome: true, reasonCode: true, severity: true, checks: true,
        checkedAt: true, incidentId: true, order: { select: { number: true } },
      },
    }),
    prisma.supplyV2PaymentReconciliation.count({ where }),
  ])
  return {
    filas: filas.map((c) => ({
      id: c.id,
      provider: c.provider,
      externalTransactionId: c.externalTransactionId,
      orderNumber: c.order?.number ?? null,
      internalStatus: c.internalStatus,
      externalStatus: c.externalStatus,
      expectedAmount: c.expectedAmount?.toFixed(2) ?? null,
      reportedAmount: c.reportedAmount?.toFixed(2) ?? null,
      expectedCurrency: c.expectedCurrency,
      reportedCurrency: c.reportedCurrency,
      differenceAmount: c.differenceAmount?.toFixed(2) ?? null,
      outcome: c.outcome,
      reasonCode: c.reasonCode,
      severity: c.severity,
      checks: c.checks,
      checkedAt: c.checkedAt,
      incidentId: c.incidentId,
    })),
    total,
    pagina: rango(pagina).pagina,
    porPagina,
  }
}

// ── B · incidentes, paginados ──────────────────────────────────────────────

export interface IncidenteEnPanel {
  id: string
  status: string
  severity: string
  reasonCode: string | null
  provider: string | null
  externalTransactionId: string | null
  orderNumber: string | null
  orderId: string | null
  amount: string
  currency: string
  notes: string
  resolution: string | null
  resolvedAt: Date | null
  resueltoPor: string | null
  correlationId: string | null
  createdAt: Date
  edadMin: number | null
}

export async function incidentesDelPanel(
  f: { status?: string; severity?: string } = {},
  pagina = 1,
  ahora = new Date()
): Promise<Pagina<IncidenteEnPanel>> {
  const { skip, take, porPagina } = rango(pagina)
  const where: Prisma.SupplyV2FinanceIncidentWhereInput = {
    type: 'EXTERNAL_PAYMENT_MISMATCH',
    ...(f.status ? { status: f.status as Prisma.EnumSupplyV2FinanceIncidentStatusFilter['equals'] } : {}),
    ...(f.severity ? { severity: f.severity as Prisma.EnumSupplyV2FinanceIncidentSeverityFilter['equals'] } : {}),
  }
  const [filas, total] = await Promise.all([
    prisma.supplyV2FinanceIncident.findMany({
      where,
      orderBy: [{ status: 'asc' }, { severity: 'desc' }, { createdAt: 'desc' }],
      skip,
      take,
      select: {
        id: true, status: true, severity: true, reasonCode: true, provider: true, externalTransactionId: true,
        orderId: true, amount: true, currency: true, notes: true, resolution: true, resolvedAt: true,
        correlationId: true, createdAt: true,
        order: { select: { number: true } },
        resolvedBy: { select: { name: true, email: true } },
      },
    }),
    prisma.supplyV2FinanceIncident.count({ where }),
  ])
  return {
    filas: filas.map((i) => ({
      id: i.id,
      status: i.status,
      severity: i.severity,
      reasonCode: i.reasonCode,
      provider: i.provider,
      externalTransactionId: i.externalTransactionId,
      orderNumber: i.order?.number ?? null,
      orderId: i.orderId,
      amount: i.amount.toFixed(2),
      currency: i.currency,
      notes: i.notes,
      resolution: i.resolution,
      resolvedAt: i.resolvedAt,
      resueltoPor: i.resolvedBy?.name ?? i.resolvedBy?.email ?? null,
      correlationId: i.correlationId,
      createdAt: i.createdAt,
      edadMin: minutosDesde(i.createdAt, ahora),
    })),
    total,
    pagina: rango(pagina).pagina,
    porPagina,
  }
}

/** Un incidente con todo lo que hace falta para trabajarlo (§17). */
export async function incidenteDetalle(id: string) {
  return prisma.supplyV2FinanceIncident.findUnique({
    where: { id },
    select: {
      id: true, type: true, status: true, severity: true, reasonCode: true, provider: true,
      externalTransactionId: true, correlationId: true, internalStatus: true, externalStatus: true,
      amount: true, currency: true, notes: true, resolution: true, resolutionNotes: true, resolvedAt: true,
      createdAt: true, supplierId: true,
      order: { select: { id: true, number: true, status: true, total: true, currency: true, paidAt: true } },
      externalEvent: { select: { id: true, provider: true, externalEventId: true, eventType: true, status: true, receivedAt: true } },
      resolvedBy: { select: { name: true, email: true } },
      reconciliations: {
        orderBy: { checkedAt: 'desc' },
        take: 10,
        select: {
          id: true, outcome: true, reasonCode: true, expectedAmount: true, reportedAmount: true,
          expectedCurrency: true, reportedCurrency: true, differenceAmount: true, checks: true, checkedAt: true,
        },
      },
    },
  })
}

// ── F y G · difuntos del outbox y de la cola ───────────────────────────────

/**
 * Los difuntos del OUTBOX (los del Slice 9). Los de la cola de trabajos son
 * otra cosa y los da `trabajosMuertosPendientes`, que ya existía.
 */
export async function efectosMuertos(pagina = 1, ahora = new Date()): Promise<Pagina<EfectoEnPanel>> {
  return efectosDelOutbox({ status: 'DEAD_LETTER' }, pagina, ahora)
}

/** Los difuntos de la cola de trabajos: se reutiliza la función de siempre. */
export async function difuntosDeLaCola(limite = 25): Promise<DifuntoPanel[]> {
  return trabajosMuertosPendientes(limite)
}

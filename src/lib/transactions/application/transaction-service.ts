/**
 * Transaction Engine (Fase E4) — servicio de aplicación.
 *
 * Crea y administra transacciones oficiales con ID único (TX-YYYYMMDD-NNNNNN),
 * número de ticket secuencial por empresa, máquina de estados con historial de
 * transiciones y auditoría técnica. Las funciones aceptan un cliente Prisma o
 * un `tx` de $transaction: la creación puede vivir DENTRO del núcleo atómico
 * del flujo que la origina (ej. confirmar visita) sin abrir otra transacción.
 *
 * El motor NO valida reglas de negocio ni ejecuta efectos: la validación es
 * del Rule Engine/flujo llamador y los efectos del Action Engine. Aquí solo
 * se registra la verdad oficial de la operación.
 */

import { Prisma, type MetodoCobroTipo, type PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { validateTransition } from '../domain/lifecycle'
import {
  fechaScope,
  formatTicketNumero,
  formatTransactionCodigo,
  normalizeTransactionCodigo,
} from '../domain/codigo'
import type {
  TransactionAuditoria,
  TransactionEstado,
  TransactionRecord,
  TransactionSnapshot,
  TransactionTipo,
  TransactionTransicionRecord,
} from '../domain/types'

/** Cliente Prisma o transacción interactiva. */
export type Db = PrismaClient | Prisma.TransactionClient

// ── Contadores atómicos ──────────────────────────────────────────────────────

/**
 * Incrementa y devuelve el siguiente valor del contador `scope` en UNA sola
 * sentencia atómica (sin ventana de carrera, seguro bajo concurrencia).
 */
export async function nextCounter(db: Db, scope: string): Promise<number> {
  const rows = await db.$queryRaw<{ seq: number }[]>`
    INSERT INTO "transaction_counters" ("id", "seq") VALUES (${scope}, 1)
    ON CONFLICT ("id") DO UPDATE SET "seq" = "transaction_counters"."seq" + 1
    RETURNING "seq"
  `
  return rows[0].seq
}

// ── Creación ─────────────────────────────────────────────────────────────────

export interface CrearTransaccionInput {
  readonly tipo: TransactionTipo
  readonly companyId: string
  readonly sucursalId?: string | null
  readonly clienteId?: string | null
  readonly empleadoId?: string | null
  readonly caja?: string | null
  /** Caja (POS): sesión, monto y forma de cobro para arqueo y reportes. */
  readonly cajaSesionId?: string | null
  readonly monto?: number | null
  readonly metodoCobro?: MetodoCobroTipo | null
  /** Cobro de pasarela que originó la venta (único en el libro). Solo ventas `SALE` con método TARJETA. */
  readonly pagoIntentoId?: string | null
  readonly membershipId?: string | null
  readonly visitId?: string | null
  readonly qrTokenUsadoId?: string | null
  readonly snapshot: TransactionSnapshot
  readonly auditoria?: TransactionAuditoria
  readonly resultado?: string | null
  readonly executionMs?: number | null
  readonly timeZone?: string
  readonly userId?: string | null
}

async function generarIdentificadores(db: Db, companyId: string, timeZone?: string) {
  const fecha = fechaScope(new Date(), timeZone)
  const [txSeq, ticketSeq] = [
    await nextCounter(db, `TX:${fecha}`),
    await nextCounter(db, `TICKET:${companyId}`),
  ]
  return {
    codigo: formatTransactionCodigo(fecha, txSeq),
    ticketNumero: formatTicketNumero(ticketSeq),
  }
}

/**
 * Registra una operación COMPLETADA en un solo paso atómico (el caso del
 * escáner: la validación y los efectos ya ocurrieron dentro del mismo `tx`).
 * Crea la transacción en APPLIED y deja el camino feliz completo en el
 * historial de transiciones (PENDING→VALIDATING→APPROVED→APPLIED).
 */
export async function crearTransaccionAplicada(
  db: Db,
  input: CrearTransaccionInput
): Promise<{ id: string; codigo: string; ticketNumero: string }> {
  const { codigo, ticketNumero } = await generarIdentificadores(
    db,
    input.companyId,
    input.timeZone
  )
  const now = new Date()

  const tx = await db.transaction.create({
    data: {
      codigo,
      ticketNumero,
      tipo: input.tipo,
      estado: 'APPLIED',
      companyId: input.companyId,
      sucursalId: input.sucursalId ?? null,
      clienteId: input.clienteId ?? null,
      empleadoId: input.empleadoId ?? null,
      caja: input.caja ?? null,
      cajaSesionId: input.cajaSesionId ?? null,
      monto: input.monto ?? null,
      metodoCobro: input.metodoCobro ?? null,
      pagoIntentoId: input.pagoIntentoId ?? null,
      membershipId: input.membershipId ?? null,
      visitId: input.visitId ?? null,
      qrTokenUsadoId: input.qrTokenUsadoId ?? null,
      snapshot: input.snapshot as Prisma.InputJsonValue,
      auditoria: (input.auditoria ?? {}) as Prisma.InputJsonValue,
      resultado: input.resultado ?? null,
      executionMs: input.executionMs ?? null,
      appliedAt: now,
    },
    select: { id: true },
  })

  const pasos: { desde: TransactionEstado | null; hacia: TransactionEstado }[] = [
    { desde: null, hacia: 'PENDING' },
    { desde: 'PENDING', hacia: 'VALIDATING' },
    { desde: 'VALIDATING', hacia: 'APPROVED' },
    { desde: 'APPROVED', hacia: 'APPLIED' },
  ]
  await db.transactionTransicion.createMany({
    data: pasos.map((p) => ({
      transactionId: tx.id,
      desde: p.desde,
      hacia: p.hacia,
      userId: input.userId ?? null,
    })),
  })

  return { id: tx.id, codigo, ticketNumero }
}

/**
 * Registra una operación FALLIDA (para auditoría de errores). Best-effort:
 * el llamador decide si la envuelve en try/catch.
 */
export async function crearTransaccionError(
  db: Db,
  input: CrearTransaccionInput & { errorDetalle: string }
): Promise<{ id: string; codigo: string } | null> {
  const { codigo, ticketNumero } = await generarIdentificadores(
    db,
    input.companyId,
    input.timeZone
  )
  const tx = await db.transaction.create({
    data: {
      codigo,
      ticketNumero,
      tipo: input.tipo,
      estado: 'ERROR',
      companyId: input.companyId,
      sucursalId: input.sucursalId ?? null,
      clienteId: input.clienteId ?? null,
      empleadoId: input.empleadoId ?? null,
      membershipId: input.membershipId ?? null,
      qrTokenUsadoId: null, // el QR no se consumió: la operación falló
      snapshot: input.snapshot as Prisma.InputJsonValue,
      auditoria: (input.auditoria ?? {}) as Prisma.InputJsonValue,
      errorDetalle: input.errorDetalle,
      executionMs: input.executionMs ?? null,
    },
    select: { id: true },
  })
  await db.transactionTransicion.createMany({
    data: [
      { transactionId: tx.id, desde: null, hacia: 'PENDING' as const, userId: input.userId ?? null },
      { transactionId: tx.id, desde: 'PENDING' as const, hacia: 'ERROR' as const, motivo: input.errorDetalle, userId: input.userId ?? null },
    ],
  })
  return { id: tx.id, codigo }
}

// ── Transiciones posteriores (cancelar / revertir) ──────────────────────────

export interface TransitionInput {
  readonly userId?: string | null
  readonly motivo?: string | null
}

/**
 * Aplica una transición validada por la máquina de estados. El guard va en el
 * WHERE del update: si otro proceso movió el estado entre lectura y commit,
 * count=0 y se rechaza (sin TOCTOU).
 */
export async function transicionar(
  db: Db,
  transactionId: string,
  hacia: TransactionEstado,
  { userId = null, motivo = null }: TransitionInput = {}
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actual = await db.transaction.findUnique({
    where: { id: transactionId },
    select: { estado: true },
  })
  if (!actual) return { ok: false, error: 'Transacción no encontrada.' }

  const invalid = validateTransition(actual.estado as TransactionEstado, hacia)
  if (invalid) return { ok: false, error: invalid }

  const stamps =
    hacia === 'CANCELLED'
      ? { cancelledAt: new Date() }
      : hacia === 'REVERTED'
        ? { revertedAt: new Date() }
        : hacia === 'APPLIED'
          ? { appliedAt: new Date() }
          : {}

  const upd = await db.transaction.updateMany({
    where: { id: transactionId, estado: actual.estado },
    data: { estado: hacia, ...stamps },
  })
  if (upd.count === 0) {
    return { ok: false, error: 'La transacción cambió de estado; recarga e intenta de nuevo.' }
  }

  await db.transactionTransicion.create({
    data: {
      transactionId,
      desde: actual.estado,
      hacia,
      motivo,
      userId,
    },
  })
  return { ok: true }
}

// ── Consulta ─────────────────────────────────────────────────────────────────

const INCLUDE_DETALLE = {
  transiciones: { orderBy: { createdAt: 'asc' as const } },
  impresiones: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.TransactionInclude

function toRecord(row: {
  id: string
  codigo: string
  ticketNumero: string
  tipo: string
  estado: string
  companyId: string
  sucursalId: string | null
  clienteId: string | null
  empleadoId: string | null
  caja: string | null
  membershipId: string | null
  visitId: string | null
  qrTokenUsadoId: string | null
  snapshot: unknown
  auditoria: unknown
  resultado: string | null
  errorDetalle: string | null
  executionMs: number | null
  createdAt: Date
  appliedAt: Date | null
  cancelledAt: Date | null
  revertedAt: Date | null
}): TransactionRecord {
  return {
    ...row,
    tipo: row.tipo as TransactionTipo,
    estado: row.estado as TransactionEstado,
    snapshot: (row.snapshot ?? {}) as TransactionSnapshot,
    auditoria: (row.auditoria ?? {}) as TransactionAuditoria,
  }
}

export interface TransactionDetalle extends TransactionRecord {
  readonly transiciones: TransactionTransicionRecord[]
  readonly impresiones: { id: string; esCopia: boolean; numero: number; motivo: string | null; createdAt: Date }[]
}

function toDetalle(row: Parameters<typeof toRecord>[0] & {
  transiciones: { id: string; desde: string | null; hacia: string; motivo: string | null; userId: string | null; createdAt: Date }[]
  impresiones: { id: string; esCopia: boolean; numero: number; motivo: string | null; createdAt: Date }[]
}): TransactionDetalle {
  return {
    ...toRecord(row),
    transiciones: row.transiciones.map((t) => ({
      ...t,
      desde: t.desde as TransactionEstado | null,
      hacia: t.hacia as TransactionEstado,
    })),
    impresiones: row.impresiones,
  }
}

export async function getByCodigo(codigo: string, db: Db = prisma): Promise<TransactionDetalle | null> {
  const row = await db.transaction.findUnique({
    where: { codigo: normalizeTransactionCodigo(codigo) },
    include: INCLUDE_DETALLE,
  })
  return row ? toDetalle(row) : null
}

export async function getById(id: string, db: Db = prisma): Promise<TransactionDetalle | null> {
  const row = await db.transaction.findUnique({ where: { id }, include: INCLUDE_DETALLE })
  return row ? toDetalle(row) : null
}

/** Historial del QR: la transacción que consumió ese token de un solo uso. */
export async function getByQrUsado(qrTokenId: string, db: Db = prisma): Promise<TransactionDetalle | null> {
  const row = await db.transaction.findUnique({
    where: { qrTokenUsadoId: qrTokenId },
    include: INCLUDE_DETALLE,
  })
  return row ? toDetalle(row) : null
}

export async function getByVisitId(visitId: string, db: Db = prisma): Promise<TransactionRecord | null> {
  const row = await db.transaction.findUnique({ where: { visitId } })
  return row ? toRecord(row) : null
}

export async function listByCliente(
  clienteId: string,
  { take = 50 }: { take?: number } = {},
  db: Db = prisma
): Promise<TransactionRecord[]> {
  const rows = await db.transaction.findMany({
    where: { clienteId },
    orderBy: { createdAt: 'desc' },
    take,
  })
  return rows.map(toRecord)
}

export async function listByCompany(
  companyId: string,
  { take = 100, estado }: { take?: number; estado?: TransactionEstado } = {},
  db: Db = prisma
): Promise<TransactionRecord[]> {
  const rows = await db.transaction.findMany({
    where: { companyId, ...(estado ? { estado } : {}) },
    orderBy: { createdAt: 'desc' },
    take,
  })
  return rows.map(toRecord)
}

// ── Impresiones ──────────────────────────────────────────────────────────────

/**
 * Registra una impresión del comprobante y devuelve el número (1 = original,
 * 2+ = COPIA). El contador es el conteo real en BD, atómico por unique.
 */
export async function registrarImpresionRecibo(
  transactionId: string,
  { empleadoId = null, motivo = null }: { empleadoId?: string | null; motivo?: string | null } = {},
  db: Db = prisma
): Promise<{ numero: number; esCopia: boolean }> {
  const previas = await db.receiptImpresion.count({ where: { transactionId } })
  const numero = previas + 1
  const esCopia = numero > 1
  await db.receiptImpresion.create({
    data: { transactionId, empleadoId, motivo, numero, esCopia },
  })
  return { numero, esCopia }
}

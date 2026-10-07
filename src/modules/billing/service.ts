import { randomUUID } from 'node:crypto'
import { Prisma, type MerchantBillingCycle, type MerchantFeeModel, type MerchantLedgerEntry, type MerchantLedgerEntryType } from '@prisma/client'
import { decimal, type Monto } from '@/lib/commerce-primitives/dinero'
import type { Tx } from '@/lib/tenant'
import type { ContextoAuditoria } from '@/modules/inventory/auditoria'
import { auditarFacturacion } from './auditoria'
import {
  CONFIG_POR_DEFECTO,
  TIPOS_MANUALES,
  calcularComision,
  esClaveDeComision,
  evaluarEstadoDeCuenta,
  inicioDelPeriodo,
  instanteDelAsiento,
  montoATexto,
  normalizarMotivo,
  pedidoGeneraComision,
  periodosCerrados,
  resumirCorte,
  siguientePosicion,
  validarAsiento,
  validarTarifas,
  type Periodo,
  type PedidoParaComision,
  type ReferenciaDelLibro,
  type TipoManual,
} from './domain'
import { fallo } from './errores'

/**
 * COMMERCE CORE · Merchant Billing — el servicio (Fase 4).
 *
 * Lo que cada empresa le debe a Membego. Cada función corre dentro de la `tx` de
 * quien llama (`conEmpresa`), así que el pedido, su comisión, el asiento del libro
 * y el estado de la cuenta se confirman o se deshacen JUNTOS.
 *
 * CONCURRENCIA. Toda escritura de la cuenta de una empresa toma `SELECT … FOR
 * UPDATE` sobre la fila de su configuración: el saldo corrido, la posición del
 * asiento y el límite de crédito se calculan SIEMPRE bajo ese candado. El orden de
 * candados es único (pedido → cuenta), así que el cierre de un pedido y un pago
 * manual no se interbloquean. Debajo hay otra red: la base rechaza un asiento con
 * posición o saldo equivocados, y un segundo escritor choca con el índice único
 * `(companyId, seq)`.
 *
 * LA REGLA DE ORO. El libro es append-only: nada se edita ni se borra. Revertir una
 * comisión, corregir un error o devolver un pago es un asiento NUEVO de signo
 * contrario. El saldo es el del último asiento.
 *
 * SEPARACIÓN. Este módulo no importa Supply ni los pedidos: el servicio de pedidos
 * le pasa los datos que necesita. Un pedido de Supply no comisiona.
 */

export interface ContextoFacturacion extends ContextoAuditoria {
  actor: 'SISTEMA' | 'SUPERADMIN'
}

export const SISTEMA: ContextoFacturacion = { actor: 'SISTEMA', actorId: null }

// ── La cuenta ────────────────────────────────────────────────────────────────

/** La cuenta de la empresa, creada con los valores de la plataforma si aún no existe, y BLOQUEADA hasta el fin de la transacción. */
export async function cuentaBloqueada(tx: Tx, companyId: string) {
  if (typeof companyId !== 'string' || companyId === '') fallo('EMPRESA_NO_ENCONTRADA', 'La empresa no existe.')
  await tx.merchantBillingConfig.createMany({
    data: [
      {
        companyId,
        feeModel: CONFIG_POR_DEFECTO.feeModel,
        cpaAmount: CONFIG_POR_DEFECTO.cpaAmount,
        percentageRate: CONFIG_POR_DEFECTO.percentageRate,
        creditLimit: CONFIG_POR_DEFECTO.creditLimit,
        billingCycle: CONFIG_POR_DEFECTO.billingCycle,
        currency: CONFIG_POR_DEFECTO.currency,
      },
    ],
    skipDuplicates: true,
  })
  const filas = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "merchant_billing_configs" WHERE "companyId" = ${companyId} FOR UPDATE`
  if (filas.length === 0) fallo('EMPRESA_NO_ENCONTRADA', 'La empresa no existe.')
  return tx.merchantBillingConfig.findUniqueOrThrow({ where: { companyId } })
}

/** El último asiento de la cuenta (su posición, su saldo y su instante), o `null` si está vacía. */
async function ultimoAsiento(tx: Tx, companyId: string) {
  return tx.merchantLedgerEntry.findFirst({ where: { companyId }, orderBy: { seq: 'desc' }, select: { seq: true, balance: true, createdAt: true } })
}

/** Lo que la empresa debe hoy (negativo = a su favor). */
export async function saldoEnTx(tx: Tx, companyId: string): Promise<Prisma.Decimal> {
  return (await ultimoAsiento(tx, companyId))?.balance ?? new Prisma.Decimal(0)
}

// ── Asientos ─────────────────────────────────────────────────────────────────

interface EntradaAsiento {
  type: MerchantLedgerEntryType
  /** Con signo: positivo = la empresa debe más. */
  amount: Monto
  currency: string
  referenceType: ReferenciaDelLibro
  referenceId: string
  reason: string | null
  idempotencyKey: string
  actorId: string | null
  ahora: Date
}

/**
 * Escribe un asiento al final del libro. SOLO se llama con la cuenta bloqueada
 * (`cuentaBloqueada`). Reintentar con la misma clave devuelve el asiento original
 * (y falla si la clave se reutiliza para otra cosa).
 */
async function asentar(tx: Tx, companyId: string, e: EntradaAsiento): Promise<{ asiento: MerchantLedgerEntry; repetido: boolean }> {
  const previo = await tx.merchantLedgerEntry.findUnique({ where: { companyId_idempotencyKey: { companyId, idempotencyKey: e.idempotencyKey } } })
  if (previo) {
    if (previo.type !== e.type || !previo.amount.equals(decimal(e.amount)) || previo.referenceType !== e.referenceType || previo.referenceId !== e.referenceId) {
      fallo('CLAVE_REUTILIZADA', 'Esa clave ya se usó para un asiento distinto.')
    }
    return { asiento: previo, repetido: true }
  }
  const error = validarAsiento({ type: e.type, amount: e.amount, reason: e.reason })
  if (error) fallo('ASIENTO_INVALIDO', error)
  const ultimo = await ultimoAsiento(tx, companyId)
  const siguiente = siguientePosicion(ultimo, e.amount)
  const asiento = await tx.merchantLedgerEntry.create({
    data: {
      companyId,
      seq: siguiente.seq,
      type: e.type,
      amount: decimal(e.amount),
      balance: siguiente.balance,
      currency: e.currency,
      referenceType: e.referenceType,
      referenceId: e.referenceId,
      reason: e.reason,
      idempotencyKey: e.idempotencyKey,
      actorUserId: e.actorId,
      createdAt: instanteDelAsiento(e.ahora, ultimo),
    },
  })
  return { asiento, repetido: false }
}

/**
 * Revisa el estado de la cuenta contra su saldo y su límite, y lo cambia si toca.
 * SOLO con la cuenta bloqueada. Devuelve el estado resultante.
 */
async function reevaluarEstado(tx: Tx, companyId: string, ctx: ContextoFacturacion, ahora: Date) {
  const cuenta = await tx.merchantBillingConfig.findUniqueOrThrow({ where: { companyId } })
  const saldo = await saldoEnTx(tx, companyId)
  const d = evaluarEstadoDeCuenta(cuenta, saldo, cuenta.creditLimit, ahora)
  if (d.motivo === null) return cuenta
  const nueva = await tx.merchantBillingConfig.update({
    where: { companyId },
    data: { status: d.status, graceUntil: d.graceUntil, statusReason: d.motivo, statusChangedAt: ahora },
  })
  await auditarFacturacion(tx, ctx, companyId, 'BILLING_STATUS_CHANGED', 'MerchantBillingConfig', cuenta.id, {
    de: cuenta.status,
    a: d.status,
    motivo: d.motivo,
    saldo: montoATexto(saldo),
    limite: montoATexto(cuenta.creditLimit),
    por: ctx.actor,
  })
  return nueva
}

// ── Comisión de un pedido ────────────────────────────────────────────────────

export type ResultadoComision =
  | { resultado: 'CREADA'; commissionId: string; type: 'CPA_FIXED' | 'PERCENTAGE'; amount: string }
  | { resultado: 'YA_EXISTE'; commissionId: string; amount: string }
  | { resultado: 'NO_APLICA' }
  | { resultado: 'SIN_COMISION' }

/**
 * Cobra la comisión de un pedido COMPLETADO: calcula según la configuración de la
 * empresa y la evidencia del pedido, escribe el asiento y la comisión (1:1) y revisa
 * el límite de crédito. Se llama en la MISMA transacción que cierra el pedido.
 * Idempotente: un pedido tiene a lo sumo una comisión.
 *
 * La evidencia que decide el modelo es la que el pedido tiene AL COBRAR: en el camino
 * normal es la del cierre (se cobra en la misma transacción), y un pago que se registre
 * después no recalcula una comisión ya cobrada. La red de seguridad del cron cobra
 * pedidos que se quedaron sin comisión con la evidencia VIGENTE ese día —que puede
 * ser mayor que la del cierre—; la base lo exige así (la comisión debe coincidir con
 * el nivel actual del pedido).
 */
export async function registrarComisionDePedidoEnTx(
  tx: Tx,
  companyId: string,
  pedido: PedidoParaComision,
  ctx: ContextoFacturacion = SISTEMA,
  ahora = new Date()
): Promise<ResultadoComision> {
  if (!pedidoGeneraComision(pedido)) return { resultado: 'NO_APLICA' }
  const config = await cuentaBloqueada(tx, companyId)
  const existente = await tx.commission.findUnique({ where: { orderId: pedido.id } })
  if (existente) return { resultado: 'YA_EXISTE', commissionId: existente.id, amount: montoATexto(existente.amount) }

  // Un libro es de UNA moneda: sumar dólares a un saldo en pesos lo corrompería sin que nada lo notara.
  if (pedido.currency !== config.currency) {
    fallo('MONEDA_DISTINTA', `El pedido ${pedido.code} está en ${pedido.currency} y la cuenta Membego de la empresa cobra en ${config.currency}: no se puede asentar su comisión en el mismo libro.`)
  }
  const c = calcularComision(pedido, config)
  if (!c) return { resultado: 'SIN_COMISION' }

  const id = randomUUID()
  const { asiento } = await asentar(tx, companyId, {
    type: c.type === 'CPA_FIXED' ? 'REDEMPTION_FEE' : 'ORDER_FEE',
    amount: c.amount,
    currency: pedido.currency,
    referenceType: 'COMMISSION',
    referenceId: id,
    reason: null,
    idempotencyKey: `commission:${pedido.id}`,
    actorId: ctx.actorId,
    ahora,
  })
  await tx.commission.create({
    data: {
      id,
      companyId,
      orderId: pedido.id,
      type: c.type,
      feeModel: c.feeModel,
      verificationLevel: pedido.verificationLevel,
      baseAmount: c.baseAmount,
      rate: c.rate,
      amount: c.amount,
      currency: pedido.currency,
      ledgerEntryId: asiento.id,
    },
  })
  await reevaluarEstado(tx, companyId, ctx, ahora)
  return { resultado: 'CREADA', commissionId: id, type: c.type, amount: montoATexto(c.amount) }
}

export type ResultadoReverso = { resultado: 'REVERTIDA'; amount: string } | { resultado: 'YA_REVERTIDA' } | { resultado: 'SIN_COMISION' }

/**
 * Revierte la comisión de un pedido REEMBOLSADO: un asiento nuevo por el mismo
 * monto y signo contrario, y la comisión pasa a REVERSED. Se llama en la misma
 * transacción que reembolsa el pedido (con el pedido ya en REFUNDED).
 */
export async function revertirComisionDePedidoEnTx(tx: Tx, companyId: string, pedidoId: string, ctx: ContextoFacturacion = SISTEMA, ahora = new Date()): Promise<ResultadoReverso> {
  const previa = await tx.commission.findUnique({ where: { orderId: pedidoId }, select: { id: true } })
  if (!previa) return { resultado: 'SIN_COMISION' }
  await cuentaBloqueada(tx, companyId)
  const c = await tx.commission.findUniqueOrThrow({ where: { id: previa.id } })
  if (c.status === 'REVERSED') return { resultado: 'YA_REVERTIDA' }

  const { asiento } = await asentar(tx, companyId, {
    type: 'REFUND',
    amount: c.amount.negated(),
    currency: c.currency,
    referenceType: 'COMMISSION',
    referenceId: c.id,
    reason: null,
    idempotencyKey: `commission:${pedidoId}:reversal`,
    actorId: ctx.actorId,
    ahora,
  })
  await tx.commission.update({ where: { id: c.id }, data: { status: 'REVERSED', reversalEntryId: asiento.id, reversedAt: ahora } })
  await reevaluarEstado(tx, companyId, ctx, ahora)
  return { resultado: 'REVERTIDA', amount: montoATexto(c.amount) }
}

// ── Asientos manuales (superadmin) ───────────────────────────────────────────

export interface EntradaManual {
  tipo: TipoManual
  /**
   * Pago, crédito y crédito promocional: el monto POSITIVO que se recibe o se concede
   * (el servicio lo asienta restando). Ajuste: con signo (+ la empresa debe más, − menos).
   */
  monto: Monto
  motivo?: string | null
  /** Pago: la referencia del depósito o la transferencia. */
  referencia?: string | null
  /** Reintentar con la misma clave no duplica el asiento. */
  idempotencyKey: string
}

export interface ResultadoManual {
  entryId: string
  seq: number
  balance: string
  status: string
  repetido: boolean
}

function claveValida(k: unknown): string {
  if (typeof k !== 'string' || k.trim() === '' || k.length > 120) fallo('CLAVE_INVALIDA', 'Falta la clave de la operación.')
  return k.trim()
}

/** Asienta un pago, un ajuste o un crédito a la cuenta de una empresa. SOLO el superadmin (lo exige la acción). */
export async function asentarManualEnTx(tx: Tx, companyId: string, e: EntradaManual, ctx: ContextoFacturacion, ahora = new Date()): Promise<ResultadoManual> {
  if (ctx.actor !== 'SUPERADMIN') fallo('SOLO_SUPERADMIN', 'Solo el superadmin asienta pagos, ajustes y créditos.')
  if (!(TIPOS_MANUALES as readonly string[]).includes(e.tipo)) fallo('TIPO_INVALIDO', 'Ese tipo de asiento no se registra a mano.')
  const clave = claveValida(e.idempotencyKey)
  // Esas claves son del sistema (una por pedido): una manual con la misma bloquearía para siempre el cobro o el reverso de ese pedido.
  if (esClaveDeComision(clave)) fallo('CLAVE_INVALIDA', 'Esa clave está reservada para las comisiones.')
  const motivo = normalizarMotivo(e.motivo)
  if (!motivo.ok) fallo('MOTIVO_INVALIDO', motivo.error)
  let monto: Prisma.Decimal
  try {
    monto = decimal(e.monto)
  } catch {
    fallo('ASIENTO_INVALIDO', 'El monto no es un número.')
  }
  if (e.tipo !== 'ADJUSTMENT') {
    if (!monto.isFinite() || !monto.greaterThan(0)) fallo('ASIENTO_INVALIDO', 'El monto tiene que ser mayor que cero.')
    monto = monto.negated()
  }
  const referencia = typeof e.referencia === 'string' && e.referencia.trim() !== '' ? e.referencia.trim().slice(0, 120) : null
  if (e.tipo === 'PAYMENT' && referencia === null) fallo('REFERENCIA_REQUERIDA', 'Un pago necesita la referencia del depósito o la transferencia.')

  const config = await cuentaBloqueada(tx, companyId)
  if (e.tipo === 'PAYMENT') {
    // El mismo depósito no se acredita dos veces: reintentar con la MISMA clave devuelve el asiento original; otra clave con la misma referencia es otro asiento.
    const mismoDeposito = await tx.merchantLedgerEntry.findFirst({
      where: { companyId, referenceType: 'PAYMENT', referenceId: referencia as string, NOT: { idempotencyKey: clave } },
      select: { seq: true },
    })
    if (mismoDeposito) fallo('PAGO_DUPLICADO', `Ya hay un pago asentado con la referencia «${referencia}» (asiento ${mismoDeposito.seq}). Si es otro depósito, usa otra referencia.`)
  }
  const { asiento, repetido } = await asentar(tx, companyId, {
    type: e.tipo,
    amount: monto,
    currency: config.currency,
    referenceType: e.tipo === 'PAYMENT' ? 'PAYMENT' : 'MANUAL',
    referenceId: e.tipo === 'PAYMENT' ? (referencia as string) : clave,
    reason: motivo.valor,
    idempotencyKey: clave,
    actorId: ctx.actorId,
    ahora,
  })
  if (!repetido) {
    await auditarFacturacion(tx, ctx, companyId, 'BILLING_ENTRY_RECORDED', 'MerchantLedgerEntry', asiento.id, {
      tipo: e.tipo,
      monto: montoATexto(asiento.amount),
      saldo: montoATexto(asiento.balance),
      motivo: motivo.valor,
      referencia,
    })
  }
  const cuenta = await reevaluarEstado(tx, companyId, ctx, ahora)
  return { entryId: asiento.id, seq: asiento.seq, balance: montoATexto(asiento.balance), status: cuenta.status, repetido }
}

// ── Configuración y estado (superadmin) ──────────────────────────────────────

export interface CambiosDeConfig {
  feeModel?: MerchantFeeModel
  cpaAmount?: Monto
  percentageRate?: Monto
  creditLimit?: Monto
  billingCycle?: MerchantBillingCycle
}

const MODELOS: readonly MerchantFeeModel[] = ['CPA_FIXED', 'PERCENTAGE', 'HYBRID']
const CICLOS: readonly MerchantBillingCycle[] = ['WEEKLY', 'BIWEEKLY', 'MONTHLY']

/**
 * Cambia cómo cobra Membego a la empresa. Rige hacia ADELANTE: las comisiones ya
 * cobradas no cambian (cada una guarda la tarifa con la que se cobró).
 */
export async function actualizarConfigEnTx(tx: Tx, companyId: string, c: CambiosDeConfig, ctx: ContextoFacturacion, ahora = new Date()) {
  if (ctx.actor !== 'SUPERADMIN') fallo('SOLO_SUPERADMIN', 'Solo el superadmin cambia la configuración de cobro.')
  if (c.feeModel !== undefined && !MODELOS.includes(c.feeModel)) fallo('CONFIG_INVALIDA', 'El modelo de cobro no es válido.')
  if (c.billingCycle !== undefined && !CICLOS.includes(c.billingCycle)) fallo('CONFIG_INVALIDA', 'El ciclo de facturación no es válido.')
  const error = validarTarifas(c)
  if (error) fallo('CONFIG_INVALIDA', error)

  const antes = await cuentaBloqueada(tx, companyId)
  const data: Prisma.MerchantBillingConfigUpdateInput = {}
  const cambios: Record<string, { de: string; a: string }> = {}
  const nota = (campo: string, de: unknown, a: unknown) => {
    cambios[campo] = { de: String(de), a: String(a) }
  }
  if (c.feeModel !== undefined && c.feeModel !== antes.feeModel) {
    data.feeModel = c.feeModel
    nota('feeModel', antes.feeModel, c.feeModel)
  }
  if (c.billingCycle !== undefined && c.billingCycle !== antes.billingCycle) {
    data.billingCycle = c.billingCycle
    nota('billingCycle', antes.billingCycle, c.billingCycle)
  }
  for (const campo of ['cpaAmount', 'percentageRate', 'creditLimit'] as const) {
    const v = c[campo]
    if (v === undefined) continue
    const nuevo = decimal(v)
    if (!nuevo.equals(antes[campo])) {
      data[campo] = nuevo
      nota(campo, antes[campo].toFixed(2), nuevo.toFixed(2))
    }
  }
  if (Object.keys(cambios).length === 0) return { config: antes, cambios, repetido: true }
  const config = await tx.merchantBillingConfig.update({ where: { companyId }, data })
  await auditarFacturacion(tx, ctx, companyId, 'BILLING_CONFIG_CHANGED', 'MerchantBillingConfig', config.id, { cambios, por: ctx.actor })
  // Un límite nuevo puede poner la cuenta en gracia o sacarla de ella.
  const cuenta = await reevaluarEstado(tx, companyId, ctx, ahora)
  return { config: cuenta, cambios, repetido: false }
}

/**
 * El superadmin suspende la cuenta a mano (`SUSPENDER`: queda así hasta que él la
 * libere) o devuelve el control al sistema (`LIBERAR`: se reevalúa contra el saldo).
 */
export async function fijarEstadoManualEnTx(tx: Tx, companyId: string, e: { accion: 'SUSPENDER' | 'LIBERAR'; motivo: string }, ctx: ContextoFacturacion, ahora = new Date()) {
  if (ctx.actor !== 'SUPERADMIN') fallo('SOLO_SUPERADMIN', 'Solo el superadmin cambia el estado de una cuenta.')
  const motivo = normalizarMotivo(e.motivo)
  if (!motivo.ok) fallo('MOTIVO_INVALIDO', motivo.error)
  if (motivo.valor === null) fallo('MOTIVO_INVALIDO', 'Escribe el motivo del cambio.')
  const antes = await cuentaBloqueada(tx, companyId)
  if (e.accion === 'SUSPENDER') {
    if (antes.status === 'SUSPENDED' && antes.holdManual) return { status: antes.status, repetido: true }
    await tx.merchantBillingConfig.update({
      where: { companyId },
      data: { status: 'SUSPENDED', holdManual: true, graceUntil: null, statusReason: motivo.valor, statusChangedAt: ahora },
    })
  } else if (e.accion === 'LIBERAR') {
    if (!antes.holdManual) return { status: antes.status, repetido: true }
    await tx.merchantBillingConfig.update({ where: { companyId }, data: { holdManual: false, statusReason: motivo.valor, statusChangedAt: ahora } })
  } else {
    fallo('ACCION_INVALIDA', 'Esa acción no existe.')
  }
  await auditarFacturacion(tx, ctx, companyId, 'BILLING_STATUS_CHANGED', 'MerchantBillingConfig', antes.id, {
    de: antes.status,
    accion: e.accion,
    motivo: motivo.valor,
    por: ctx.actor,
  })
  const despues = e.accion === 'LIBERAR' ? await reevaluarEstado(tx, companyId, ctx, ahora) : await tx.merchantBillingConfig.findUniqueOrThrow({ where: { companyId } })
  return { status: despues.status, repetido: false }
}

/** Para el cron: pasa a SUSPENDED las cuentas cuya gracia venció con el saldo aún por encima del límite. */
export async function reevaluarEstadoEnTx(tx: Tx, companyId: string, ahora = new Date()) {
  await cuentaBloqueada(tx, companyId)
  const antes = await tx.merchantBillingConfig.findUniqueOrThrow({ where: { companyId } })
  const despues = await reevaluarEstado(tx, companyId, SISTEMA, ahora)
  return { de: antes.status, a: despues.status, cambio: antes.status !== despues.status }
}

// ── Cortes (statements) ──────────────────────────────────────────────────────

/** Un corte se emite cuando su periodo terminó hace al menos esto: da margen a relojes distintos entre instancias. */
export const MARGEN_DE_CORTE_MS = 5 * 60_000

export interface ResultadoCorte {
  statementId: string
  period: string
  repetido: boolean
}

/**
 * Emite el corte de UN periodo cerrado. Único por (empresa, periodo): pedirlo dos
 * veces devuelve el primero. Bajo el candado de la cuenta, así que ningún asiento
 * del periodo puede aparecer después. Sin actividad y sin saldo arrastrado no hay
 * nada que cortar (`null`).
 */
export async function generarCorteEnTx(tx: Tx, companyId: string, periodo: Periodo, ahora = new Date()): Promise<ResultadoCorte | null> {
  if (periodo.fin.getTime() > ahora.getTime() - MARGEN_DE_CORTE_MS) fallo('PERIODO_ABIERTO', 'El periodo todavía no termina; no se puede cortar.')
  const config = await cuentaBloqueada(tx, companyId)
  const previo = await tx.merchantStatement.findUnique({ where: { companyId_period: { companyId, period: periodo.clave } }, select: { id: true } })
  if (previo) return { statementId: previo.id, period: periodo.clave, repetido: true }

  const asientos = await tx.merchantLedgerEntry.findMany({
    where: { companyId, createdAt: { gte: periodo.inicio, lt: periodo.fin } },
    orderBy: { seq: 'asc' },
    select: { id: true, type: true, amount: true, balance: true },
  })
  const anterior = await tx.merchantLedgerEntry.findFirst({ where: { companyId, createdAt: { lt: periodo.inicio } }, orderBy: { seq: 'desc' }, select: { balance: true } })
  const apertura = anterior?.balance ?? new Prisma.Decimal(0)
  if (asientos.length === 0 && apertura.isZero()) return null

  const cobros = await tx.commission.findMany({
    where: { companyId, ledgerEntryId: { in: asientos.map((a) => a.id) } },
    select: { baseAmount: true },
  })
  const r = resumirCorte(apertura, asientos, cobros.map((c) => c.baseAmount))
  const s = await tx.merchantStatement.create({
    data: {
      companyId,
      period: periodo.clave,
      periodStart: periodo.inicio,
      periodEnd: periodo.fin,
      billingCycle: config.billingCycle,
      currency: config.currency,
      openingBalance: r.openingBalance,
      totalOrders: r.totalOrders,
      totalGmv: r.totalGmv,
      totalCommissions: r.totalCommissions,
      reversals: r.reversals,
      adjustments: r.adjustments,
      credits: r.credits,
      payments: r.payments,
      closingBalance: r.closingBalance,
      amountDue: r.amountDue,
      entryCount: r.entryCount,
      generatedAt: ahora,
    },
  })
  return { statementId: s.id, period: periodo.clave, repetido: false }
}

/** Los periodos cerrados de una empresa que aún no tienen corte, en orden y sin huecos (tope por llamada). */
export async function periodosPendientesEnTx(tx: Tx, companyId: string, ahora = new Date(), max = 24): Promise<Periodo[]> {
  const config = await tx.merchantBillingConfig.findUnique({ where: { companyId } })
  if (!config) return []
  const ultimo = await tx.merchantStatement.findFirst({ where: { companyId }, orderBy: { periodEnd: 'desc' }, select: { periodEnd: true, closingBalance: true } })
  let desde: Date
  if (ultimo && !ultimo.closingBalance.isZero()) {
    // Con saldo arrastrado cada periodo lleva su corte, haya o no movimiento: se sigue sin huecos.
    desde = ultimo.periodEnd
  } else {
    // Sin saldo, un periodo sin movimiento no lleva corte: se salta hasta el primero con actividad.
    const siguiente = await tx.merchantLedgerEntry.findFirst({
      where: { companyId, ...(ultimo ? { createdAt: { gte: ultimo.periodEnd } } : {}) },
      orderBy: { seq: 'asc' },
      select: { createdAt: true },
    })
    if (!siguiente) return []
    const inicio = inicioDelPeriodo(config.billingCycle, siguiente.createdAt)
    desde = ultimo && ultimo.periodEnd.getTime() > inicio.getTime() ? ultimo.periodEnd : inicio
  }
  return periodosCerrados(config.billingCycle, desde, new Date(ahora.getTime() - MARGEN_DE_CORTE_MS), max)
}

/** Emite todos los cortes que faltan de una empresa. */
export async function generarCortesPendientesEnTx(tx: Tx, companyId: string, ahora = new Date(), max = 24): Promise<{ generados: number; saltados: number }> {
  // El candado de la cuenta se toma ANTES de calcular los periodos: si no, dos barridos simultáneos con un cambio de ciclo en medio calcularían sus periodos con ciclos distintos y emitirían cortes solapados (la deuda saldría dos veces).
  await cuentaBloqueada(tx, companyId)
  let generados = 0
  let saltados = 0
  for (const p of await periodosPendientesEnTx(tx, companyId, ahora, max)) {
    const r = await generarCorteEnTx(tx, companyId, p, ahora)
    if (r === null) saltados++
    else if (!r.repetido) generados++
  }
  return { generados, saltados }
}

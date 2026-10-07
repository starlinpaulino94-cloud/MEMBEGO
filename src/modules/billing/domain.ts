import { Prisma, type MerchantBillingStatus, type MerchantFeeModel, type MerchantCommissionType, type MerchantLedgerEntryType, type MembegoVerificationLevel } from '@prisma/client'
import { decimal, redondear2, type Decimal, type Monto } from '@/lib/commerce-primitives/dinero'
import { repartirComision, validarPorcentajeComision } from '@/lib/commerce-primitives/comision'

/**
 * COMMERCE CORE · Merchant Billing — reglas del dominio (Fase 4). PURO.
 *
 * Aquí viven las decisiones: qué pedidos generan comisión, qué modelo cobra cada
 * uno según la evidencia que tenga, cuánto, qué es un asiento válido del libro y
 * cuándo una cuenta entra en gracia o se suspende. Todo con `Decimal`. Las
 * reglas que también vigila la base (migración `20261044_merchant_billing`) están
 * escritas igual allá: `tests/postgres/billing.db.test.ts` comprueba que no se
 * separen.
 *
 * Merchant Billing es la dirección EMPRESA → MEMBEGO. NUNCA se mezcla con Supply
 * Economics (Membego → proveedor): un pedido que envuelve una compra de Supply no
 * genera comisión aquí.
 */

// ── Valores de la plataforma ─────────────────────────────────────────────────

/** Lo que se le asigna a una empresa que aún no tiene una configuración propia. */
export const CONFIG_POR_DEFECTO = {
  feeModel: 'HYBRID' as MerchantFeeModel,
  cpaAmount: '100.00',
  percentageRate: '8.00',
  creditLimit: '5000.00',
  billingCycle: 'MONTHLY' as const,
  currency: 'DOP',
} as const

/** Días que una empresa que se pasó de su límite tiene para ponerse al día antes de suspenderse. */
export const DIAS_DE_GRACIA = 7

/** `referenceType` válidos del libro (la base los exige; ninguno es de Supply). */
export const REFERENCIAS_DEL_LIBRO = ['COMMISSION', 'PAYMENT', 'MANUAL', 'STATEMENT'] as const
export type ReferenciaDelLibro = (typeof REFERENCIAS_DEL_LIBRO)[number]

// ── Qué pedido comisiona ─────────────────────────────────────────────────────

/** Lo único que Merchant Billing necesita saber de un pedido. */
export interface PedidoParaComision {
  id: string
  code: string
  origin: string
  sourceType: string | null
  commissionableBase: Monto
  verificationLevel: MembegoVerificationLevel
  currency: string
}

/** Orígenes que Membego trajo y por los que cobra. POS, excursiones y API se agregan al venir su fase. */
export const ORIGENES_COMISIONABLES: readonly string[] = ['MARKETPLACE']

/** El tipo de documento con el que el puente de Supply envuelve una compra (se compara como texto: este módulo no importa Supply). */
const FUENTE_SUPPLY = 'SUPPLY_V2_CUSTOMER_ORDER'

/** Un pedido de Supply nunca comisiona aquí, pase lo que pase con su origen. */
export function esPedidoDeSupply(p: Pick<PedidoParaComision, 'origin' | 'sourceType'>): boolean {
  return p.origin === 'SUPPLY' || p.sourceType === FUENTE_SUPPLY
}

export function pedidoGeneraComision(p: Pick<PedidoParaComision, 'origin' | 'sourceType'>): boolean {
  return !esPedidoDeSupply(p) && ORIGENES_COMISIONABLES.includes(p.origin)
}

// ── Cuánto se cobra ──────────────────────────────────────────────────────────

export interface ConfigDeCobro {
  feeModel: MerchantFeeModel
  cpaAmount: Monto
  percentageRate: Monto
}

/** Niveles con el pago verificado: aquí hay evidencia financiera y se cobra el porcentaje. */
const NIVELES_CON_PAGO_VERIFICADO: readonly MembegoVerificationLevel[] = ['PAYMENT_VERIFIED', 'FISCALLY_RECONCILED']

/**
 * Qué tipo de comisión corresponde a un pedido:
 *
 *   CPA_FIXED   → siempre CPA.
 *   PERCENTAGE  → siempre porcentaje.
 *   HYBRID      → CPA mientras no haya pago verificado; porcentaje desde `PAYMENT_VERIFIED`.
 *
 * (La base repite esta regla en `merchant_commissions_modelo`.)
 */
export function tipoDeComision(feeModel: MerchantFeeModel, nivel: MembegoVerificationLevel): MerchantCommissionType {
  if (feeModel === 'CPA_FIXED') return 'CPA_FIXED'
  if (feeModel === 'PERCENTAGE') return 'PERCENTAGE'
  return NIVELES_CON_PAGO_VERIFICADO.includes(nivel) ? 'PERCENTAGE' : 'CPA_FIXED'
}

export interface ComisionCalculada {
  type: MerchantCommissionType
  feeModel: MerchantFeeModel
  baseAmount: Decimal
  /** Solo en PERCENTAGE. */
  rate: Decimal | null
  amount: Decimal
}

/**
 * La comisión de un pedido, o `null` si no hay nada que cobrar (base en cero, o un
 * porcentaje que redondea a cero). Lanza si la configuración no es válida: cobrar
 * con una tarifa rota es peor que no cobrar y que el barrido lo reintente.
 */
export function calcularComision(pedido: Pick<PedidoParaComision, 'commissionableBase' | 'verificationLevel'>, config: ConfigDeCobro): ComisionCalculada | null {
  const errorConfig = validarTarifas(config)
  if (errorConfig) throw new Error(errorConfig)
  const base = redondear2(decimal(pedido.commissionableBase))
  if (!base.isFinite() || base.isNegative()) throw new Error('La base comisionable no puede ser negativa.')
  if (base.isZero()) return null
  const type = tipoDeComision(config.feeModel, pedido.verificationLevel)
  if (type === 'CPA_FIXED') {
    const amount = redondear2(decimal(config.cpaAmount))
    return amount.greaterThan(0) ? { type, feeModel: config.feeModel, baseAmount: base, rate: null, amount } : null
  }
  const pct = decimal(config.percentageRate)
  const reparto = repartirComision(base, pct)
  if (reparto.commissionAmount.lessThanOrEqualTo(0)) return null
  return { type, feeModel: config.feeModel, baseAmount: base, rate: pct, amount: reparto.commissionAmount }
}

/** Mensaje de error de unas tarifas, o `null` si valen. */
export function validarTarifas(c: { cpaAmount?: Monto | null; percentageRate?: Monto | null; creditLimit?: Monto | null }): string | null {
  if (c.cpaAmount !== undefined && c.cpaAmount !== null) {
    let cpa: Decimal
    try {
      cpa = decimal(c.cpaAmount)
    } catch {
      return 'El monto del CPA no es un número.'
    }
    if (!cpa.isFinite() || cpa.isNegative()) return 'El monto del CPA no puede ser negativo.'
    if (!cpa.equals(cpa.toDecimalPlaces(2))) return 'El monto del CPA no puede tener más de dos decimales.'
    if (cpa.greaterThan(1_000_000)) return 'El monto del CPA es demasiado alto.'
  }
  if (c.percentageRate !== undefined && c.percentageRate !== null) {
    const e = validarPorcentajeComision(c.percentageRate)
    if (e) return e
  }
  if (c.creditLimit !== undefined && c.creditLimit !== null) {
    let l: Decimal
    try {
      l = decimal(c.creditLimit)
    } catch {
      return 'El límite de crédito no es un número.'
    }
    if (!l.isFinite() || l.isNegative()) return 'El límite de crédito no puede ser negativo.'
    if (!l.equals(l.toDecimalPlaces(2))) return 'El límite de crédito no puede tener más de dos decimales.'
    if (l.greaterThan(100_000_000)) return 'El límite de crédito es demasiado alto.'
  }
  return null
}

// ── El libro ─────────────────────────────────────────────────────────────────

export const TIPOS_QUE_SUMAN: readonly MerchantLedgerEntryType[] = ['REDEMPTION_FEE', 'ORDER_FEE']
export const TIPOS_QUE_RESTAN: readonly MerchantLedgerEntryType[] = ['REFUND', 'PAYMENT', 'CREDIT', 'PROMOTIONAL_CREDIT']
const TIPOS_CON_MOTIVO: readonly MerchantLedgerEntryType[] = ['ADJUSTMENT', 'CREDIT', 'PROMOTIONAL_CREDIT']

/** Tipos que una PERSONA puede asentar a mano; los demás los escribe el sistema al cobrar o revertir una comisión. */
export const TIPOS_MANUALES = ['PAYMENT', 'ADJUSTMENT', 'CREDIT', 'PROMOTIONAL_CREDIT'] as const
export type TipoManual = (typeof TIPOS_MANUALES)[number]

export const TOPE_ASIENTO = new Prisma.Decimal('100000000')

/**
 * Mensaje de error de un asiento, o `null` si es válido (la base lo repite en
 * `merchant_ledger_entries_signo` y `_motivo`). `amount` es con signo:
 * positivo = la empresa debe más.
 */
export function validarAsiento(a: { type: MerchantLedgerEntryType; amount: Monto; reason?: string | null }): string | null {
  let m: Decimal
  try {
    m = decimal(a.amount)
  } catch {
    return 'El monto no es un número.'
  }
  if (!m.isFinite()) return 'El monto no es un número.'
  if (!m.equals(m.toDecimalPlaces(2))) return 'El monto no puede tener más de dos decimales.'
  if (m.isZero()) return 'Un asiento en cero no mueve la cuenta.'
  if (m.abs().greaterThan(TOPE_ASIENTO)) return 'El monto es demasiado alto.'
  if (TIPOS_QUE_SUMAN.includes(a.type) && !m.greaterThan(0)) return 'Una comisión cobrada suma a lo que la empresa debe.'
  if (TIPOS_QUE_RESTAN.includes(a.type) && !m.lessThan(0)) return 'Un pago, crédito o reverso resta de lo que la empresa debe.'
  if (TIPOS_CON_MOTIVO.includes(a.type) && !(a.reason ?? '').trim()) return 'Un ajuste o crédito exige un motivo por escrito.'
  return null
}

/** El motivo de un asiento manual: sin espacios sobrantes y de largo acotado. */
export function normalizarMotivo(m: unknown): { ok: true; valor: string | null } | { ok: false; error: string } {
  if (m === undefined || m === null) return { ok: true, valor: null }
  if (typeof m !== 'string') return { ok: false, error: 'El motivo no es válido.' }
  const t = m.trim().replace(/\s+/g, ' ')
  if (t.length > 300) return { ok: false, error: 'El motivo es demasiado largo (máximo 300 caracteres).' }
  return { ok: true, valor: t === '' ? null : t }
}

export interface SaldoDeLaCuenta {
  seq: number
  balance: Decimal
}

/** El asiento que sigue: su posición y el saldo que deja. Con cuenta vacía, la posición 1 desde saldo 0. */
export function siguientePosicion(ultimo: SaldoDeLaCuenta | null, amount: Monto): SaldoDeLaCuenta {
  const prev = ultimo ?? { seq: 0, balance: new Prisma.Decimal(0) }
  return { seq: prev.seq + 1, balance: prev.balance.plus(decimal(amount)) }
}

/** Recompone el saldo desde los asientos: la verdad contra la que se compara el saldo corrido. */
export function saldoDeAsientos(asientos: readonly { amount: Monto }[]): Decimal {
  return asientos.reduce<Decimal>((t, a) => t.plus(decimal(a.amount)), new Prisma.Decimal(0))
}

// ── Límite de crédito ────────────────────────────────────────────────────────

export interface EstadoDeCuenta {
  status: MerchantBillingStatus
  graceUntil: Date | null
  holdManual: boolean
}

export interface DecisionDeEstado {
  status: MerchantBillingStatus
  graceUntil: Date | null
  /** Motivo para la bitácora; null si no cambió nada. */
  motivo: string | null
}

/**
 * Qué le pasa al estado de una cuenta dado su saldo, su límite y la hora.
 *
 *   ACTIVE        + debe más que el límite             → GRACE_PERIOD (plazo de `DIAS_DE_GRACIA`)
 *   GRACE_PERIOD  + vuelve a estar dentro del límite    → ACTIVE
 *   GRACE_PERIOD  + venció el plazo y sigue pasada      → SUSPENDED
 *   SUSPENDED     + vuelve a estar dentro del límite    → ACTIVE
 *
 * «Dentro del límite» es saldo ≤ límite. Una cuenta que el superadmin puso en un
 * estado a mano (`holdManual`) NO se mueve sola: solo él la libera.
 */
export function evaluarEstadoDeCuenta(cuenta: EstadoDeCuenta, saldo: Monto, limite: Monto, ahora: Date): DecisionDeEstado {
  const igual: DecisionDeEstado = { status: cuenta.status, graceUntil: cuenta.graceUntil, motivo: null }
  if (cuenta.holdManual) return igual
  const pasada = decimal(saldo).greaterThan(decimal(limite))
  if (!pasada) {
    return cuenta.status === 'ACTIVE' ? igual : { status: 'ACTIVE', graceUntil: null, motivo: 'La cuenta volvió a estar dentro de su límite de crédito' }
  }
  if (cuenta.status === 'ACTIVE') {
    return { status: 'GRACE_PERIOD', graceUntil: new Date(ahora.getTime() + DIAS_DE_GRACIA * 86_400_000), motivo: 'El saldo superó el límite de crédito' }
  }
  if (cuenta.status === 'GRACE_PERIOD' && cuenta.graceUntil !== null && cuenta.graceUntil.getTime() <= ahora.getTime()) {
    return { status: 'SUSPENDED', graceUntil: null, motivo: 'Venció el plazo de gracia con el saldo por encima del límite' }
  }
  return igual
}

/** ¿Puede la empresa crear campañas/ofertas con presupuesto (Fase 5)? Solo con la cuenta al día o en gracia. */
export function puedeCrearCampanas(status: MerchantBillingStatus): boolean {
  return status !== 'SUSPENDED'
}

// ── Periodos y cortes ────────────────────────────────────────────────────────

/** Santo Domingo no tiene horario de verano: UTC−4 todo el año. */
const OFFSET_RD_MS = 4 * 3_600_000

export interface Periodo {
  /** Inicio incluido, como instante (medianoche en Santo Domingo). */
  inicio: Date
  /** Fin excluido. */
  fin: Date
  /** `AAAA-MM-DD/AAAA-MM-DD`, en fechas de Santo Domingo (inicio y fin excluido). */
  clave: string
}

interface FechaLocal {
  y: number
  m: number // 1–12
  d: number
}

function fechaLocal(instante: Date): FechaLocal {
  const l = new Date(instante.getTime() - OFFSET_RD_MS)
  return { y: l.getUTCFullYear(), m: l.getUTCMonth() + 1, d: l.getUTCDate() }
}

/** El instante en que empieza ese día en Santo Domingo. */
function inicioDelDia(f: FechaLocal): Date {
  return new Date(Date.UTC(f.y, f.m - 1, f.d) + OFFSET_RD_MS)
}

const dos = (n: number) => String(n).padStart(2, '0')
const textoDeFecha = (f: FechaLocal) => `${f.y}-${dos(f.m)}-${dos(f.d)}`

export function periodoDe(inicio: Date, fin: Date): Periodo {
  return { inicio, fin, clave: `${textoDeFecha(fechaLocal(inicio))}/${textoDeFecha(fechaLocal(fin))}` }
}

/**
 * El primer corte de un ciclo que termina ESTRICTAMENTE después de `desde`
 * (ambos en el calendario de Santo Domingo):
 *
 *   WEEKLY    lunes → lunes siguiente
 *   BIWEEKLY  1 → 16 y 16 → 1 del mes siguiente
 *   MONTHLY   1 → 1 del mes siguiente
 */
export function finDelPeriodo(ciclo: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY', desde: Date): Date {
  const f = fechaLocal(desde)
  if (ciclo === 'WEEKLY') {
    const dow = new Date(Date.UTC(f.y, f.m - 1, f.d)).getUTCDay() // 0 = domingo
    const hastaLunes = ((8 - dow) % 7) || 7
    return inicioDelDia({ y: f.y, m: f.m, d: f.d + hastaLunes })
  }
  if (ciclo === 'BIWEEKLY') {
    if (f.d < 16) return inicioDelDia({ y: f.y, m: f.m, d: 16 })
    return inicioDelDia({ y: f.y, m: f.m + 1, d: 1 })
  }
  return inicioDelDia({ y: f.y, m: f.m + 1, d: 1 })
}

/** El inicio del periodo del ciclo que contiene el instante. */
export function inicioDelPeriodo(ciclo: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY', instante: Date): Date {
  const f = fechaLocal(instante)
  if (ciclo === 'WEEKLY') {
    const dow = new Date(Date.UTC(f.y, f.m - 1, f.d)).getUTCDay()
    const desdeLunes = (dow + 6) % 7
    return inicioDelDia({ y: f.y, m: f.m, d: f.d - desdeLunes })
  }
  if (ciclo === 'BIWEEKLY') return inicioDelDia({ y: f.y, m: f.m, d: f.d < 16 ? 1 : 16 })
  return inicioDelDia({ y: f.y, m: f.m, d: 1 })
}

/**
 * Los periodos CERRADOS (cuyo fin ya pasó) que faltan por cortar, de `desde` en
 * adelante y de forma continua: cada uno empieza donde terminó el anterior,
 * aunque la empresa haya cambiado de ciclo entremedio. Tope de `max` por llamada.
 */
export function periodosCerrados(ciclo: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY', desde: Date, ahora: Date, max = 24): Periodo[] {
  const salida: Periodo[] = []
  let inicio = desde
  while (salida.length < max) {
    const fin = finDelPeriodo(ciclo, inicio)
    if (fin.getTime() > ahora.getTime()) break
    salida.push(periodoDe(inicio, fin))
    inicio = fin
  }
  return salida
}

export interface AsientoParaCorte {
  type: MerchantLedgerEntryType
  amount: Monto
  balance: Monto
}

export interface ResumenDeCorte {
  openingBalance: Decimal
  totalOrders: number
  totalGmv: Decimal
  totalCommissions: Decimal
  reversals: Decimal
  adjustments: Decimal
  credits: Decimal
  payments: Decimal
  closingBalance: Decimal
  amountDue: Decimal
  entryCount: number
}

/**
 * Resume los asientos de un periodo. `baseDeComisiones` son las bases comisionables
 * de los pedidos cobrados en el periodo (una por comisión). El cierre sale de
 * SUMAR, no de leer el último saldo, y debe coincidir con él: si no coinciden, el
 * libro está roto y no se emite el corte.
 */
export function resumirCorte(apertura: Monto, asientos: readonly AsientoParaCorte[], baseDeComisiones: readonly Monto[]): ResumenDeCorte {
  const cero = new Prisma.Decimal(0)
  const suma = (tipos: readonly MerchantLedgerEntryType[]) => asientos.filter((a) => tipos.includes(a.type)).reduce<Decimal>((t, a) => t.plus(decimal(a.amount)), cero)
  const openingBalance = decimal(apertura)
  const totalCommissions = suma(TIPOS_QUE_SUMAN)
  const reversals = suma(['REFUND'])
  const adjustments = suma(['ADJUSTMENT'])
  const credits = suma(['CREDIT', 'PROMOTIONAL_CREDIT'])
  const payments = suma(['PAYMENT'])
  const closingBalance = openingBalance.plus(totalCommissions).plus(reversals).plus(adjustments).plus(credits).plus(payments)
  if (asientos.length > 0 && !decimal(asientos[asientos.length - 1].balance).equals(closingBalance)) {
    throw new Error('El saldo corrido del libro no coincide con la suma de sus asientos; no se emite el corte.')
  }
  return {
    openingBalance,
    totalOrders: baseDeComisiones.length,
    totalGmv: baseDeComisiones.reduce<Decimal>((t, b) => t.plus(decimal(b)), cero),
    totalCommissions,
    reversals,
    adjustments,
    credits,
    payments,
    closingBalance,
    amountDue: closingBalance.greaterThan(0) ? closingBalance : cero,
    entryCount: asientos.length,
  }
}

// ── Antigüedad de la deuda (aging) ───────────────────────────────────────────

export const TRAMOS_DE_ANTIGUEDAD = ['0-30', '31-60', '61-90', '90+'] as const
export type TramoDeAntiguedad = (typeof TRAMOS_DE_ANTIGUEDAD)[number]

export function tramoDeAntiguedad(dias: number): TramoDeAntiguedad {
  if (dias <= 30) return '0-30'
  if (dias <= 60) return '31-60'
  if (dias <= 90) return '61-90'
  return '90+'
}

/**
 * Cuánto de lo que la empresa debe hoy es de cada antigüedad. Un pago salda lo más
 * VIEJO primero, así que lo que queda debido son los cargos más recientes: se asigna
 * el saldo de los cargos más nuevos hacia atrás hasta agotarlo. Los cargos son los
 * asientos que suman (comisiones y ajustes positivos) con su fecha. Sin deuda
 * (saldo ≤ 0), todo en cero.
 */
export function envejecerDeuda(saldo: Monto, cargos: readonly { amount: Monto; createdAt: Date }[], ahora: Date): Record<TramoDeAntiguedad, Decimal> {
  const salida = { '0-30': new Prisma.Decimal(0), '31-60': new Prisma.Decimal(0), '61-90': new Prisma.Decimal(0), '90+': new Prisma.Decimal(0) } as Record<TramoDeAntiguedad, Decimal>
  let pendiente = decimal(saldo)
  if (!pendiente.greaterThan(0)) return salida
  const nuevosPrimero = [...cargos].filter((c) => decimal(c.amount).greaterThan(0)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  for (const c of nuevosPrimero) {
    if (!pendiente.greaterThan(0)) break
    const monto = decimal(c.amount)
    const asignado = monto.lessThan(pendiente) ? monto : pendiente
    const dias = Math.max(0, Math.floor((ahora.getTime() - c.createdAt.getTime()) / 86_400_000))
    const tramo = tramoDeAntiguedad(dias)
    salida[tramo] = salida[tramo].plus(asignado)
    pendiente = pendiente.minus(asignado)
  }
  // Lo que no se explica con cargos (un saldo inicial sin historia) cuenta como lo más viejo.
  if (pendiente.greaterThan(0)) salida['90+'] = salida['90+'].plus(pendiente)
  return salida
}

// ── Texto ────────────────────────────────────────────────────────────────────

/** Un monto como texto de dos decimales (lo que viaja a las pantallas y a la bitácora). */
export function montoATexto(m: Monto): string {
  return decimal(m).toFixed(2)
}

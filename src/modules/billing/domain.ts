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
  /** El canal de atribución del pedido (texto: este módulo no importa el dominio de pedidos). `null` si no se conoce. */
  attributionChannel?: string | null
  commissionableBase: Monto
  verificationLevel: MembegoVerificationLevel
  currency: string
}

/**
 * Orígenes que comisionan POR SÍ MISMOS: el pedido nació en Membego (la vitrina, el carrito,
 * una oferta), así que la adquisición es de Membego sea cual sea el canal que lo cumpla.
 * POS, excursiones y API NO están aquí: en esos orígenes decide la atribución (abajo).
 */
export const ORIGENES_COMISIONABLES: readonly string[] = ['MARKETPLACE']

/**
 * ADQUISICIÓN ≠ CUMPLIMIENTO. Un pedido se cobra por lo que Membego trajo, no por dónde se
 * cumplió o se pagó: el pedido del marketplace que la caja cobra y entrega (origen MARKETPLACE,
 * cumplido por POS) comisiona; la venta de mostrador de quien entró por su cuenta (origen POS,
 * canal DIRECT) no. Para un origen que no comisiona por sí mismo, comisiona SOLO si su atribución
 * es demostrable: uno de estos canales, cada uno con el dato que la base le exige (promoción,
 * campaña, código de referido). `QR_SCAN` (el cliente se identificó con su QR en el mostrador)
 * y `DIRECT` no prueban que Membego trajera la venta y no comisionan. Nada de esto cobra hacia
 * atrás: un pedido sin atribución demostrable sigue sin comisionar.
 */
export const CANALES_ATRIBUIDOS_A_MEMBEGO: readonly string[] = ['MARKETPLACE_BROWSE', 'MARKETPLACE_SEARCH', 'PROMOTION_CLAIM', 'CAMPAIGN', 'REFERRAL']

/** El tipo de documento con el que el puente de Supply envuelve una compra (se compara como texto: este módulo no importa Supply). */
const FUENTE_SUPPLY = 'SUPPLY_V2_CUSTOMER_ORDER'

/** Un pedido de Supply nunca comisiona aquí, pase lo que pase con su origen. */
export function esPedidoDeSupply(p: Pick<PedidoParaComision, 'origin' | 'sourceType'>): boolean {
  return p.origin === 'SUPPLY' || p.sourceType === FUENTE_SUPPLY
}

export function pedidoGeneraComision(p: Pick<PedidoParaComision, 'origin' | 'sourceType' | 'attributionChannel'>): boolean {
  if (esPedidoDeSupply(p)) return false
  if (ORIGENES_COMISIONABLES.includes(p.origin)) return true
  return typeof p.attributionChannel === 'string' && CANALES_ATRIBUIDOS_A_MEMBEGO.includes(p.attributionChannel)
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
  /** Si es la cuota de una oferta con presupuesto (Fase 5): el id de la oferta. */
  dealId?: string | null
}

/**
 * La CUOTA de una oferta con presupuesto: lo que la oferta fijó por canje al crearse. Siempre
 * CPA, sea cual sea el modelo de cobro de la empresa, y se cobra aunque la base del pedido sea
 * cero (una oferta gratis también paga su cuota). `dealId` es el id de la oferta, un texto
 * opaco: Merchant Billing no conoce las ofertas.
 */
export interface CuotaDeOferta {
  dealId: string
  amount: Monto
}

export function calcularCuotaDeOferta(pedido: Pick<PedidoParaComision, 'commissionableBase'>, cuota: CuotaDeOferta, feeModel: MerchantFeeModel): ComisionCalculada {
  if (typeof cuota.dealId !== 'string' || cuota.dealId.trim() === '') throw new Error('La cuota de una oferta necesita el id de la oferta.')
  const base = redondear2(decimal(pedido.commissionableBase))
  if (!base.isFinite() || base.isNegative()) throw new Error('La base comisionable no puede ser negativa.')
  const amount = redondear2(decimal(cuota.amount))
  if (!amount.isFinite() || !amount.greaterThan(0)) throw new Error('La cuota de una oferta tiene que ser mayor que cero.')
  return { type: 'CPA_FIXED', feeModel, baseAmount: base, rate: null, amount, dealId: cuota.dealId }
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
/** Con cualquier signo (nunca cero): el ajuste manual y el ajuste por verificación de una comisión. */
export const TIPOS_CON_SIGNO: readonly MerchantLedgerEntryType[] = ['ADJUSTMENT', 'VERIFICATION_ADJUSTMENT']
const TIPOS_CON_MOTIVO: readonly MerchantLedgerEntryType[] = ['ADJUSTMENT', 'VERIFICATION_ADJUSTMENT', 'CREDIT', 'PROMOTIONAL_CREDIT']

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

/** Lo que Merchant Billing necesita de una comisión ya cobrada para decidir su ajuste por verificación. */
export interface ComisionParaAjuste {
  type: MerchantCommissionType
  feeModel: MerchantFeeModel
  status: string
  dealId: string | null
  baseAmount: Monto
  amount: Monto
  verificationAdjustmentAmount: Monto | null
}

export type AjustePorVerificacion =
  | { resultado: 'AJUSTAR'; amount: Decimal; rate: Decimal; objetivo: Decimal }
  | { resultado: 'NO_APLICA'; motivo: 'MODELO' | 'PORCENTAJE' | 'OFERTA' | 'REVERTIDA' | 'YA_AJUSTADA' | 'NIVEL' }
  | { resultado: 'SIN_DIFERENCIA' }

/**
 * Cuánto hay que asentar para que una comisión cobrada como CPA quede en el porcentaje, ahora
 * que el pago está verificado por una fuente externa. SOLO para el modelo HYBRID (en CPA_FIXED el
 * CPA es la regla y en PERCENTAGE ya se cobró el porcentaje), SOLO para comisiones CPA sin cuota
 * de oferta (la cuota de una oferta es un precio pactado, no un adelanto) y UNA sola vez. La
 * diferencia lleva signo: si el porcentaje es menor que el CPA, se devuelve la diferencia, porque
 * lo que la regla dice es «porcentaje desde PAYMENT_VERIFIED», no «lo que sea mayor».
 */
export function calcularAjustePorVerificacion(c: ComisionParaAjuste, nivel: MembegoVerificationLevel, config: ConfigDeCobro): AjustePorVerificacion {
  if (c.status === 'REVERSED') return { resultado: 'NO_APLICA', motivo: 'REVERTIDA' }
  if (c.verificationAdjustmentAmount !== null) return { resultado: 'NO_APLICA', motivo: 'YA_AJUSTADA' }
  if (c.dealId) return { resultado: 'NO_APLICA', motivo: 'OFERTA' }
  if (c.feeModel !== 'HYBRID') return { resultado: 'NO_APLICA', motivo: 'MODELO' }
  if (c.type !== 'CPA_FIXED') return { resultado: 'NO_APLICA', motivo: 'PORCENTAJE' }
  if (!NIVELES_CON_PAGO_VERIFICADO.includes(nivel)) return { resultado: 'NO_APLICA', motivo: 'NIVEL' }
  const errorConfig = validarTarifas(config)
  if (errorConfig) throw new Error(errorConfig)
  const base = redondear2(decimal(c.baseAmount))
  const rate = decimal(config.percentageRate)
  const objetivo = repartirComision(base, rate).commissionAmount
  const amount = redondear2(objetivo.minus(decimal(c.amount)))
  if (amount.isZero()) return { resultado: 'SIN_DIFERENCIA' }
  return { resultado: 'AJUSTAR', amount, rate, objetivo }
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

/**
 * El instante que se escribe en un asiento: el de quien llama, pero NUNCA anterior al
 * del último asiento de la cuenta. Quien llama captura su `ahora` antes de esperar el
 * candado de la cuenta, y la posición (`seq`) se asigna al obtenerlo: sin esto, dos
 * escritores que se crucen (una medianoche en medio, un «Revisar ahora» lento) dejarían
 * un asiento con posición posterior y fecha anterior, y un corte (que delimita por
 * fecha y cuadra por posición) no podría emitirse nunca. La base lo exige también
 * (`merchant_ledger_orden`).
 */
export function instanteDelAsiento(ahora: Date, ultimo: { createdAt: Date } | null): Date {
  return ultimo !== null && ultimo.createdAt.getTime() > ahora.getTime() ? ultimo.createdAt : ahora
}

/** Una clave de idempotencia de las que escribe el sistema para las comisiones (`commission:<pedido>[:reversal]`). */
export const PREFIJO_CLAVE_DE_COMISION = 'commission:'

export function esClaveDeComision(clave: string): boolean {
  return clave.trim().toLowerCase().startsWith(PREFIJO_CLAVE_DE_COMISION)
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
  // El ajuste por verificación va con los ajustes (tiene signo) y no con las comisiones (que el corte exige ≥ 0).
  const adjustments = suma(TIPOS_CON_SIGNO)
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

/** Un asiento tal como lo necesita la antigüedad: con el documento al que apunta. */
export interface AsientoParaAntiguedad {
  type: MerchantLedgerEntryType
  amount: Monto
  createdAt: Date
  referenceType: string
  referenceId: string
}

/**
 * Los cargos que siguen VIVOS: comisiones (y ajustes positivos) menos las comisiones
 * que ya tienen su reverso. Una comisión revertida y su reverso se anulan entre sí:
 * dejarla como cargo vivo atribuiría el saldo a un cobro que ya no existe y haría
 * parecer más joven una deuda vieja. (Los pagos y créditos no se descuentan aquí:
 * saldan lo más viejo y eso lo hace `envejecerDeuda` con el saldo.)
 */
export function cargosVigentes(asientos: readonly AsientoParaAntiguedad[]): { amount: Monto; createdAt: Date }[] {
  const revertidas = new Set(asientos.filter((a) => a.type === 'REFUND' && a.referenceType === 'COMMISSION').map((a) => a.referenceId))
  return asientos
    .filter((a) => {
      if (a.type === 'ADJUSTMENT') return decimal(a.amount).greaterThan(0)
      // El ajuste positivo de una comisión es un cargo vivo mientras la comisión no se haya revertido.
      if (a.type === 'VERIFICATION_ADJUSTMENT') return decimal(a.amount).greaterThan(0) && !revertidas.has(a.referenceId)
      if (!TIPOS_QUE_SUMAN.includes(a.type)) return false
      return !(a.referenceType === 'COMMISSION' && revertidas.has(a.referenceId))
    })
    .map((a) => ({ amount: a.amount, createdAt: a.createdAt }))
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

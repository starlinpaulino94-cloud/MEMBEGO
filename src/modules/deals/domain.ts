import { Prisma, type DealClaimStatus, type DealDiscountType, type DealStatus } from '@prisma/client'
import { decimal, redondear2, type Decimal, type Monto } from '@/lib/commerce-primitives/dinero'

/**
 * COMMERCE CORE · ofertas con presupuesto (Deals) — el dominio PURO (Fase 5).
 *
 * Sin Prisma en tiempo de ejecución más allá de `Decimal`: qué estados admite una oferta,
 * cuánto cuesta el descuento, cuánto presupuesto queda y por qué una oferta no se puede
 * reclamar. La base repite lo que importa (transiciones, rangos, cuadre de contadores);
 * esto es lo que el servicio y las pantallas consultan.
 */

// ── Estados ──────────────────────────────────────────────────────────────────

export const ESTADOS_DE_OFERTA: readonly DealStatus[] = ['DRAFT', 'ACTIVE', 'PAUSED', 'BUDGET_EXHAUSTED', 'COMPLETED', 'ARCHIVED']

/** Gemela del disparador `deals_reglas`. */
export const TRANSICIONES_DE_OFERTA: Readonly<Record<DealStatus, readonly DealStatus[]>> = {
  DRAFT: ['ACTIVE', 'ARCHIVED'],
  ACTIVE: ['PAUSED', 'BUDGET_EXHAUSTED', 'COMPLETED', 'ARCHIVED'],
  PAUSED: ['ACTIVE', 'BUDGET_EXHAUSTED', 'COMPLETED', 'ARCHIVED'],
  BUDGET_EXHAUSTED: ['ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED'],
  COMPLETED: ['ARCHIVED'],
  ARCHIVED: [],
}

export function puedePasarOferta(de: DealStatus, a: DealStatus): boolean {
  return TRANSICIONES_DE_OFERTA[de].includes(a)
}

/** Gemela del disparador `deal_claims_reglas`. */
export const TRANSICIONES_DE_RECLAMO: Readonly<Record<DealClaimStatus, readonly DealClaimStatus[]>> = {
  CLAIMED: ['REDEEMED', 'EXPIRED', 'CANCELLED'],
  REDEEMED: ['REFUNDED'],
  EXPIRED: [],
  CANCELLED: [],
  REFUNDED: [],
}

/** Estados en los que la oferta se puede editar por completo (aún no se publicó). */
export const ESTADOS_EDITABLES: readonly DealStatus[] = ['DRAFT']
/** Estados desde los que se puede pausar. */
export const ESTADOS_PAUSABLES: readonly DealStatus[] = ['ACTIVE', 'BUDGET_EXHAUSTED']
/** Estados que cuentan como «vivos» para el listado de la empresa. */
export const ESTADOS_VIVOS: readonly DealStatus[] = ['ACTIVE', 'PAUSED', 'BUDGET_EXHAUSTED']

export const ETIQUETA_ESTADO_OFERTA: Readonly<Record<DealStatus, string>> = {
  DRAFT: 'Borrador',
  ACTIVE: 'Activa',
  PAUSED: 'Pausada',
  BUDGET_EXHAUSTED: 'Presupuesto agotado',
  COMPLETED: 'Terminada',
  ARCHIVED: 'Archivada',
}

export const ETIQUETA_ESTADO_RECLAMO: Readonly<Record<DealClaimStatus, string>> = {
  CLAIMED: 'Por canjear',
  REDEEMED: 'Canjeada',
  EXPIRED: 'Venció',
  CANCELLED: 'Cancelada',
  REFUNDED: 'Reembolsada',
}

// ── Validación de una oferta ─────────────────────────────────────────────────

export const LIMITES = {
  tituloMax: 120,
  descripcionMax: 600,
  clientesMax: 100_000,
  vigenciaDiasMin: 1,
  vigenciaDiasMax: 60,
  /** Cuánto puede durar una oferta como máximo desde que empieza. */
  duracionMaxDias: 366,
} as const

export interface EntradaDeOferta {
  title: string
  description?: string | null
  catalogVariantId: string
  discountType: DealDiscountType
  discountValue: Monto
  startsAt: Date
  endsAt?: Date | null
  voucherDays?: number
  newCustomersOnly?: boolean
  maxClaims: number
  budgetTotal: Monto
}

export interface OfertaValida {
  title: string
  description: string | null
  catalogVariantId: string
  discountType: DealDiscountType
  discountValue: Decimal
  startsAt: Date
  endsAt: Date | null
  voucherDays: number
  newCustomersOnly: boolean
  maxClaims: number
  budgetTotal: Decimal
}

const TIPOS_DE_DESCUENTO: readonly DealDiscountType[] = ['PERCENT', 'AMOUNT_OFF', 'FIXED_PRICE']

function monto(v: Monto): Decimal | null {
  try {
    const d = decimal(v)
    return d.isFinite() ? d : null
  } catch {
    return null
  }
}

/**
 * Valida y normaliza lo que llega de un formulario. `cuota` es lo que Membego cobra por canje
 * (de la tarifa de la cuenta): el presupuesto tiene que alcanzar para al menos un canje.
 */
export function validarOferta(e: EntradaDeOferta, cuota: Monto): { ok: true; datos: OfertaValida } | { ok: false; error: string } {
  const title = typeof e.title === 'string' ? e.title.trim().replace(/\s+/g, ' ') : ''
  if (title.length < 3) return { ok: false, error: 'Ponle un título a la oferta (al menos 3 letras).' }
  if (title.length > LIMITES.tituloMax) return { ok: false, error: `El título no puede pasar de ${LIMITES.tituloMax} letras.` }
  const description = typeof e.description === 'string' && e.description.trim() !== '' ? e.description.trim() : null
  if (description && description.length > LIMITES.descripcionMax) return { ok: false, error: `La descripción no puede pasar de ${LIMITES.descripcionMax} letras.` }
  if (typeof e.catalogVariantId !== 'string' || e.catalogVariantId === '') return { ok: false, error: 'Elige el producto o servicio que ofreces.' }
  if (!TIPOS_DE_DESCUENTO.includes(e.discountType)) return { ok: false, error: 'El tipo de descuento no es válido.' }
  const valor = monto(e.discountValue)
  if (valor === null) return { ok: false, error: 'El descuento no es un número.' }
  if (valor.decimalPlaces() > 2) return { ok: false, error: 'El descuento admite como máximo dos decimales.' }
  if (e.discountType === 'PERCENT' && (valor.lessThanOrEqualTo(0) || valor.greaterThan(100))) return { ok: false, error: 'El porcentaje tiene que estar entre 1 y 100.' }
  if (e.discountType === 'AMOUNT_OFF' && valor.lessThanOrEqualTo(0)) return { ok: false, error: 'La rebaja tiene que ser mayor que cero.' }
  if (e.discountType === 'FIXED_PRICE' && valor.isNegative()) return { ok: false, error: 'El precio de la oferta no puede ser negativo.' }

  if (!(e.startsAt instanceof Date) || Number.isNaN(e.startsAt.getTime())) return { ok: false, error: 'La fecha de inicio no es válida.' }
  let endsAt: Date | null = null
  if (e.endsAt !== undefined && e.endsAt !== null) {
    if (!(e.endsAt instanceof Date) || Number.isNaN(e.endsAt.getTime())) return { ok: false, error: 'La fecha de fin no es válida.' }
    if (e.endsAt.getTime() <= e.startsAt.getTime()) return { ok: false, error: 'La oferta tiene que terminar después de empezar.' }
    if (e.endsAt.getTime() - e.startsAt.getTime() > LIMITES.duracionMaxDias * 86_400_000) return { ok: false, error: `Una oferta no puede durar más de ${LIMITES.duracionMaxDias} días.` }
    endsAt = e.endsAt
  }

  const voucherDays = e.voucherDays ?? 7
  if (!Number.isInteger(voucherDays) || voucherDays < LIMITES.vigenciaDiasMin || voucherDays > LIMITES.vigenciaDiasMax) {
    return { ok: false, error: `El cupón debe valer entre ${LIMITES.vigenciaDiasMin} y ${LIMITES.vigenciaDiasMax} días.` }
  }
  if (!Number.isInteger(e.maxClaims) || e.maxClaims < 1 || e.maxClaims > LIMITES.clientesMax) {
    return { ok: false, error: `El máximo de clientes tiene que ser un entero entre 1 y ${LIMITES.clientesMax}.` }
  }
  const presupuesto = monto(e.budgetTotal)
  if (presupuesto === null) return { ok: false, error: 'El presupuesto no es un número.' }
  if (presupuesto.decimalPlaces() > 2) return { ok: false, error: 'El presupuesto admite como máximo dos decimales.' }
  const fee = monto(cuota)
  if (fee === null || !fee.greaterThan(0)) return { ok: false, error: 'La cuenta no tiene una tarifa por canje configurada: pide a Membego que la fije.' }
  if (presupuesto.lessThan(fee)) return { ok: false, error: `El presupuesto no alcanza ni para un canje (cada uno cuesta ${fee.toFixed(2)}).` }

  return {
    ok: true,
    datos: {
      title,
      description,
      catalogVariantId: e.catalogVariantId,
      discountType: e.discountType,
      discountValue: valor,
      startsAt: e.startsAt,
      endsAt,
      voucherDays,
      newCustomersOnly: e.newCustomersOnly === true,
      maxClaims: e.maxClaims,
      budgetTotal: presupuesto,
    },
  }
}

// ── Precio de la oferta ──────────────────────────────────────────────────────

/**
 * Cuánto cuesta la variante con la oferta y cuánto se ahorra la persona. Nunca negativo:
 * una rebaja mayor que el precio deja el precio en cero. Un precio fijo mayor que el de
 * lista no es una oferta (ahorro cero).
 */
export function precioDeLaOferta(precioLista: Monto, tipo: DealDiscountType, valor: Monto): { precio: Decimal; ahorro: Decimal } {
  const lista = redondear2(decimal(precioLista))
  const v = decimal(valor)
  let precio: Decimal
  if (tipo === 'PERCENT') precio = redondear2(lista.times(new Prisma.Decimal(100).minus(v)).dividedBy(100))
  else if (tipo === 'AMOUNT_OFF') precio = lista.minus(redondear2(v))
  else precio = redondear2(v)
  if (precio.isNegative()) precio = new Prisma.Decimal(0)
  if (precio.greaterThan(lista)) precio = lista
  return { precio, ahorro: lista.minus(precio) }
}

/** «20 % de descuento», «RD$ 100 menos», «a RD$ 250». Para tarjetas y títulos por defecto. */
export function etiquetaDeDescuento(tipo: DealDiscountType, valor: Monto, moneda = 'DOP'): string {
  const v = decimal(valor)
  const simbolo = moneda === 'DOP' ? 'RD$' : moneda
  if (tipo === 'PERCENT') return `${v.toDecimalPlaces(2).toString()} % de descuento`
  if (tipo === 'AMOUNT_OFF') return `${simbolo} ${v.toFixed(2)} menos`
  return v.isZero() ? 'Gratis' : `A ${simbolo} ${v.toFixed(2)}`
}

// ── Presupuesto y cupos ──────────────────────────────────────────────────────

export interface NumerosDeOferta {
  maxClaims: number
  claimsActive: number
  feePerRedemption: Monto
  budgetTotal: Monto
  budgetReserved: Monto
  budgetSpent: Monto
}

/** Lo que queda del presupuesto: ni gastado ni reservado. */
export function presupuestoLibre(o: Pick<NumerosDeOferta, 'budgetTotal' | 'budgetReserved' | 'budgetSpent'>): Decimal {
  return decimal(o.budgetTotal).minus(decimal(o.budgetReserved)).minus(decimal(o.budgetSpent))
}

/** Cuántos reclamos más admite la oferta: el menor entre los cupos y lo que el presupuesto paga. */
export function reclamosPosibles(o: NumerosDeOferta): number {
  const cupos = Math.max(0, o.maxClaims - o.claimsActive)
  const fee = decimal(o.feePerRedemption)
  if (!fee.greaterThan(0)) return 0
  const porPresupuesto = presupuestoLibre(o).dividedToIntegerBy(fee)
  const pagables = porPresupuesto.isNegative() ? 0 : porPresupuesto.toNumber()
  return Math.max(0, Math.min(cupos, pagables))
}

/**
 * El estado que le toca a una oferta viva según su presupuesto: ACTIVE mientras alcance
 * para otro canje, BUDGET_EXHAUSTED cuando no. Cualquier otro estado se deja como está
 * (una oferta pausada, terminada o archivada no se reactiva sola).
 */
export function estadoPorPresupuesto(o: Pick<NumerosDeOferta, 'feePerRedemption' | 'budgetTotal' | 'budgetReserved' | 'budgetSpent'> & { status: DealStatus }): DealStatus {
  if (o.status !== 'ACTIVE' && o.status !== 'BUDGET_EXHAUSTED') return o.status
  return presupuestoLibre(o).greaterThanOrEqualTo(decimal(o.feePerRedemption)) ? 'ACTIVE' : 'BUDGET_EXHAUSTED'
}

// ── ¿Se puede reclamar? ──────────────────────────────────────────────────────

export interface OfertaParaReclamar extends NumerosDeOferta {
  status: DealStatus
  startsAt: Date
  endsAt: Date | null
}

export interface MotivoNoReclamable {
  codigo: 'OFERTA_NO_DISPONIBLE' | 'OFERTA_PAUSADA' | 'OFERTA_NO_EMPEZO' | 'OFERTA_TERMINADA' | 'OFERTA_AGOTADA' | 'CUENTA_SUSPENDIDA'
  mensaje: string
}

/**
 * Por qué una oferta no se puede reclamar ahora, o `null` si se puede. Es la MISMA condición
 * que aplica el `UPDATE` atómico del servicio; sirve para decir el motivo con claridad y
 * para ocultar de las vitrinas lo que no se puede reclamar.
 */
export function motivoNoReclamable(o: OfertaParaReclamar, ahora: Date, cuentaSuspendida = false): MotivoNoReclamable | null {
  if (o.status === 'DRAFT') return { codigo: 'OFERTA_NO_DISPONIBLE', mensaje: 'Esta oferta todavía no está publicada.' }
  if (o.status === 'ARCHIVED' || o.status === 'COMPLETED') return { codigo: 'OFERTA_TERMINADA', mensaje: 'Esta oferta ya terminó.' }
  if (o.status === 'PAUSED') return { codigo: 'OFERTA_PAUSADA', mensaje: 'Esta oferta está pausada por ahora.' }
  if (o.status === 'BUDGET_EXHAUSTED') return { codigo: 'OFERTA_AGOTADA', mensaje: 'Esta oferta se agotó.' }
  if (o.startsAt.getTime() > ahora.getTime()) return { codigo: 'OFERTA_NO_EMPEZO', mensaje: 'Esta oferta todavía no empieza.' }
  if (o.endsAt !== null && o.endsAt.getTime() <= ahora.getTime()) return { codigo: 'OFERTA_TERMINADA', mensaje: 'Esta oferta ya terminó.' }
  if (reclamosPosibles(o) < 1) return { codigo: 'OFERTA_AGOTADA', mensaje: 'Esta oferta se agotó.' }
  if (cuentaSuspendida) return { codigo: 'CUENTA_SUSPENDIDA', mensaje: 'Esta oferta no está disponible por ahora.' }
  return null
}

/** Hasta cuándo vale un reclamo hecho en `ahora`. */
export function vencimientoDelReclamo(ahora: Date, dias: number): Date {
  return new Date(ahora.getTime() + dias * 86_400_000)
}

// ── Rendimiento (para el panel de la empresa) ────────────────────────────────

export interface ReclamoParaRendimiento {
  status: DealClaimStatus
  savings: Monto
  fee: Monto
}

export interface RendimientoDeOferta {
  reclamos: number
  canjeados: number
  porCanjear: number
  vencidos: number
  cancelados: number
  reembolsados: number
  /** % de lo reclamado que ya se canjeó (0 si no hay reclamos). */
  conversion: number
  /** Lo que Membego ya cobró por canjes (gastado). */
  costoCobrado: Decimal
  /** Lo que ahorraron los clientes en canjes completados. */
  ahorroEntregado: Decimal
}

export function rendimientoDeOferta(reclamos: readonly ReclamoParaRendimiento[]): RendimientoDeOferta {
  const cero = new Prisma.Decimal(0)
  const cuenta = (s: DealClaimStatus) => reclamos.filter((r) => r.status === s).length
  const canjeados = reclamos.filter((r) => r.status === 'REDEEMED')
  return {
    reclamos: reclamos.length,
    canjeados: canjeados.length,
    porCanjear: cuenta('CLAIMED'),
    vencidos: cuenta('EXPIRED'),
    cancelados: cuenta('CANCELLED'),
    reembolsados: cuenta('REFUNDED'),
    conversion: reclamos.length === 0 ? 0 : Math.round((canjeados.length / reclamos.length) * 1000) / 10,
    costoCobrado: canjeados.reduce((t, r) => t.plus(decimal(r.fee)), cero),
    ahorroEntregado: canjeados.reduce((t, r) => t.plus(decimal(r.savings)), cero),
  }
}

export function montoATexto(m: Monto): string {
  return decimal(m).toFixed(2)
}

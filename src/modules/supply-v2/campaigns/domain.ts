import type {
  SupplyV2BenefitFunding,
  SupplyV2CampaignAudience,
  SupplyV2CampaignOrganizer,
  SupplyV2CampaignStatus,
  SupplyV2CouponKind,
  SupplyV2CouponStatus,
  SupplyV2OfferSource,
} from '@prisma/client'
import { Prisma } from '@prisma/client'
import { decimal, type Decimal } from '../core/dinero'
import type { Transiciones } from '../core/estados'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 7 · CAMPAÑAS Y CUPONES: reglas PURAS (§4–§17, §25).
 *
 * Aquí NO se calcula dinero. Una campaña agrupa ofertas, un público y un
 * presupuesto; lo que rebaja cada venta lo calcula el motor del Slice 6
 * (`core/financiacion.ts`) a través de los BENEFICIOS de la campaña. Este
 * módulo decide lo que no es dinero: si la campaña está vigente AHORA, si el
 * cliente pertenece al público, si el cupón que teclearon vale, a qué campaña
 * se atribuye una venta y si el presupuesto de la campaña cuadra con el de sus
 * beneficios.
 */

const CERO = new Prisma.Decimal(0)

// ── Alta y validación de una campaña (§4) ───────────────────────────────────

export interface DatosCampana {
  name: string
  description?: string | null
  objective?: string | null
  organizer: SupplyV2CampaignOrganizer
  supplierId?: string | null
  funding: SupplyV2BenefitFunding
  budgetTotal?: number | string | null
  /** Autorización excepcional para una campaña SIN techo (§17). */
  budgetWaiverReason?: string | null
  audience: SupplyV2CampaignAudience
  startsAt: Date
  endsAt?: Date | null
  /** Minutos desde la medianoche local; los dos o ninguno. */
  activeFromMinute?: number | null
  activeToMinute?: number | null
  maxRedemptions?: number | null
  maxPerCustomer?: number | null
}

export const ORGANIZADORES: readonly SupplyV2CampaignOrganizer[] = ['MEMBEGO', 'SUPPLIER']
export const AUDIENCIAS: readonly SupplyV2CampaignAudience[] = ['ALL', 'NEW_CUSTOMERS', 'RETURNING_CUSTOMERS', 'PAST_CAMPAIGN', 'SELECTED']
export const TIPOS_CUPON: readonly SupplyV2CouponKind[] = ['PUBLIC', 'PRIVATE']

export function validarCampana(d: DatosCampana): string | null {
  if (!d.name?.trim()) return 'La campaña necesita un nombre.'
  if (d.name.trim().length > 140) return 'El nombre es demasiado largo.'
  if (!ORGANIZADORES.includes(d.organizer)) return 'Indica quién organiza la campaña.'
  if (!AUDIENCIAS.includes(d.audience)) return 'Indica a qué público va la campaña.'
  if (d.organizer === 'SUPPLIER' && !d.supplierId) return 'Una campaña propuesta por un proveedor necesita el proveedor que la propone.'
  if (d.funding !== 'MEMBEGO' && !d.supplierId) return 'Si el proveedor financia parte, hace falta decir qué proveedor.'
  if (!(d.startsAt instanceof Date) || Number.isNaN(d.startsAt.getTime())) return 'La fecha de inicio no es válida.'
  if (d.endsAt) {
    if (Number.isNaN(d.endsAt.getTime())) return 'La fecha de fin no es válida.'
    if (d.endsAt <= d.startsAt) return 'El fin de la campaña tiene que ser posterior al inicio.'
  }
  const tope = d.budgetTotal != null && d.budgetTotal !== '' ? decimal(d.budgetTotal) : null
  if (tope && (!tope.isFinite() || tope.lessThanOrEqualTo(0))) return 'El presupuesto tiene que ser mayor que cero.'
  if (tope && d.funding === 'SUPPLIER') return 'Una campaña que financia solo el proveedor no consume presupuesto de Membego.'
  // §17 · el techo es obligatorio cuando Membego pone dinero; sin él hace falta
  // una autorización escrita, que queda en la bitácora.
  if (!tope && d.funding !== 'SUPPLIER' && !d.budgetWaiverReason?.trim()) {
    return 'Una campaña que financia Membego necesita un presupuesto máximo. Si de verdad va sin tope, escribe la autorización financiera que lo permite.'
  }
  const hay = (v: number | null | undefined) => v != null
  if (hay(d.activeFromMinute) !== hay(d.activeToMinute)) return 'La hora de activación y la de desactivación van juntas.'
  if (d.activeFromMinute != null) {
    const a = d.activeFromMinute
    const b = d.activeToMinute!
    if (!Number.isInteger(a) || !Number.isInteger(b)) return 'Las horas tienen que ser válidas.'
    if (a < 0 || a >= 1440 || b <= 0 || b > 1440) return 'Las horas tienen que estar dentro del día.'
    if (b <= a) return 'La hora de desactivación tiene que ser posterior a la de activación.'
  }
  if (d.maxRedemptions != null && (!Number.isInteger(d.maxRedemptions) || d.maxRedemptions <= 0)) return 'El límite total de aplicaciones tiene que ser un entero positivo.'
  const porCliente = d.maxPerCustomer ?? 1
  if (!Number.isInteger(porCliente) || porCliente <= 0) return 'El límite por cliente tiene que ser un entero positivo.'
  return null
}

export const TRANSICIONES_CAMPANA: Transiciones<SupplyV2CampaignStatus> = {
  DRAFT: ['PENDING_APPROVAL', 'CANCELLED'],
  PENDING_APPROVAL: ['SCHEDULED', 'ACTIVE', 'DRAFT', 'CANCELLED'],
  SCHEDULED: ['ACTIVE', 'PAUSED', 'CANCELLED', 'COMPLETED'],
  ACTIVE: ['PAUSED', 'COMPLETED', 'CANCELLED'],
  PAUSED: ['ACTIVE', 'COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
}

/** Estados en los que la campaña ya no se toca. */
export const CAMPANA_CERRADA: readonly SupplyV2CampaignStatus[] = ['COMPLETED', 'CANCELLED']

/**
 * Una campaña APROBADA empieza programada o activa según su fecha de inicio:
 * publicar no adelanta la vigencia.
 */
export function estadoAlPublicar(startsAt: Date, ahora = new Date()): 'SCHEDULED' | 'ACTIVE' {
  return startsAt > ahora ? 'SCHEDULED' : 'ACTIVE'
}

// ── Vigencia: fecha Y ventana horaria (§7) ──────────────────────────────────

export interface VentanaCampana {
  startsAt: Date
  endsAt: Date | null
  activeFromMinute: number | null
  activeToMinute: number | null
}

/**
 * Minutos transcurridos desde la medianoche en la zona de la plataforma. Se
 * calcula con `Intl` y no con `getHours()`, que daría la hora del servidor:
 * una campaña «de 6 a 11 de la noche» tiene que valer a las 6 de la tarde en
 * Santo Domingo, no en UTC.
 */
export function minutosLocales(ahora: Date, zona = 'America/Santo_Domingo'): number {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: zona, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(ahora)
  const hora = Number(partes.find((p) => p.type === 'hour')?.value ?? '0')
  const minuto = Number(partes.find((p) => p.type === 'minute')?.value ?? '0')
  return (hora % 24) * 60 + minuto
}

export type MotivoFueraDeVigencia = 'NO_EMPEZO' | 'TERMINO' | 'FUERA_DE_HORARIO'

/**
 * ¿Vale la campaña AHORA MISMO? Lo comprueba el servidor en cada checkout, así
 * que una promoción programada respeta su horario aunque el cron vaya tarde:
 * el cron mantiene estados, no es la protección (§7).
 */
export function fueraDeVigencia(v: VentanaCampana, ahora = new Date(), zona?: string): MotivoFueraDeVigencia | null {
  if (v.startsAt > ahora) return 'NO_EMPEZO'
  if (v.endsAt && v.endsAt <= ahora) return 'TERMINO'
  if (v.activeFromMinute != null && v.activeToMinute != null) {
    const m = minutosLocales(ahora, zona)
    if (m < v.activeFromMinute || m >= v.activeToMinute) return 'FUERA_DE_HORARIO'
  }
  return null
}

/** «18:30» → 1110. Devuelve null si no es una hora. */
export function minutosDesdeTexto(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/** 1110 → «18:30». */
export function textoDesdeMinutos(minutos: number | null | undefined): string {
  if (minutos == null) return ''
  const h = Math.floor(minutos / 60) % 24
  const m = minutos % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// ── Público objetivo (§13) ──────────────────────────────────────────────────

export interface HistorialDelCliente {
  /** Compras PAGADAS del cliente en Supply 2.0. */
  comprasPagadas: number
  /** Beneficios de campaña que ya aplicó. */
  beneficiosDeCampanaUsados: number
  /** Tiene asignación viva de algún beneficio de ESTA campaña. */
  asignadoAEstaCampana: boolean
}

export type MotivoFueraDePublico = 'SOLO_CLIENTES_NUEVOS' | 'SOLO_CLIENTES_CON_COMPRAS' | 'SOLO_CLIENTES_DE_CAMPANA' | 'SOLO_LISTA_SELECCIONADA'

/**
 * Segmentación BÁSICA (§13): grupos sobre lo que Membego ya guarda de su
 * propia operación —si compró y si usó una promoción—. No se infiere nada
 * sobre la persona y no hay CRM todavía.
 */
export function fueraDePublico(audiencia: SupplyV2CampaignAudience, h: HistorialDelCliente): MotivoFueraDePublico | null {
  switch (audiencia) {
    case 'ALL':
      return null
    case 'NEW_CUSTOMERS':
      return h.comprasPagadas > 0 ? 'SOLO_CLIENTES_NUEVOS' : null
    case 'RETURNING_CUSTOMERS':
      return h.comprasPagadas > 0 ? null : 'SOLO_CLIENTES_CON_COMPRAS'
    case 'PAST_CAMPAIGN':
      return h.beneficiosDeCampanaUsados > 0 ? null : 'SOLO_CLIENTES_DE_CAMPANA'
    case 'SELECTED':
      return h.asignadoAEstaCampana ? null : 'SOLO_LISTA_SELECCIONADA'
  }
}

// ── Cupones: código, normalización y elegibilidad (§9–§12) ──────────────────

/** Sin vocales ni caracteres que se confundan al dictarlos (0/O, 1/I/L). */
const ALFABETO = 'ACDEFGHJKMNPQRTVWXY34679'

export function normalizarCodigoCupon(codigo: string): string {
  return codigo.trim().toUpperCase().replace(/[\s-]+/g, '')
}

export function codigoValido(codigo: string): boolean {
  const c = normalizarCodigoCupon(codigo)
  return c.length >= 4 && c.length <= 32 && /^[A-Z0-9]+$/.test(c)
}

/**
 * Código aleatorio con entropía suficiente para que adivinarlo no sea una
 * estrategia: 10 símbolos de un alfabeto de 24 ≈ 46 bits. El código NO es una
 * credencial —la elegibilidad se comprueba igual—, pero un código adivinable
 * convierte un cupón privado en uno público de facto.
 */
export function codigoAleatorio(aleatorio: (n: number) => Uint8Array, largo = 10): string {
  const bytes = aleatorio(largo)
  let out = ''
  for (let i = 0; i < largo; i++) out += ALFABETO[bytes[i]! % ALFABETO.length]
  return out
}

export interface CuponParaElegibilidad {
  id: string
  code: string
  kind: SupplyV2CouponKind
  customerId: string | null
  status: SupplyV2CouponStatus
  maxRedemptions: number | null
  maxPerCustomer: number
  minPurchase: Decimal | null
  timesRedeemed: number
  expiresAt: Date | null
}

export interface CampanaParaElegibilidad extends VentanaCampana {
  id: string
  status: SupplyV2CampaignStatus
  currency: string
  maxRedemptions: number | null
  maxPerCustomer: number
  audience: SupplyV2CampaignAudience
}

export type MotivoCuponNoAplicable =
  | 'CODIGO_INVALIDO'
  | 'CUPON_NO_ENCONTRADO'
  | 'CUPON_CANCELADO'
  | 'CUPON_AGOTADO'
  | 'CUPON_VENCIDO'
  | 'CUPON_AJENO'
  | 'CAMPANA_NO_ACTIVA'
  | 'CAMPANA_NO_EMPEZO'
  | 'CAMPANA_TERMINO'
  | 'FUERA_DE_HORARIO'
  | 'CAMPANA_AGOTADA'
  | 'LIMITE_DE_CAMPANA_POR_CLIENTE'
  | 'LIMITE_DEL_CUPON'
  | 'LIMITE_DEL_CUPON_POR_CLIENTE'
  | 'OFERTA_FUERA_DE_CAMPANA'
  | 'COMPRA_MINIMA'
  | 'FUERA_DE_PUBLICO'

export const MENSAJES_CUPON: Record<MotivoCuponNoAplicable, string> = {
  CODIGO_INVALIDO: 'Ese código no tiene un formato válido.',
  CUPON_NO_ENCONTRADO: 'Ese código no existe o ya no está disponible.',
  CUPON_CANCELADO: 'Ese cupón se canceló.',
  CUPON_AGOTADO: 'Ese cupón ya se agotó.',
  CUPON_VENCIDO: 'Ese cupón ya venció.',
  CUPON_AJENO: 'Ese cupón no es tuyo.',
  CAMPANA_NO_ACTIVA: 'La promoción de ese cupón no está activa.',
  CAMPANA_NO_EMPEZO: 'Esa promoción todavía no empieza.',
  CAMPANA_TERMINO: 'Esa promoción ya terminó.',
  FUERA_DE_HORARIO: 'Esa promoción solo vale en su horario.',
  CAMPANA_AGOTADA: 'Esa promoción alcanzó su límite de usos.',
  LIMITE_DE_CAMPANA_POR_CLIENTE: 'Ya alcanzaste el máximo de usos de esa promoción.',
  LIMITE_DEL_CUPON: 'Ese cupón alcanzó su límite de usos.',
  LIMITE_DEL_CUPON_POR_CLIENTE: 'Ya usaste ese cupón.',
  OFERTA_FUERA_DE_CAMPANA: 'Ese cupón no aplica a esta oferta.',
  COMPRA_MINIMA: 'Esta compra no alcanza el mínimo que pide el cupón.',
  FUERA_DE_PUBLICO: 'Ese cupón es para otro grupo de clientes.',
}

/** Un mensaje que no distingue «no existe» de «no es tuyo» para quien prueba códigos a mano (§28). */
export const MENSAJE_CUPON_OPACO = 'Ese código no existe o no se puede usar en esta compra.'

export interface UsosDelCupon {
  /** Aplicaciones VIVAS + consolidadas del cupón, de cualquier cliente. */
  totales: number
  /** Las de ESTE cliente. */
  delCliente: number
  /** Aplicaciones de beneficios de la campaña por ESTE cliente. */
  deLaCampanaPorCliente: number
  /** Aplicaciones de toda la campaña. */
  deLaCampana: number
}

/**
 * Elegibilidad completa de un cupón, en orden (§11): código → cupón → campaña
 * → vigencia y horario → topes de campaña → topes del cupón → oferta → compra
 * mínima → público. El primero que falle es el que se devuelve, para que el
 * mensaje explique la causa de verdad y no la última comprobación.
 */
export function motivoCuponNoAplicable(
  c: CuponParaElegibilidad,
  campana: CampanaParaElegibilidad,
  d: {
    customerId: string
    ofertaEnCampana: boolean
    importeDeLinea: Decimal
    usos: UsosDelCupon
    historial: HistorialDelCliente
  },
  ahora = new Date(),
  zona?: string
): MotivoCuponNoAplicable | null {
  if (c.status === 'CANCELLED') return 'CUPON_CANCELADO'
  if (c.status === 'EXPIRED') return 'CUPON_VENCIDO'
  if (c.status === 'EXHAUSTED') return 'CUPON_AGOTADO'
  if (c.expiresAt && c.expiresAt <= ahora) return 'CUPON_VENCIDO'
  if (c.kind === 'PRIVATE' && c.customerId !== d.customerId) return 'CUPON_AJENO'

  if (campana.status !== 'ACTIVE') return 'CAMPANA_NO_ACTIVA'
  const fuera = fueraDeVigencia(campana, ahora, zona)
  if (fuera === 'NO_EMPEZO') return 'CAMPANA_NO_EMPEZO'
  if (fuera === 'TERMINO') return 'CAMPANA_TERMINO'
  if (fuera === 'FUERA_DE_HORARIO') return 'FUERA_DE_HORARIO'

  if (campana.maxRedemptions != null && d.usos.deLaCampana >= campana.maxRedemptions) return 'CAMPANA_AGOTADA'
  if (d.usos.deLaCampanaPorCliente >= campana.maxPerCustomer) return 'LIMITE_DE_CAMPANA_POR_CLIENTE'
  if (c.maxRedemptions != null && d.usos.totales >= c.maxRedemptions) return 'LIMITE_DEL_CUPON'
  if (d.usos.delCliente >= c.maxPerCustomer) return 'LIMITE_DEL_CUPON_POR_CLIENTE'

  if (!d.ofertaEnCampana) return 'OFERTA_FUERA_DE_CAMPANA'
  if (c.minPurchase && d.importeDeLinea.lessThan(c.minPurchase)) return 'COMPRA_MINIMA'
  if (fueraDePublico(campana.audience, d.historial)) return 'FUERA_DE_PUBLICO'
  return null
}

/** Estado derivado de un cupón según sus usos y su vencimiento. */
export function estadoCuponSegunUsos(c: Pick<CuponParaElegibilidad, 'status' | 'maxRedemptions' | 'timesRedeemed' | 'expiresAt'>, ahora = new Date()): SupplyV2CouponStatus {
  if (c.status === 'CANCELLED') return 'CANCELLED'
  if (c.expiresAt && c.expiresAt <= ahora) return 'EXPIRED'
  if (c.maxRedemptions != null && c.timesRedeemed >= c.maxRedemptions) return 'EXHAUSTED'
  return 'ACTIVE'
}

// ── Presupuesto de campaña frente a presupuesto de beneficio (§16) ──────────

export interface PresupuestoDeBeneficio {
  budgetTotal: Decimal | null
  budgetReserved: Decimal | string | number
  budgetConsumed: Decimal | string | number
}

export interface PresupuestoDeCampana {
  /** Techo aprobado; null = sin tope autorizado. */
  aprobado: Decimal | null
  /** Suma de los techos de sus beneficios. */
  comprometido: Decimal
  reservado: Decimal
  consumido: Decimal
  /** Lo que queda del techo aprobado; null si no hay techo. */
  disponible: Decimal | null
  /** true si algún beneficio va sin tope: entonces el techo no se puede garantizar. */
  algunBeneficioSinTope: boolean
}

/**
 * El presupuesto de la campaña se LEE de sus beneficios: no hay un segundo
 * contador que pueda desincronizarse ni contar dos veces el mismo dinero
 * (§16). El techo de la campaña es un límite sobre la suma de los techos de
 * sus beneficios, y lo reservado y lo consumido salen de sus ledgers.
 */
export function presupuestoDeCampana(aprobado: Decimal | string | number | null, beneficios: readonly PresupuestoDeBeneficio[]): PresupuestoDeCampana {
  const techo = aprobado != null && aprobado !== '' ? decimal(aprobado) : null
  let comprometido = CERO
  let reservado = CERO
  let consumido = CERO
  let sinTope = false
  for (const b of beneficios) {
    if (b.budgetTotal == null) sinTope = true
    else comprometido = comprometido.plus(decimal(b.budgetTotal))
    reservado = reservado.plus(decimal(b.budgetReserved))
    consumido = consumido.plus(decimal(b.budgetConsumed))
  }
  return {
    aprobado: techo,
    comprometido,
    reservado,
    consumido,
    disponible: techo ? techo.minus(reservado).minus(consumido) : null,
    algunBeneficioSinTope: sinTope,
  }
}

/**
 * ¿Cabe un beneficio nuevo (o ampliado) dentro del techo de la campaña? Se
 * comprueba ANTES de crearlo: así una campaña no puede comprometer más de lo
 * aprobado repartiéndolo entre beneficios.
 */
export function cabeEnElPresupuesto(p: PresupuestoDeCampana, nuevoTecho: Decimal | string | number | null): string | null {
  if (p.aprobado == null) return null
  if (nuevoTecho == null || nuevoTecho === '') {
    return 'La campaña tiene un presupuesto máximo, así que sus beneficios no pueden ir sin tope.'
  }
  const suma = p.comprometido.plus(decimal(nuevoTecho))
  if (suma.greaterThan(p.aprobado)) {
    return `Los beneficios de la campaña sumarían ${suma.toFixed(2)} y el presupuesto aprobado es ${p.aprobado.toFixed(2)}.`
  }
  return null
}

// ── Atribución comercial (§25) ──────────────────────────────────────────────

export interface OfertaEnCampanas {
  campaignId: string
  campaignCode: string
  startsAt: Date
  /** Lo que rebaja el beneficio de esa campaña en esta compra. */
  beneficio: Decimal | string | number
}

/**
 * Cuando una oferta participa en varias campañas hay que elegir UNA, siempre
 * la misma: la que más rebaja; si empatan, la que empezó antes; si siguen
 * empatadas, por código. Determinista y sin azar, para que dos cálculos del
 * mismo caso den el mismo resultado y una venta no se cuente dos veces.
 */
export function campanaAtribuida(candidatas: readonly OfertaEnCampanas[]): OfertaEnCampanas | null {
  if (candidatas.length === 0) return null
  return [...candidatas].sort((a, b) => {
    const d = decimal(b.beneficio).comparedTo(decimal(a.beneficio))
    if (d !== 0) return d
    const t = a.startsAt.getTime() - b.startsAt.getTime()
    if (t !== 0) return t
    return a.campaignCode.localeCompare(b.campaignCode)
  })[0]!
}

// ── Analítica (§24): una venta cuenta una vez ───────────────────────────────

export interface VentaDeCampana {
  orderId: string
  status: 'PENDING' | 'AWAITING_PAYMENT' | 'PAID' | 'CANCELLED' | 'EXPIRED' | 'REFUNDED'
  gmv: Decimal | string | number
  contractualValue: Decimal | string | number
  supplierDiscount: Decimal | string | number
  membegoSubsidy: Decimal | string | number
  customerPaid: Decimal | string | number
  commission: Decimal | string | number
  supplierNet: Decimal | string | number
  derechosEmitidos: number
  derechosRedimidos: number
  derechosVencidos: number
}

export interface MetricasCampana {
  /** Pedidos atribuidos, en cualquier estado. */
  pedidos: number
  /** Solo los PAGADOS: una intención de compra no es una venta (§24). */
  ventasConfirmadas: number
  gmv: Decimal
  contractualValue: Decimal
  aportacionProveedor: Decimal
  subsidioMembego: Decimal
  costoPromocional: Decimal
  cobradoAlCliente: Decimal
  comision: Decimal
  netoProveedor: Decimal
  ingresoMembego: Decimal
  derechosEmitidos: number
  derechosRedimidos: number
  derechosVencidos: number
  contribucionTrasSubsidio: Decimal
  /** Pedidos abiertos: reservas en curso, que NO son ventas. */
  pedidosEnCurso: number
}

/**
 * Agrega las ventas de una campaña. Cada pedido entra UNA vez —la atribución
 * está congelada en el pedido—, y solo los pagados cuentan como venta: una
 * reserva en curso se informa aparte para no inflar el GMV (§24–§25).
 */
export function metricasDeCampana(ventas: readonly VentaDeCampana[]): MetricasCampana {
  const vistos = new Set<string>()
  const m: MetricasCampana = {
    pedidos: 0,
    ventasConfirmadas: 0,
    gmv: CERO,
    contractualValue: CERO,
    aportacionProveedor: CERO,
    subsidioMembego: CERO,
    costoPromocional: CERO,
    cobradoAlCliente: CERO,
    comision: CERO,
    netoProveedor: CERO,
    ingresoMembego: CERO,
    derechosEmitidos: 0,
    derechosRedimidos: 0,
    derechosVencidos: 0,
    contribucionTrasSubsidio: CERO,
    pedidosEnCurso: 0,
  }
  for (const v of ventas) {
    if (vistos.has(v.orderId)) continue
    vistos.add(v.orderId)
    m.pedidos++
    if (v.status === 'PENDING' || v.status === 'AWAITING_PAYMENT') m.pedidosEnCurso++
    if (v.status !== 'PAID') continue
    m.ventasConfirmadas++
    m.gmv = m.gmv.plus(decimal(v.gmv))
    m.contractualValue = m.contractualValue.plus(decimal(v.contractualValue))
    m.aportacionProveedor = m.aportacionProveedor.plus(decimal(v.supplierDiscount))
    m.subsidioMembego = m.subsidioMembego.plus(decimal(v.membegoSubsidy))
    m.cobradoAlCliente = m.cobradoAlCliente.plus(decimal(v.customerPaid))
    m.comision = m.comision.plus(decimal(v.commission))
    m.netoProveedor = m.netoProveedor.plus(decimal(v.supplierNet))
    m.derechosEmitidos += v.derechosEmitidos
    m.derechosRedimidos += v.derechosRedimidos
    m.derechosVencidos += v.derechosVencidos
  }
  m.costoPromocional = m.subsidioMembego
  // El ingreso de Membego es la comisión en las ventas a comisión; en precompra
  // el ingreso es el valor contractual, pero la campaña reporta lo que la
  // campaña mueve: por eso se informan las dos cifras por separado.
  m.ingresoMembego = m.comision
  m.contribucionTrasSubsidio = m.ingresoMembego.minus(m.subsidioMembego)
  return m
}

/** Una venta de precompra no tiene comisión: su ingreso es el valor contractual. */
export function esVentaAComision(sourceType: SupplyV2OfferSource): boolean {
  return sourceType === 'COMMISSION'
}

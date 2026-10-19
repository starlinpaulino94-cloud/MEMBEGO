/**
 * SUPPLIER & FULFILLMENT COMMERCE · SELLER ≠ SUPPLIER ≠ FULFILLMENT (§12–§19).
 *
 * Puro: sin Prisma, sin rutas. Una sola regla para todo el Marketplace de
 * QUIÉN vende, QUIÉN entrega y QUIÉN financia, con el copy resuelto en un
 * solo sitio (configurable: ver `COPY_COMERCIAL` y la nota legal al pie).
 *
 *   MERCHANT_SALE        la empresa vende lo suyo                → «Vendido por Tech Store»
 *   MEMBEGO_RESALE       Membego revende una unidad que compró   → «Oferta Membego · Ofrecido por Membego · Canje en Litre Pizza»
 *   MEMBEGO_GIFT         Membego la regala (RD$0)                → «Regalo de Membego · Gratis · Canje en Litre Pizza»
 *   MEMBEGO_SPONSORED    Membego ofrece con un descuento que ella financia → «Oferta Membego · Descuento patrocinado por Membego»
 *   MERCHANT_SUBSIDIZED  la empresa vende, Membego financia parte → «Vendido por Litre Pizza · Promoción financiada por Membego»
 *
 * El frontend NO infiere nada de `source === 'SUPPLY'`: recibe este bloque ya
 * resuelto. La unidad comprada por Membego sigue siendo de Membego aunque el
 * proveedor se convierta en Merchant (§48): lo único que cambia entonces es
 * que el punto de canje gana enlace a su vitrina (§49).
 */

export type ModoComercial = 'MERCHANT_SALE' | 'MEMBEGO_RESALE' | 'MEMBEGO_GIFT' | 'MEMBEGO_SPONSORED' | 'MERCHANT_SUBSIDIZED'

export type FinanciadoPor = 'MEMBEGO' | 'EMPRESA' | 'COMPARTIDO'

export interface SucursalDeCanje {
  id: string
  nombre: string
}

export interface PresentacionComercial {
  modo: ModoComercial
  /** Quién ofrece/vende al consumidor (commercial seller). */
  vendedor: { tipo: 'MEMBEGO' | 'EMPRESA'; nombre: string; slug: string | null }
  /**
   * Dónde se entrega/canjea (fulfillment partner). `slug` null = sin vitrina
   * (Supplier Lite): se nombra como punto de canje, sin enlace a ninguna
   * página de empresa. `sucursales` vacío = no se conocen aquí (listas).
   */
  canje: { nombre: string; slug: string | null; sucursales: SucursalDeCanje[] }
  /** Quién financia la promoción cuando no es simplemente el vendedor. */
  financiadoPor: FinanciadoPor | null
  /** Copy resuelto. */
  etiqueta: string | null
  lineaVendedor: string
  lineaCanje: string | null
  lineaFinanciacion: string | null
}

export interface EntradaModoComercial {
  origen: 'EMPRESA' | 'SUPPLY'
  /** La empresa dueña del listado (en SUPPLY es la empresa de la casa; no se enseña). */
  empresa: { nombre: string; slug: string }
  /** Solo SUPPLY: la oferta de Membego y su proveedor (el punto de canje). */
  supply?: {
    priceMode: 'FIXED' | 'PERCENTAGE' | 'FREE'
    sourceType: 'PREPURCHASED_SUPPLY' | 'COMMISSION'
    /** Decimal en texto. */
    salePrice: string
    /** Hay un beneficio ACTIVO financiado por Membego sobre esta oferta. */
    subsidioMembego?: boolean
    proveedor: {
      nombre: string
      /** Slug de la empresa del proveedor, solo si tiene vitrina pública (Merchant). */
      slug: string | null
      sucursales?: SucursalDeCanje[]
    }
  } | null
  /** Solo EMPRESA con oferta: quién financia el descuento. */
  deal?: { sponsor: 'MERCHANT' | 'MEMBEGO' | 'SHARED' } | null
  sucursales?: SucursalDeCanje[]
}

/**
 * COPY CONFIGURABLE. «Vendido por Membego» puede tener implicaciones fiscales
 * y comerciales (quién emite comprobante): LEGAL / ACCOUNTING DECISION
 * REQUIRED (§74). Mientras se decide, el copy neutro es «Ofrecido por» para
 * Membego y «Vendido por» para la empresa. Cambiar una palabra aquí cambia
 * todo el Marketplace; nada de esto inventa reglas fiscales.
 */
export const MARCA = 'MembeGo'

export const COPY_COMERCIAL = {
  etiqueta: {
    MERCHANT_SALE: null,
    MEMBEGO_RESALE: `Oferta ${MARCA}`,
    MEMBEGO_GIFT: `Regalo de ${MARCA}`,
    MEMBEGO_SPONSORED: `Oferta ${MARCA}`,
    MERCHANT_SUBSIDIZED: null,
  } satisfies Record<ModoComercial, string | null>,
  vendidoPor: (nombre: string) => `Vendido por ${nombre}`,
  ofrecidoPorMembego: `Ofrecido por ${MARCA}`,
  regaladoPorMembego: `Regalo de ${MARCA}`,
  canjeEn: (nombre: string, sucursal?: string | null) => `Canje en ${nombre}${sucursal ? ` — ${sucursal}` : ''}`,
  financiacion: {
    MERCHANT_SUBSIDIZED: `Promoción financiada por ${MARCA}`,
    MEMBEGO_SPONSORED: `Descuento patrocinado por ${MARCA}`,
  },
  gratis: 'Gratis',
} as const

const esGratis = (s: { priceMode: string; salePrice: string }) => s.priceMode === 'FREE' || Number(s.salePrice) <= 0

export function modoComercial(e: EntradaModoComercial): ModoComercial {
  if (e.origen === 'SUPPLY' && e.supply) {
    if (esGratis(e.supply)) return 'MEMBEGO_GIFT'
    if (e.supply.subsidioMembego) return 'MEMBEGO_SPONSORED'
    return 'MEMBEGO_RESALE'
  }
  if (e.deal && (e.deal.sponsor === 'MEMBEGO' || e.deal.sponsor === 'SHARED')) return 'MERCHANT_SUBSIDIZED'
  return 'MERCHANT_SALE'
}

export function presentacionComercial(e: EntradaModoComercial): PresentacionComercial {
  const modo = modoComercial(e)
  if (e.origen === 'SUPPLY' && e.supply) {
    const p = e.supply.proveedor
    const sucursales = p.sucursales ?? []
    const unica = sucursales.length === 1 ? sucursales[0]!.nombre : null
    return {
      modo,
      vendedor: { tipo: 'MEMBEGO', nombre: MARCA, slug: null },
      canje: { nombre: p.nombre, slug: p.slug, sucursales },
      financiadoPor: 'MEMBEGO',
      etiqueta: COPY_COMERCIAL.etiqueta[modo],
      lineaVendedor: modo === 'MEMBEGO_GIFT' ? COPY_COMERCIAL.regaladoPorMembego : COPY_COMERCIAL.ofrecidoPorMembego,
      lineaCanje: COPY_COMERCIAL.canjeEn(p.nombre, unica),
      lineaFinanciacion: modo === 'MEMBEGO_SPONSORED' ? COPY_COMERCIAL.financiacion.MEMBEGO_SPONSORED : null,
    }
  }
  const sucursales = e.sucursales ?? []
  const financiadoPor: FinanciadoPor | null = modo === 'MERCHANT_SUBSIDIZED' ? (e.deal?.sponsor === 'SHARED' ? 'COMPARTIDO' : 'MEMBEGO') : null
  return {
    modo,
    vendedor: { tipo: 'EMPRESA', nombre: e.empresa.nombre, slug: e.empresa.slug },
    canje: { nombre: e.empresa.nombre, slug: e.empresa.slug, sucursales },
    financiadoPor,
    etiqueta: COPY_COMERCIAL.etiqueta[modo],
    lineaVendedor: COPY_COMERCIAL.vendidoPor(e.empresa.nombre),
    lineaCanje: null,
    lineaFinanciacion: modo === 'MERCHANT_SUBSIDIZED' ? COPY_COMERCIAL.financiacion.MERCHANT_SUBSIDIZED : null,
  }
}

/** ¿El consumidor paga RD$0? Entonces el lenguaje NO es de venta (§16). */
export function esRegalo(p: Pick<PresentacionComercial, 'modo'>): boolean {
  return p.modo === 'MEMBEGO_GIFT'
}

/** El vendedor comercial es Membego: la unidad es (o fue comprada por) Membego, no de la empresa. */
export function vendeMembego(p: Pick<PresentacionComercial, 'vendedor'>): boolean {
  return p.vendedor.tipo === 'MEMBEGO'
}
